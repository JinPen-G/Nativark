"use strict";

/**
 * OPS-01A `restore-drill`：把备份恢复到一个**新建的**演练库并校验。
 *
 * 为什么必须恢复到新库：往源库恢复是「用备份覆盖现有数据」，那是事故处置动作，
 * 不是「验证备份可用」。演练要能随时做、且做完不改变任何现有数据。
 *
 * 清理边界：只删除本次脚本创建、且库名形如 `*_drill_<14位时间戳>` 的库。
 * 失败时**保留**演练库供排查，并打印准确的清理命令——不猜、不顺手删别的库。
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { buildDrillDatabaseName, isDrillDatabase, redact, OpsTargetError } = require("./dedicated-env.cjs");
const { ROOT, requireTarget, requireAdminTarget, log, fail, containerRunning, runMysql, sql } = require("./runtime.cjs");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function latestBackup(database) {
  const dir = process.env.OPS_BACKUP_DIR || path.join(ROOT, "backups");
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir)
    .filter((name) => name.startsWith(`${database}-`) && name.endsWith(".sql"))
    .sort();
  return files.length ? path.join(dir, files[files.length - 1]) : undefined;
}

void (() => {
  let target;
  let admin;
  try {
    target = requireTarget();
    // 演练库的 DDL、导入与校验都用管理账号；应用账号只用于读源库。
    admin = requireAdminTarget(target);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!containerRunning()) fail("MySQL 容器未运行，先跑 ops:preflight");

  const file = arg("file") ? path.resolve(ROOT, arg("file")) : latestBackup(target.database);
  if (!file || !fs.existsSync(file)) {
    fail("未找到备份文件；请先 npm run ops:backup，或用 --file 指定路径");
    return;
  }
  const body = fs.readFileSync(file);
  if (!body.length) { fail(`备份文件为空：${path.relative(ROOT, file)}`); return; }

  // 有 .sha256 就必须对得上：拿一份已经损坏的备份做演练，结论毫无意义。
  const sidecar = `${file}.sha256`;
  if (fs.existsSync(sidecar)) {
    const expected = fs.readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
    const actual = crypto.createHash("sha256").update(body).digest("hex");
    if (expected !== actual) { fail(`备份校验和不匹配：期望 ${expected}，实际 ${actual}`); return; }
    log(`  ✓ 校验和匹配：${actual}`);
  } else {
    log("  · 未找到 .sha256 旁文件，跳过校验和比对");
  }

  let drill;
  try {
    drill = buildDrillDatabaseName(target.database);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  if (drill === target.database) { fail("演练库名与源库相同，拒绝执行"); return; }

  log(`OPS-01A 恢复演练：${path.relative(ROOT, file)} → ${drill}`);
  let created = false;
  try {
    if (sql(admin, `SHOW DATABASES LIKE '${drill}'`)) {
      throw new OpsTargetError(`演练库 ${drill} 已存在，拒绝复用既有库`);
    }
    sql(admin, `CREATE DATABASE \`${drill}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;

    // 备份带 `--databases`，其中的 CREATE DATABASE / USE 指向源库；必须改写成演练库，
    // 否则导入会直接写回源库——那就从「验证备份」变成了「覆盖生产数据」。
    const quoted = `\`${target.database}\``;
    const script = body.toString("utf8")
      .replace(new RegExp(`CREATE DATABASE[^;]*${quoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^;]*;`, "gu"), "")
      .replace(new RegExp(`USE ${quoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};`, "gu"), `USE \`${drill}\`;`)
      // 限定名 `src`.`table` 也要改写，否则单条语句仍会落到源库。
      .split(`${quoted}.`).join(`\`${drill}\`.`);
    // 只检查**可执行**语句里的残留：mysqldump 的头部与分节注释里也有库名
    // （`-- Current Database: ...`），那些不会被执行，不该因此拒绝一份好备份。
    const executable = script.split(/\r?\n/).filter((line) => !/^\s*--/u.test(line)).join("\n");
    const dangerous = new RegExp(
      `(USE\\s+${quoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})|(CREATE\\s+DATABASE[^;]*${quoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})|(${quoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\.)`,
      "u"
    );
    if (dangerous.test(executable)) {
      throw new OpsTargetError("备份脚本中仍有指向源库的可执行语句，拒绝导入以免写回源库");
    }
    const load = runMysql("mysql", admin, [drill], { input: script });
    if (load.status !== 0) {
      throw new OpsTargetError(`导入失败：${redact(String(load.stderr ?? ""), [target.password, admin.password])}`);
    }

    // 最小结构与状态校验：表数、迁移条数、几张关键表的行数都要与源库一致。
    const countTables = (db) => Number(sql(admin, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${db}'`));
    const sourceTables = countTables(target.database);
    const drillTables = countTables(drill);
    if (!drillTables || sourceTables !== drillTables) {
      throw new OpsTargetError(`表数量不一致：源库 ${sourceTables}，演练库 ${drillTables}`);
    }
    const migrationsOf = (db) => Number(sql(admin, `SELECT COUNT(*) FROM \`${db}\`._prisma_migrations WHERE finished_at IS NOT NULL`));
    const sourceMigrations = migrationsOf(target.database);
    const drillMigrations = migrationsOf(drill);
    if (sourceMigrations !== drillMigrations) {
      throw new OpsTargetError(`迁移记录不一致：源库 ${sourceMigrations}，演练库 ${drillMigrations}`);
    }
    // 抽样比对行数。表名取自实际 schema（Prisma 未 @@map 的模型是 PascalCase）。
    const sample = ["Tenant", "business_workspaces", "customer_profiles", "_prisma_migrations"];
    const rows = [];
    for (const table of sample) {
      const exists = sql(admin, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${drill}' AND table_name='${table}'`);
      if (Number(exists) === 0) continue;
      const a = Number(sql(admin, `SELECT COUNT(*) FROM \`${target.database}\`.\`${table}\``));
      const b = Number(sql(admin, `SELECT COUNT(*) FROM \`${drill}\`.\`${table}\``));
      if (a !== b) throw new OpsTargetError(`表 ${table} 行数不一致：源库 ${a}，演练库 ${b}`);
      rows.push(`${table}=${b}`);
    }
    // 一张都没比上就说明抽样清单和真实 schema 脱节了。此时「行数一致」是空话，
    // 让它通过等于给出一个看起来合格、实际什么都没验的演练结论。
    if (!rows.length) {
      throw new OpsTargetError(`抽样表在演练库中全部不存在（清单：${sample.join("、")}），无法证明数据已恢复`);
    }

    log(`  ✓ 表数量一致：${drillTables}`);
    log(`  ✓ 已应用迁移一致：${drillMigrations}`);
    log(`  ✓ 抽样行数一致：${rows.join("，")}`);

    if (arg("keep") !== undefined || process.env.OPS_KEEP_DRILL === "1") {
      log(`\n✓ 演练通过。按要求保留演练库：${drill}`);
      log(`  清理：DROP DATABASE \`${drill}\`;`);
    } else {
      if (!isDrillDatabase(drill)) throw new OpsTargetError("拒绝删除：库名不符合本次演练库形态");
      sql(admin, `DROP DATABASE \`${drill}\``);
      log(`\n✓ 演练通过，已删除本次演练库：${drill}`);
    }
    log(`  源库未被修改：${target.database}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ 恢复演练失败：${redact(message, [target.password, admin?.password])}`);
    if (created) {
      console.error(`  演练库已保留供排查：${drill}`);
      console.error(`  确认无需排查后手动清理：DROP DATABASE \`${drill}\`;`);
    }
    console.error(`  源库未被本脚本修改：${target.database}`);
    process.exit(1);
  }
})();
