"use strict";
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
process.chdir(root);
require("dotenv").config({ path: path.join(root, ".env") });
const { parseDatabaseUrl, resolveDedicatedTarget, buildDatabaseUrl, quoteSqlString, redact } = require(path.join(root, "scripts/ops/dedicated-env.cjs"));
const { assertContainerEndpoint, requireAdminTarget, runMysql, sql } = require(path.join(root, "scripts/ops/runtime.cjs"));
const { rewriteBackupForTarget, verifyClone } = require(path.join(root, "scripts/ops/restore-core.cjs"));
let secrets = [];
try {
  const sourceUrl = process.env.DATABASE_URL;
  const source = assertContainerEndpoint(parseDatabaseUrl(sourceUrl));
  if (source.database !== "rental_os") throw new Error("Unexpected source database");
  const admin = requireAdminTarget(source);
  secrets = [source.password, admin.password];
  const database = "rental_os_sandbox_local_" + new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const cloneUrl = buildDatabaseUrl(sourceUrl, { user: source.user, password: source.password, database });
  resolveDedicatedTarget(cloneUrl);
  if (sql(admin, `SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${database}'`) !== "0") throw new Error("Target already exists");
  const dump = runMysql("mysqldump", source, ["--single-transaction", "--quick", "--routines", "--events", "--triggers", "--no-tablespaces", "--set-gtid-purged=OFF", "--databases", source.database], { capture: true });
  if (dump.status !== 0) throw new Error("Dump failed: " + dump.stderr);
  const body = dump.stdout;
  if (!body?.length || !body.toString("utf8").includes("Dump completed")) throw new Error("Incomplete dump");
  const script = rewriteBackupForTarget(body.toString("utf8"), source.database, database);
  sql(admin, `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log("Created dedicated clone:", database);
  const load = runMysql("mysql", admin, [database], { input: script });
  if (load.status !== 0) throw new Error("Import failed: " + load.stderr);
  const verified = verifyClone((statement) => sql(admin, statement), source.database, database);
  // Verify every base-table row count, not only the existing helper's sample.
  const tables = sql(admin, `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${source.database}' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`).split(/\r?\n/).filter(Boolean);
  for (const table of tables) {
    if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error("Unsupported table identifier");
    const a = sql(admin, `SELECT COUNT(*) FROM \`${source.database}\`.\`${table}\``);
    const b = sql(admin, `SELECT COUNT(*) FROM \`${database}\`.\`${table}\``);
    if (a !== b) throw new Error("Clone row-count mismatch: " + table);
  }
  sql(admin, `GRANT ALL PRIVILEGES ON \`${database}\`.* TO ${quoteSqlString(source.user)}@'%'`);
  const evidence = { database, source: source.database, dumpBytes: body.length, dumpSha256: crypto.createHash("sha256").update(body).digest("hex"), ...verified, allBaseTableCountsMatched: tables.length, sourceWrites: false };
  fs.writeFileSync(path.join(__dirname, "clone-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("Clone verified:", JSON.stringify(evidence));
  const reconcile = spawnSync(process.execPath, [path.join(root, "scripts/ops/reconcile-category-runtime.cjs")], { env: { ...process.env, DATABASE_URL: cloneUrl }, encoding: "utf8" });
  const result = redact(String(reconcile.stdout || "") + String(reconcile.stderr || ""), secrets);
  fs.writeFileSync(path.join(__dirname, "reconcile.log"), result);
  console.log(result);
  if (reconcile.status !== 0) throw new Error("Category reconcile failed; clone retained for inspection");
} catch (error) {
  console.error(redact(error.message, secrets));
  process.exitCode = 1;
}
