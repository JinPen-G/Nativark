// ORDER-01A-2：在一次专用克隆库里验证续租快照、重连、事务回滚与优惠预算并发。
// 默认只允许从本机 rental_os 备份；复测时可显式指定带专用标记的源库，绝不把测试直接指向未知库。
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const runtime = require("../../scripts/ops/runtime.cjs");
const { rewriteBackupForTarget, verifyClone } = require("../../scripts/ops/restore-core.cjs");
const { redact } = require("../../scripts/ops/dedicated-env.cjs");

const root = path.resolve(__dirname, "../..");
const raw = new URL(runtime.loadDatabaseUrl());
const sourceDatabase = raw.pathname.slice(1);
const dedicatedSource = sourceDatabase === "rental_os_claude" && process.env.RENTAL_ALLOW_DEDICATED_SOURCE === "1";
if (
  !["localhost", "127.0.0.1"].includes(raw.hostname) ||
  !["rental_os", "rental_os_claude"].includes(sourceDatabase) ||
  (sourceDatabase === "rental_os_claude" && !dedicatedSource) ||
  (raw.port && raw.port !== "3306")
) {
  throw Error("续租真库专项只允许本机明确的 rental_os 开发源库，或显式授权的专用源库");
}

const source = runtime.assertContainerEndpoint({
  database: sourceDatabase,
  host: raw.hostname,
  port: 3306,
  user: decodeURIComponent(raw.username),
  password: decodeURIComponent(raw.password)
});
const admin = runtime.requireAdminTarget(source);
const cloneName = `rental_os_dedicated_renewal_${Date.now()}`;
if (!/^rental_os_dedicated_renewal_\d+$/.test(cloneName)) throw Error("续租专项克隆库名不合法");
const clone = { ...admin, database: cloneName };
let created = false;

const cloneUrl = new URL(raw);
cloneUrl.pathname = `/${cloneName}`;
cloneUrl.username = admin.user;
cloneUrl.password = admin.password;

try {
  const dump = runtime.runMysql(
    "mysqldump",
    admin,
    ["--single-transaction", "--quick", "--hex-blob", "--databases", source.database],
    { capture: true }
  );
  if (dump.status !== 0) throw Error(redact(String(dump.stderr), [admin.password, source.password]));
  const bytes = Buffer.from(dump.stdout);
  if (!bytes.toString("utf8").includes("Dump completed")) throw Error("续租专项备份不完整");
  const backup = path.join(root, "backups", `rental_os-pre-renewal-${Date.now()}.sql`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.writeFileSync(backup, bytes);
  fs.writeFileSync(`${backup}.sha256`, createHash("sha256").update(bytes).digest("hex"));
  console.log("续租专项备份完成", path.basename(backup), bytes.length);

  const existing = runtime.sql(admin, `SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${cloneName}'`);
  if (existing !== "0") throw Error("续租专项克隆库已存在，拒绝覆盖");
  runtime.sql(admin, `CREATE DATABASE \`${cloneName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;

  const restored = runtime.runMysql("mysql", clone, [cloneName], {
    input: rewriteBackupForTarget(bytes.toString("utf8"), source.database, cloneName)
  });
  if (restored.status !== 0) throw Error(redact(String(restored.stderr), [admin.password]));

  const before = verifyClone(
    (statement) => runtime.sql(admin, statement),
    source.database,
    cloneName
  );
  console.log("续租专项恢复校验", before.sampled.join(", "));

  const migration = spawnSync(
    process.execPath,
    [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(root, "apps/api/prisma/schema.prisma")],
    { env: { ...process.env, DATABASE_URL: cloneUrl.href }, cwd: root, encoding: "utf8" }
  );
  console.log(redact(migration.stdout + migration.stderr, [admin.password, source.password]));
  if (migration.status !== 0) throw Error("续租专项克隆库迁移失败");

  const test = spawnSync(process.execPath, [path.join(root, "tests/rental-renewal-persistence.test.cjs")], {
    env: { ...process.env, DATABASE_URL: cloneUrl.href },
    cwd: root,
    encoding: "utf8"
  });
  console.log(redact(test.stdout + test.stderr, [admin.password, source.password]));
  if (test.status !== 0) throw Error("续租快照与预算持久化专项失败");
  console.log("PASS ORDER-01A-2 renewal persistence on a dedicated clone");
} catch (error) {
  console.error(redact(error.message, [admin.password, source.password]));
  process.exitCode = 1;
} finally {
  if (created) {
    runtime.sql(admin, `DROP DATABASE \`${cloneName}\``);
    console.log("已删除本次续租专项克隆库", cloneName, "，备份保留");
  }
}
