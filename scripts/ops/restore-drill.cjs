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
const { rewriteBackupForTarget, verifyClone } = require("./restore-core.cjs");
const { assertRestoreAiBarrier, readRetentionCertificates } = require("./ai-retention.cjs");
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

    // 改写与校验都走共用内核（scripts/ops/restore-core.cjs）：
    // 这两段是数据安全的关键判定，两处各留一份拷贝时，将来修好一处、
    // 另一处照旧漏，而漏的那次才是事故。
    const script = rewriteBackupForTarget(body.toString("utf8"), target.database, drill);
    const load = runMysql("mysql", admin, [drill], { input: script });
    if (load.status !== 0) {
      throw new OpsTargetError(`导入失败：${redact(String(load.stderr ?? ""), [target.password, admin.password])}`);
    }
    const verified = verifyClone((statement) => sql(admin, statement), target.database, drill);
    const drillTables = verified.targetTables;
    const drillMigrations = verified.targetMigrations;
    const rows = verified.sampled;
    const certificateFile = arg('ai-retention-certificates');
    const certificates = certificateFile ? readRetentionCertificates(path.resolve(ROOT, certificateFile)) : undefined;
    assertRestoreAiBarrier(statement => sql(admin, statement), drill,
      crypto.createHash('sha256').update(body).digest('hex'), certificates, process.env.OPS_AI_RETENTION_PUBLIC_KEY);

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
