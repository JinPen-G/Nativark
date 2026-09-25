// MEMBER-BENEFIT-RISK-01：只读 rental_os 源库并恢复到本次专用克隆，再运行会员风险真库验收。
// 业务数据、风险记录和并发写入均只发生在克隆库；清理范围仅为本次创建的唯一库名。
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const runtime = require("../../scripts/ops/runtime.cjs");
const { rewriteBackupForTarget } = require("../../scripts/ops/restore-core.cjs");
const { buildDatabaseUrl, redact } = require("../../scripts/ops/dedicated-env.cjs");

const root = path.resolve(__dirname, "../..");
const raw = new URL(runtime.loadDatabaseUrl());
if (
  !["localhost", "127.0.0.1"].includes(raw.hostname) ||
  raw.pathname !== "/rental_os" ||
  (raw.port && raw.port !== "3306")
) {
  throw Error("会员风险真库专项只允许本机 rental_os 作为只读克隆源");
}

const source = runtime.assertContainerEndpoint({
  database: "rental_os",
  host: raw.hostname,
  port: 3306,
  user: decodeURIComponent(raw.username),
  password: decodeURIComponent(raw.password)
});
const selectedDatabase = runtime.sql(source, "SELECT DATABASE()", { database: "rental_os" });
if (selectedDatabase !== "rental_os") throw Error("会员风险真库专项连接未落到只读源库 rental_os");
const admin = runtime.requireAdminTarget(source);
const cloneName = `rental_os_dedicated_member_risk_${Date.now()}`;
if (!/^rental_os_dedicated_member_risk_\d+$/u.test(cloneName)) throw Error("会员风险克隆库名不合法");
const clone = { ...admin, database: cloneName };
const cloneUrl = buildDatabaseUrl(raw.href, {
  user: admin.user,
  password: admin.password,
  database: cloneName
});
let created = false;
let temporaryBackupDirectory;

try {
  temporaryBackupDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rental-os-member-risk-"));
  const dump = runtime.runMysql(
    "mysqldump",
    source,
    ["--single-transaction", "--quick", "--hex-blob", "--routines", "--events", "--triggers", "--databases", source.database],
    { capture: true }
  );
  if (dump.status !== 0) throw Error(redact(String(dump.stderr), [admin.password, source.password]));
  const backupBytes = Buffer.from(dump.stdout);
  if (!backupBytes.toString("utf8").includes("Dump completed")) throw Error("会员风险真库专项备份不完整");

  const backup = path.join(temporaryBackupDirectory, "source.sql");
  fs.writeFileSync(backup, backupBytes);
  const backupHash = createHash("sha256").update(backupBytes).digest("hex");
  fs.writeFileSync(`${backup}.sha256`, `${backupHash}  source.sql\n`);
  if (createHash("sha256").update(fs.readFileSync(backup)).digest("hex") !== backupHash) {
    throw Error("会员风险专项临时备份校验失败");
  }
  console.log("会员风险专项临时备份完成", backupBytes.length, "字节；测试结束后删除");

  const existing = runtime.sql(
    admin,
    `SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${cloneName}'`
  );
  if (existing !== "0") throw Error("专用克隆库已存在，拒绝覆盖");
  runtime.sql(admin, `CREATE DATABASE \`${cloneName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;

  const restored = runtime.runMysql("mysql", clone, [cloneName], {
    input: rewriteBackupForTarget(backupBytes.toString("utf8"), source.database, cloneName)
  });
  if (restored.status !== 0) throw Error(redact(String(restored.stderr), [admin.password, source.password]));

  const env = { ...process.env, DATABASE_URL: cloneUrl };
  const migration = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--schema",
      path.join(root, "apps/api/prisma/schema.prisma")
    ],
    { env, cwd: root, encoding: "utf8" }
  );
  console.log(redact(migration.stdout + migration.stderr, [admin.password, source.password]));
  if (migration.status !== 0) throw Error("会员风险专项克隆库迁移失败");

  const test = spawnSync(process.execPath, [path.join(root, "tests/rental-membership-risk-db.test.cjs")], {
    env,
    cwd: root,
    encoding: "utf8"
  });
  console.log(redact(test.stdout + test.stderr, [admin.password, source.password]));
  if (test.status !== 0) throw Error("会员风险真库专项失败");
  console.log("PASS member risk scope and row-lock concurrency on a dedicated clone");
} catch (error) {
  console.error(redact(error.message, [admin.password, source.password]));
  process.exitCode = 1;
} finally {
  try {
    if (created) {
      runtime.sql(admin, `DROP DATABASE \`${cloneName}\``);
      const remaining = runtime.sql(
        admin,
        `SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${cloneName}'`
      );
      if (remaining !== "0") throw Error(`专用克隆库清理未完成：${cloneName}`);
      console.log("已删除本次创建的会员风险克隆库", cloneName);
    }
  } finally {
    if (temporaryBackupDirectory) {
      for (const name of ["source.sql", "source.sql.sha256"]) {
        const file = path.join(temporaryBackupDirectory, name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      fs.rmdirSync(temporaryBackupDirectory);
      console.log("已删除会员风险专项临时备份");
    }
  }
}
