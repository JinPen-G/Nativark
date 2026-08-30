const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * OPS-01C 专项：克隆库升级与回滚演练的契约。
 *
 * 行为层断言恢复内核与克隆库命名（无需真库）；源码层断言那几条一旦被破坏
 * 就会造成事故的性质：源库只读、回滚靠重建而不是 down migration、
 * 不停别人的服务、只删本次创建且形态正确的资源。
 */

const ROOT = path.resolve(__dirname, "..");
const env = require(path.join(ROOT, "scripts/ops/dedicated-env.cjs"));
const core = require(path.join(ROOT, "scripts/ops/restore-core.cjs"));
const { OpsTargetError } = env;

const ok = (m) => console.log(`  ✓ ${m}`);
const rejects = (fn, pattern, label) => {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof OpsTargetError, `${label}：应抛 OpsTargetError，实际 ${error?.name}`);
    assert.match(error.message, pattern, `${label}：实际「${error.message}」`);
    return true;
  }, label);
};

const SOURCE = "store_rental_claude";
const STAMP = new Date("2026-08-30T01:02:03.000Z");

void (() => {
  // ============ 1. 克隆库命名：种类 + 时间戳，且必须是新库 ============
  const upgrade = env.buildCloneDatabaseName(SOURCE, "upgrade", STAMP);
  const rollback = env.buildCloneDatabaseName(SOURCE, "rollback", STAMP);
  assert.equal(upgrade, "store_rental_claude_upgrade_20260830010203");
  assert.equal(rollback, "store_rental_claude_rollback_20260830010203");
  assert.notEqual(upgrade, rollback, "升级库与回滚库必须是两个不同的库——回滚不是把升级库改回去");
  assert.notEqual(upgrade, SOURCE, "克隆库不得与源库同名");
  for (const name of [upgrade, rollback]) {
    assert.ok(env.isOwnedCloneDatabase(name), `${name} 应被识别为本工具创建的克隆库`);
    assert.ok(name.length <= 64, "库名不得超过 MySQL 上限");
  }
  rejects(() => env.buildCloneDatabaseName(SOURCE, "prod"), /未知的克隆库种类/u, "非法种类");
  rejects(() => env.buildCloneDatabaseName("store_rental", "upgrade"), /共享或系统库/u, "为共享库生成克隆库");
  rejects(() => env.buildCloneDatabaseName("store_rental_prod_claude", "upgrade"), /生产\/共享环境标记/u, "源库带生产标记");
  ok("克隆库命名：种类与时间戳齐备、升级与回滚分库、共享/生产源库被拒");

  assert.equal(env.quoteSqlString("store_rental"), "'store_rental'");
  assert.equal(env.quoteSqlString("svc' OR 1=1 --"), "'svc'' OR 1=1 --'", "账号名必须安全编码后再进入 GRANT/REVOKE");
  rejects(() => env.quoteSqlString("bad\nuser"), /控制字符/u, "账号名控制字符");
  ok("SQL 字符串：账号名不能改变 GRANT/REVOKE 语句结构");

  const specialUrl = env.buildDatabaseUrl(
    "mysql://old:old@127.0.0.1:3306/store_rental_claude",
    { user: "svc.user", password: "p@ss:/?#%", database: upgrade }
  );
  const parsedSpecialUrl = new URL(specialUrl);
  assert.equal(decodeURIComponent(parsedSpecialUrl.username), "svc.user");
  assert.equal(decodeURIComponent(parsedSpecialUrl.password), "p@ss:/?#%", "特殊字符口令不得被二次编码");
  assert.equal(parsedSpecialUrl.pathname, `/${upgrade}`);
  ok("克隆库连接串：账号与特殊字符口令只编码一次，并准确切换库名");

  // ============ 2. 只有本工具形态的克隆库才允许被自动删除 ============
  for (const name of [
    SOURCE,                                        // 源库
    "store_rental",                                // 共享库
    "store_rental_claude_upgrade",                 // 缺时间戳
    "store_rental_claude_upgrade_2026",            // 时间戳位数不足
    "store_rental_prod_upgrade_20260830010203",    // 生产标记
    "app_upgrade_20260830010203"                   // 无专用标记
  ]) {
    assert.equal(env.isOwnedCloneDatabase(name), false, `${name} 不应被判为可自动删除`);
  }
  ok("清理判定：源库、共享库、生产标记与形态不符的库都不可自动删除");

  // ============ 3. 备份改写：三处都要改，且拒绝仍指向源库的产物 ============
  const dump = [
    "-- MySQL dump 10.13",
    `-- Host: 127.0.0.1    Database: ${SOURCE}`,
    "",
    `-- Current Database: \`${SOURCE}\``,
    "",
    `CREATE DATABASE /*!32312 IF NOT EXISTS*/ \`${SOURCE}\` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;`,
    `USE \`${SOURCE}\`;`,
    "CREATE TABLE `Tenant` (`id` varchar(191) NOT NULL);",
    `INSERT INTO \`${SOURCE}\`.\`Tenant\` VALUES ('t1');`,
    "-- Dump completed"
  ].join("\n");
  const rewritten = core.rewriteBackupForTarget(dump, SOURCE, upgrade);
  assert.match(rewritten, new RegExp(`USE \`${upgrade}\`;`, "u"), "USE 必须改写到克隆库");
  assert.equal(/CREATE DATABASE/u.test(rewritten), false, "CREATE DATABASE 整条应被删掉——库由调用方先建好");
  assert.match(rewritten, new RegExp(`INSERT INTO \`${upgrade}\`\\.`, "u"), "限定名必须改写，否则单条语句仍会落到源库");
  // 注释里的库名保留下来是对的：它们不会被执行，不该因此拒绝一份好备份。
  assert.match(rewritten, new RegExp(`-- Current Database: \`${SOURCE}\``, "u"), "注释无需改写");
  ok("备份改写：USE / CREATE DATABASE / 限定名三处都改，注释保留");

  rejects(
    () => core.rewriteBackupForTarget(dump, SOURCE, SOURCE),
    /目标库与源库同名/u,
    "目标库与源库同名"
  );
  rejects(() => core.rewriteBackupForTarget(dump, SOURCE, ""), /需要同时给出源库与目标库名/u, "缺目标库名");
  // 可执行的版本注释里若残留源库限定名，必须被判危险——它会被 MySQL 执行。
  const sneaky = `/*!40000 INSERT INTO \`${SOURCE}\`.\`Tenant\` VALUES ('x') */;`;
  rejects(
    () => core.rewriteBackupForTarget(sneaky.replace(`\`${SOURCE}\`.`, `\`${SOURCE}\` .`), SOURCE, upgrade),
    /可执行语句/u,
    "版本注释里残留源库引用"
  );
  ok("残留检查：同名目标、缺参数与可执行版本注释里的源库引用都被拒");

  // ============ 4. 克隆库校验：不一致必须失败，空抽样也必须失败 ============
  const stub = (counts) => (statement) => {
    if (/information_schema\.tables WHERE table_schema='([^']+)' AND table_name='([^']+)'/u.test(statement)) {
      const [, db, table] = statement.match(/table_schema='([^']+)' AND table_name='([^']+)'/u);
      return String(counts.tablesPresent?.[db]?.includes(table) ? 1 : 0);
    }
    if (/information_schema\.tables WHERE table_schema='([^']+)'/u.test(statement)) {
      const [, db] = statement.match(/table_schema='([^']+)'/u);
      return String(counts.tableCount[db]);
    }
    if (/_prisma_migrations/u.test(statement)) {
      const [, db] = statement.match(/`([^`]+)`\._prisma_migrations/u);
      return String(counts.migrations[db]);
    }
    const [, db] = statement.match(/`([^`]+)`\.`([^`]+)`/u);
    return String(counts.rows[db]);
  };
  const healthy = {
    tableCount: { [SOURCE]: 132, [upgrade]: 132 },
    migrations: { [SOURCE]: 68, [upgrade]: 68 },
    tablesPresent: { [upgrade]: ["Tenant"] },
    rows: { [SOURCE]: 127, [upgrade]: 127 }
  };
  const verified = core.verifyClone(stub(healthy), SOURCE, upgrade);
  assert.equal(verified.targetTables, 132);
  assert.equal(verified.targetMigrations, 68);
  assert.deepEqual(verified.sampled, ["Tenant=127"]);

  rejects(
    () => core.verifyClone(stub({ ...healthy, tableCount: { [SOURCE]: 132, [upgrade]: 0 } }), SOURCE, upgrade),
    /没有任何表/u,
    "克隆库没有表"
  );
  rejects(
    () => core.verifyClone(stub({ ...healthy, tableCount: { [SOURCE]: 132, [upgrade]: 131 } }), SOURCE, upgrade),
    /表数量不一致/u,
    "表数量不一致"
  );
  rejects(
    () => core.verifyClone(stub({ ...healthy, migrations: { [SOURCE]: 68, [upgrade]: 67 } }), SOURCE, upgrade),
    /迁移记录不一致/u,
    "迁移条数不一致"
  );
  rejects(
    () => core.verifyClone(stub({ ...healthy, rows: { [SOURCE]: 127, [upgrade]: 126 } }), SOURCE, upgrade),
    /行数不一致/u,
    "抽样行数不一致"
  );
  // 抽样一张都没比上：空抽样下的「行数一致」是空话，必须失败。
  rejects(
    () => core.verifyClone(stub({ ...healthy, tablesPresent: { [upgrade]: [] } }), SOURCE, upgrade),
    /抽样表在克隆库中全部不存在/u,
    "抽样表全缺"
  );
  // 升级演练会**故意**让克隆库比源库多出迁移，此时相等才是异常，因此可关掉该比对。
  const afterDeploy = core.verifyClone(
    stub({ ...healthy, migrations: { [SOURCE]: 68, [upgrade]: 72 } }),
    SOURCE,
    upgrade,
    { expectSameMigrations: false }
  );
  assert.equal(afterDeploy.targetMigrations, 72, "关掉迁移比对后仍应如实返回克隆库迁移条数");
  ok("克隆库校验：表数/迁移/行数不一致与空抽样均失败，升级后可按需跳过迁移比对");

  // ============ 5. 源码契约：源库只读、回滚靠重建、不动别人的服务 ============
  const drill = fs.readFileSync(path.join(ROOT, "scripts/ops/upgrade-drill.cjs"), "utf8");
  // 所有 DDL/DML 都只能落在克隆库上。出现对 target.database 的写入即为越界。
  for (const forbidden of [
    "DROP DATABASE `${target.database}`",
    "CREATE DATABASE `${target.database}`",
    "migrate reset",
    "db push"
  ]) {
    assert.equal(drill.includes(forbidden), false, `演练不得对源库或 schema 做破坏性操作：命中 ${forbidden}`);
  }
  assert.equal(
    /DROP DATABASE \\`\$\{target\.database\}/u.test(drill),
    false,
    "演练绝不允许删除源库"
  );
  // migrate deploy 的目标必须是克隆库连接串，不能是源库连接串。
  assert.match(drill, /DATABASE_URL: adminUrl/u, "migrate deploy 必须指向克隆库（管理凭据）");
  assert.match(drill, /buildDatabaseUrl\([\s\S]{0,120}database: upgradeDb/u, "克隆库连接串必须由共用 helper 安全改库名");
  assert.match(drill, /DATABASE_CONNECT_ON_START: "true"/u, "临时 API 必须在启动阶段强制连接克隆库");
  assert.match(drill, /sql\(target, "SELECT 1", \{ database: upgradeDb \}\)/u,
    "健康检查前必须用应用账号直连克隆库，不能把进程存活当数据库健康");
  assert.match(drill, /verifiedAfterDeploy = verifyClone/u, "migrate deploy 后必须再次核对关键表和抽样数据");
  // 回滚必须是「从同一份备份恢复到另一个新库」，不得写 down migration。
  assert.match(drill, /buildCloneDatabaseName\(target\.database, "rollback"\)/u, "回滚必须落在独立的新库上");
  assert.match(drill, /不写 down migration/u, "回滚策略必须显式声明不写 down migration");
  for (const token of ["migrate resolve", "migrate dev"]) {
    assert.equal(drill.includes(token), false, `回滚不得改写迁移记录或走开发迁移：命中 ${token}`);
  }
  ok("源码契约：源库只读、迁移只作用于克隆库、回滚靠重建而非 down migration");

  // ============ 6. 不停别人的服务；只删本次创建且形态正确的资源 ============
  assert.match(drill, /assertPortFree\(DRILL_PORT\)/u, "起 API 前必须确认端口空闲");
  assert.match(drill, /不会停止任何正在运行的服务/u, "端口占用时必须失败而不是腾位置");
  for (const forbidden of ["docker restart", "docker stop", "taskkill", "pkill", "process.kill(0"]) {
    assert.equal(drill.includes(forbidden), false, `演练不得停止外部进程：命中 ${forbidden}`);
  }
  assert.match(drill, /if \(!isOwnedCloneDatabase\(db\)\) throw new OpsTargetError/u, "删库前必须校验克隆库形态");
  assert.match(drill, /for \(const db of created\)/u, "只允许删除本次 created 列表内的库");
  assert.match(drill, /REVOKE ALL PRIVILEGES ON/u, "删库前必须回收授权——DROP DATABASE 不会清 mysql.db 的库级授权");
  assert.match(drill, /if \(keep\)[\s\S]*REVOKE ALL PRIVILEGES ON/u, "--keep 的人工清理指引也必须先给 REVOKE");
  assert.match(drill, /按设计\*\*保留\*\*供排查/u, "失败时必须保留克隆库并给出精确清理指引");
  assert.match(drill, /本次未创建任何克隆库，无残留/u, "未创建资源时必须明确说明无残留");
  ok("资源边界：端口占用即失败、不停外部进程、只删本次创建且形态正确的库并先回收授权");

  // ============ 7. 报告必须写明演练对象与未覆盖边界 ============
  assert.match(drill, /sourceDatabase: \{ name: target\.database, mutated: false/u, "报告必须声明源库未被修改");
  assert.match(drill, /manualCutover/u, "报告必须输出人工切换步骤");
  assert.match(drill, /upgradeExercised: newlyApplied > 0/u, "报告必须如实标注本次是否真的应用了新迁移");
  assert.match(drill, /notCovered/u, "报告必须写明未覆盖边界");
  ok("报告：源库只读、人工切换步骤、是否真的演练了升级、未覆盖边界均写明");

  console.log("\nOPS-01C 升级与回滚演练专项：全部通过");
})();
