"use strict";

/**
 * OPS-01C `restore-source`：把一份**已验证**的历史备份恢复到新建的专用源库。
 *
 * 为什么需要它：升级演练要有意义，源库必须**落后于**当前 schema——用一份已经
 * 包含全部迁移的备份去演练，`migrate deploy` 会新增 0 条，只证明了「deploy 能跑」，
 * 没有证明「升级这条路走得通」。因此先用升级前的历史备份造一个落后的专用源库，
 * 再对它做 OPS-01C 的升级与回滚演练。
 *
 * 两条硬边界：
 *   1. **不连接备份原来的库**。备份文件里可能带 `USE`/限定名指向原库（常见于
 *      `mysqldump --databases`）；这些一律改写到新库，改写后仍有指向原库的
 *      可执行语句就拒绝导入。整个过程只连新建的专用库；
 *   2. 目标库必须过专用库守卫，且必须是**新库**——不复用任何既有库。
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { buildCloneDatabaseName, redact, OpsTargetError } = require("./dedicated-env.cjs");
const { rewriteBackupForTarget, SAMPLE_TABLES } = require("./restore-core.cjs");
const { ROOT, requireTarget, requireAdminTarget, assertContainerEndpoint, log, fail, containerRunning, runMysql, sql } = require("./runtime.cjs");

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

/**
 * 从 mysqldump 头部读出备份原来的库名。
 *
 * 只用于**改写与残留检查**，不用来建立任何连接。取不到时要求显式 `--source-name`：
 * 猜一个名字会让残留检查形同虚设（改写目标错了，检查自然也查不出问题）。
 */
function detectSourceName(sqlText) {
  const header = sqlText.slice(0, 4000);
  const fromHeader = header.match(/^--\s+Host:.*?Database:\s*(\S+)\s*$/mu);
  if (fromHeader) return fromHeader[1];
  const fromUse = header.match(/^USE\s+`([^`]+)`;/mu);
  return fromUse ? fromUse[1] : undefined;
}

void (async () => {
  let target;
  let admin;
  try {
    // 目标库名以当前专用库为基底（`<专用库>_legacy_<时间戳>`），因此仍需先解析 env。
    target = assertContainerEndpoint(requireTarget());
    admin = requireAdminTarget(target);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!containerRunning()) fail("MySQL 容器未运行，先跑 ops:preflight");

  const secrets = [target.password, admin.password].filter(Boolean);
  const fileArg = arg("file");
  if (!fileArg) { fail("必须用 --file 指定要恢复的备份；本脚本不猜测使用哪一份"); return; }
  const file = path.resolve(ROOT, fileArg);
  if (!fs.existsSync(file)) { fail(`备份文件不存在：${fileArg}`); return; }

  const body = fs.readFileSync(file);
  if (!body.length) { fail(`备份文件为空：${path.relative(ROOT, file)}`); return; }

  // 校验和必须存在且匹配：拿一份来源不明或已损坏的备份造源库，后面的演练结论全部无效。
  const sidecar = `${file}.sha256`;
  if (!fs.existsSync(sidecar)) { fail("缺少 .sha256 旁文件：只接受已验证的备份"); return; }
  const expected = fs.readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(body).digest("hex");
  if (expected !== actual) { fail(`备份校验和不匹配：期望 ${expected}，实际 ${actual}`); return; }
  log(`  ✓ 校验和匹配：${actual}`);

  const text = body.toString("utf8");
  const sourceName = arg("source-name") || detectSourceName(text);
  if (!sourceName) {
    fail("无法从备份头部识别原库名，请用 --source-name 显式指定（不指定就无法做残留检查）");
    return;
  }

  let legacyDb;
  try {
    legacyDb = buildCloneDatabaseName(target.database, "legacy");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  if (legacyDb === sourceName) { fail("目标库与备份原库同名，拒绝执行"); return; }

  log(`OPS-01C 造历史源库：${path.relative(ROOT, file)}（原库 ${sourceName}）→ ${legacyDb}`);
  let created = false;
  try {
    if (sql(admin, `SHOW DATABASES LIKE '${legacyDb}'`)) {
      throw new OpsTargetError(`目标库 ${legacyDb} 已存在，拒绝复用既有库`);
    }
    sql(admin, `CREATE DATABASE \`${legacyDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;

    // 与演练走同一套内核：改写 + 拒绝仍指向原库的可执行语句。
    // 无 `--databases` 的备份里本来就没有 USE / 限定名，这一步等于**证明**了
    // 这份备份不可能写回原库——而不是我们假设它不会。
    const script = rewriteBackupForTarget(text, sourceName, legacyDb);
    const load = runMysql("mysql", admin, [legacyDb], { input: script });
    if (load.status !== 0) {
      throw new OpsTargetError(`导入失败：${redact(String(load.stderr ?? ""), secrets)}`);
    }

    const tables = Number(sql(admin, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${legacyDb}'`));
    if (!tables) throw new OpsTargetError("导入后没有任何表，备份未生效");
    const migrations = Number(sql(admin, `SELECT COUNT(*) FROM \`${legacyDb}\`._prisma_migrations WHERE finished_at IS NOT NULL`));
    const sampled = [];
    for (const table of SAMPLE_TABLES) {
      const exists = sql(admin, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${legacyDb}' AND table_name='${table}'`);
      if (Number(exists) === 0) continue;
      sampled.push(`${table}=${Number(sql(admin, `SELECT COUNT(*) FROM \`${legacyDb}\`.\`${table}\``))}`);
    }
    if (!sampled.length) {
      throw new OpsTargetError(`抽样表全部不存在（清单：${SAMPLE_TABLES.join("、")}），这份备份不像本项目的库`);
    }

    // 应用账号要能连上它：后续演练里 API 以应用账号连接克隆库，
    // 而克隆库的校验需要同时读源库与克隆库。授权在清理阶段回收。
    sql(admin, `GRANT ALL PRIVILEGES ON \`${legacyDb}\`.* TO '${target.user}'@'%'`);
    sql(admin, "FLUSH PRIVILEGES");

    log(`  ✓ 表数量：${tables}`);
    log(`  ✓ 已应用迁移：${migrations} 条`);
    log(`  ✓ 抽样行数：${sampled.join("，")}`);
    log(`  ✓ 已授权应用账号 '${target.user}'@'%' 读写该库`);
    log(`\n✓ 历史源库就绪：${legacyDb}`);
    log("  下一步（演练时把 DATABASE_URL 指向该库）：");
    log(`    DATABASE_URL=\"<同一连接串，库名改为 ${legacyDb}>\" npm run ops:upgrade-drill -- --file ${path.relative(ROOT, file)}`);
    log("  清理（演练结束后）：");
    log(`    REVOKE ALL PRIVILEGES ON \`${legacyDb}\`.* FROM '${target.user}'@'%';`);
    log(`    DROP DATABASE \`${legacyDb}\`;`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ 造历史源库失败：${redact(message, secrets)}`);
    if (created) {
      console.error(`  该库按设计保留供排查：${legacyDb}`);
      console.error(`  清理：REVOKE ALL PRIVILEGES ON \`${legacyDb}\`.* FROM '${target.user}'@'%'; DROP DATABASE \`${legacyDb}\`;`);
    } else {
      console.error("  本次未创建任何库，无残留。");
    }
    console.error("  备份原库未被连接，也未被修改。");
    process.exit(1);
  }
})();
