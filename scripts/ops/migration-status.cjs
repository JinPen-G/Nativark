"use strict";

/**
 * OPS-01A `migration-status`：只读的迁移状态检查。
 *
 * 校验已应用 SQL 的原始字节及 AI scope 结构，再跑 `prisma migrate status`，不跑 `migrate dev`
 * 或 `migrate deploy`：状态检查的价值就在于「先知道差什么，再决定动不动」。
 * 把检查和应用绑在一起，等于每次想看状态都顺手改了库。
 */

const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { redact } = require("./dedicated-env.cjs");
const { isOriginalB02MigrationChain, originalB02BridgeMigrationNames } = require("./ai-native-b02-upgrade-core.cjs");
const { ROOT, loadDatabaseUrl, requireTarget, log, fail, sql } = require("./runtime.cjs");

const API_DIR = path.join(ROOT, "apps", "api");

/** Applied names alone cannot establish the deployed version after historical SQL
 * repairs. Observe receipts only: never resolve/checksum-rewrite or replay DDL. */
function verifyAppliedMigrationBytes(target) {
  const exists = sql(target, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '_prisma_migrations'", { database: target.database });
  if (exists === "0") throw new Error("目标库尚无迁移收据，不能判为已同步；本检查不会初始化数据库");
  if (exists !== "1") throw new Error("迁移记录表状态无法核实");
  const raw = sql(target, "SELECT JSON_OBJECT('name', migration_name, 'checksum', checksum) FROM `_prisma_migrations` WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name, id LIMIT 10001", { database: target.database });
  const rows = raw ? raw.split(/\r?\n/u).map(line => JSON.parse(line)) : [];
  if (rows.length > 10000) throw new Error("迁移记录超过核查上限，未确认同步");
  const directory = path.join(API_DIR, "prisma", "migrations");
  const local = new Map(fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => [entry.name, path.join(directory, entry.name, "migration.sql")]));
  const seen = new Set(), bridgedOriginal = originalB02BridgeMigrationNames(rows);
  for (const row of rows) {
    if (!row || typeof row.name !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(row.name)
      || typeof row.checksum !== "string" || !/^[a-f0-9]{64}$/u.test(row.checksum))
      throw new Error("迁移收据损坏，未确认同步");
    if (seen.has(row.name)) throw new Error(`迁移存在多份成功收据：${row.name}`);
    seen.add(row.name);
    const file = local.get(row.name);
    if (!file || !fs.existsSync(file)) throw new Error(`已应用迁移缺少本地原文：${row.name}`);
    const actual = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    // The verified entire original subset retains its recorded SQL bytes. Never
    // replace those checksums with current/EOL-normalized files after a bridge.
    if (bridgedOriginal?.has(row.name)) continue;
    if (actual !== row.checksum) {
      // Recognize the entire original chain, not one familiar B02 checksum or
      // normalized line endings. Provenance never bypasses the drift gate.
      if (isOriginalB02MigrationChain(rows)) throw new Error('已识别 可追溯原分支/正式归档的178条独立B02原迁移收据；不是当前迁移链已同步，须在隔离克隆完成非空桥接。保留原字节/收据，不自动 deploy、resolve 或改 checksum');
      throw new Error(`已应用迁移与本地 SQL 字节不一致：${row.name}；保留原收据，先在克隆库核对升级方案，不自动 resolve 或重写 checksum`);
    }
  }
  log(bridgedOriginal ? `  ✓ 原178条B02收据字节保留；其余${rows.length - 178}条当前增量字节一致，仍须核scope保全来源`
    : `  ✓ ${rows.length} 条已应用迁移的 SQL 字节与原收据一致`);
  return { applied: seen, originalB02Bridge: Boolean(bridgedOriginal) };
}

/** Recognise the old standalone B02 shape without reading business rows. Passing
 * this narrow guard is not a full schema diff, data upgrade or acceptance. */
function verifyAiScopeShape(target, scopeExpected = false) {
  const raw = sql(target, `SELECT JSON_OBJECT(
    'tables', (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_scopes'),
    'legacyColumns', (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_scopes' AND COLUMN_NAME = 'updatedAt'),
    'legacyIndexes', (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_scopes' AND INDEX_NAME IN ('ai_scopes_scope_key', 'ai_scopes_owner_idx')),
    'shapeGuards', (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_scopes' AND CONSTRAINT_NAME = 'ai_scopes_shape' AND CONSTRAINT_TYPE = 'CHECK' AND ENFORCED = 'YES'))`, { database: target.database });
  const state = JSON.parse(raw);
  if (!state || ![state.tables, state.legacyColumns, state.legacyIndexes, state.shapeGuards]
    .every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("AI scope 结构无法核实");
  if (state.tables === 0) {
    if (scopeExpected) throw new Error("已有 AI 迁移收据但缺失 scope 表，不能判为未部署或已同步");
    return; // No AI scope has been deployed yet.
  }
  if (state.tables !== 1 || state.legacyColumns !== 0 || state.legacyIndexes !== 0 || state.shapeGuards !== 1)
    throw new Error("AI scope 存在旧 B02 结构或缺少已启用的 shape CHECK；必须另行核对非空数据升级，不能据迁移名称判为兼容。不会改写 scopeKey、归属或旧行");
  log("  ✓ 未发现旧 B02 scope 结构标记，shape CHECK 已启用（不替代完整 drift/数据验证）");
}

/** A retained original checksum is acceptable only with a completed, physically
 * verified bridge. No old source/owner data is repaired by a status read. */
function verifyOriginalB02ScopeProvenance(target) {
  const raw = sql(target, `SELECT JSON_OBJECT(
    'columns', (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_legacy_b02_scopes'),
    'workTables', (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('ai_b02_scope_bridge_work', '_ai_b02_prepare_check', '_ai_b02_project_check')),
    'invalidOrigins', (SELECT COUNT(*) FROM ai_legacy_b02_scopes WHERE sourceSqlSha256 <> (SELECT checksum FROM _prisma_migrations
      WHERE migration_name = '20261003160000_ai_provider_profiles' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)),
    'missingCanonical', (SELECT COUNT(*) FROM ai_legacy_b02_scopes a LEFT JOIN ai_scopes c ON BINARY c.id = BINARY a.id
      WHERE c.id IS NULL OR NOT (BINARY c.kind <=> BINARY a.kind) OR NOT (BINARY c.tenantId <=> BINARY a.tenantId)
        OR NOT (BINARY c.workspaceId <=> BINARY a.workspaceId) OR NOT (c.createdAt <=> a.createdAt)))`, { database: target.database });
  const state = JSON.parse(raw);
  if (!state || state.columns !== 8 || state.workTables !== 0 || state.invalidOrigins !== 0 || state.missingCanonical !== 0)
    throw new Error('B02桥接原文/当前scope关联或中断现场未核清；保留原收据，不自动修复或判同步');
  log('  ✓ 原B02 scope来源表及同ID/归属关联已核实；原键/时间仍留源，不授执行权');
}

function prisma(args, target) {
  const run = spawnSync("npx", ["prisma", ...args], {
    cwd: API_DIR,
    encoding: "utf8",
    shell: true,
    // 只把这一条连接串交给 prisma；不继承可能指向别处的其他 DB 变量。
    env: { ...process.env, DATABASE_URL: loadDatabaseUrl() }
  });
  const output = redact(`${run.stdout ?? ""}${run.stderr ?? ""}`, [target.password]);
  return { status: run.status, output };
}

void (() => {
  let target;
  try {
    target = requireTarget();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  log(`OPS-01A 迁移状态检查（只读）：${target.database} @ ${target.host}:${target.port}`);

  const validate = prisma(["validate"], target);
  log(validate.output.trim());
  if (validate.status !== 0) fail("Prisma schema 校验失败；先修 schema，再谈迁移与恢复");

  try {
    const { applied, originalB02Bridge } = verifyAppliedMigrationBytes(target);
    verifyAiScopeShape(target, applied.has("20261003060000_ai_task_foundation")
      || applied.has("20261003160000_ai_provider_profiles"));
    if (originalB02Bridge) verifyOriginalB02ScopeProvenance(target);
  } catch (error) {
    fail(error instanceof Error ? error.message : "迁移兼容核查失败", [target.password]);
    return;
  }

  const status = prisma(["migrate", "status"], target);
  log(status.output.trim());
  if (status.status !== 0) {
    // 有待应用迁移时 prisma 也返回非零。这不是脚本错误，而是**需要人工决定**：
    // 是先备份再 deploy，还是这套库根本不该被推进。因此如实退出非零并说明选项。
    console.error([
      "",
      "✗ 迁移状态非「已同步」。可选处置（本脚本不自动执行任何一项）：",
      "  1. 只是落后：先 ops:backup 留一份可恢复备份，再由人工执行 prisma migrate deploy；",
      "  2. 迁移失败中断：不要用 schema 回滚冒充数据恢复——先 ops:restore-drill 验证备份可用，",
      "     再决定是修复迁移还是把已验证备份恢复到新库并切换连接；",
      "  3. 目标库不该被推进：换目标，不要在这套库上继续。"
    ].join("\n"));
    process.exit(1);
  }
  log("\n✓ 迁移记录和 SQL 字节已同步；完整结构/数据兼容与业务验收仍需单独验证");
})();
