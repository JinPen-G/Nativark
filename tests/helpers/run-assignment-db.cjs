// 定向验证：只读本机开发库，备份后恢复到新专用库，验证完只删除本次创建的克隆库。
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const runtime = require("../../scripts/ops/runtime.cjs");
const {
  rewriteBackupForTarget,
} = require("../../scripts/ops/restore-core.cjs");
const { redact } = require("../../scripts/ops/dedicated-env.cjs");
const root = path.resolve(__dirname, "../..");
const raw = new URL(runtime.loadDatabaseUrl());
const sourceDatabase = raw.pathname.slice(1);
const dedicatedSource = sourceDatabase === "store_rental_claude" && process.env.RENTAL_ALLOW_DEDICATED_SOURCE === "1";
if (
  !["localhost", "127.0.0.1"].includes(raw.hostname) ||
  !["store_rental", "store_rental_claude"].includes(sourceDatabase) ||
  (sourceDatabase === "store_rental_claude" && !dedicatedSource) ||
  (raw.port && raw.port !== "3306")
)
  throw Error("只允许本机明确的 store_rental 开发源库，或显式授权的专用源库");
const source = runtime.assertContainerEndpoint({
  database: sourceDatabase,
  host: raw.hostname,
  port: 3306,
  user: decodeURIComponent(raw.username),
  password: decodeURIComponent(raw.password),
});
const admin = runtime.requireAdminTarget(source);
const cloneName = `store_rental_dedicated_assignment_${Date.now()}`;
if (!/^store_rental_dedicated_assignment_\d+$/.test(cloneName))
  throw Error("克隆库名不合法");
const clone = { ...admin, database: cloneName };
let created = false;
try {
  const dump = runtime.runMysql(
    "mysqldump",
    admin,
    [
      "--single-transaction",
      "--quick",
      "--hex-blob",
      "--databases",
      source.database,
    ],
    { capture: true },
  );
  if (dump.status !== 0)
    throw Error(redact(String(dump.stderr), [admin.password, source.password]));
  const bytes = Buffer.from(dump.stdout);
  if (!bytes.toString("utf8").includes("Dump completed"))
    throw Error("备份不完整");
  const backup = path.join(
    root,
    "backups",
    `store_rental-pre-assignment-${Date.now()}.sql`,
  );
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.writeFileSync(backup, bytes);
  fs.writeFileSync(
    backup + ".sha256",
    createHash("sha256").update(bytes).digest("hex"),
  );
  console.log("备份完成", path.basename(backup), bytes.length);
  const existing = runtime.sql(
    admin,
    `SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${cloneName}'`,
  );
  if (existing !== "0") throw Error("克隆库已存在，拒绝覆盖");
  runtime.sql(
    admin,
    `CREATE DATABASE \`${cloneName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  created = true;
  const restored = runtime.runMysql("mysql", clone, [cloneName], {
    input: rewriteBackupForTarget(
      bytes.toString("utf8"),
      source.database,
      cloneName,
    ),
  });
  if (restored.status !== 0)
    throw Error(redact(String(restored.stderr), [admin.password]));
  const cloneUrl = new URL(raw);
  cloneUrl.pathname = "/" + cloneName;
  cloneUrl.username = admin.user;
  cloneUrl.password = admin.password;
  const env = { ...process.env, DATABASE_URL: cloneUrl.href };
  const migration = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--schema",
      path.join(root, "apps/api/prisma/schema.prisma"),
    ],
    { env, cwd: root, encoding: "utf8" },
  );
  console.log(
    redact(migration.stdout + migration.stderr, [
      admin.password,
      source.password,
    ]),
  );
  if (migration.status !== 0) throw Error("克隆库迁移失败");
  const test = spawnSync(
    process.execPath,
    [path.join(root, "tests/rental-allocation-persistence.test.cjs")],
    { env, cwd: root, encoding: "utf8" },
  );
  console.log(
    redact(test.stdout + test.stderr, [admin.password, source.password]),
  );
  if (test.status !== 0) throw Error("定向数据库专项失败");
  console.log("PASS clone migration and allocation persistence");
} catch (e) {
  console.error(redact(e.message, [admin.password, source.password]));
  process.exitCode = 1;
} finally {
  if (created) {
    runtime.sql(admin, `DROP DATABASE \`${cloneName}\``);
    console.log("已删除本次验证克隆库", cloneName, "，备份保留");
  }
}
