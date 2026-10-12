"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
process.chdir(root);
require("dotenv").config();
const { parseDatabaseUrl, buildDatabaseUrl, resolveDedicatedTarget, quoteSqlString, redact } = require(path.join(root, "scripts/ops/dedicated-env.cjs"));
const { assertContainerEndpoint, requireAdminTarget, sql } = require(path.join(root, "scripts/ops/runtime.cjs"));
const { verifyClone } = require(path.join(root, "scripts/ops/restore-core.cjs"));
const database = "rental_os_sandbox_local_20261008094920";
let secrets = [];
try {
  const source = assertContainerEndpoint(parseDatabaseUrl(process.env.DATABASE_URL));
  if (source.database !== "rental_os") throw new Error("Unexpected source");
  const admin = requireAdminTarget(source);
  secrets = [source.password, admin.password];
  const cloneUrl = buildDatabaseUrl(process.env.DATABASE_URL, { user: source.user, password: source.password, database });
  resolveDedicatedTarget(cloneUrl);
  const verified = verifyClone((statement) => sql(admin, statement), source.database, database);
  const names = (db) => sql(admin, `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${db}' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`).split(/\r?\n/).filter(Boolean);
  const tables = names(source.database);
  if (JSON.stringify(tables) !== JSON.stringify(names(database))) throw new Error("Table names differ");
  if (tables.some((table) => !/^[A-Za-z0-9_]+$/.test(table))) throw new Error("Unsafe table name");
  for (let offset = 0; offset < tables.length; offset += 35) {
    const statements = tables.slice(offset, offset + 35).map((table) => `SELECT '${table}', (SELECT COUNT(*) FROM \`${source.database}\`.\`${table}\`), (SELECT COUNT(*) FROM \`${database}\`.\`${table}\`)`);
    const rows = sql(admin, statements.join(" UNION ALL ")).split(/\r?\n/);
    for (const row of rows) {
      const [table, a, b] = row.split("\t");
      if (!table || a !== b) throw new Error("Row-count mismatch: " + table);
    }
    console.log("Verified table counts:", Math.min(offset + 35, tables.length), "/", tables.length);
  }
  sql(admin, `GRANT ALL PRIVILEGES ON \`${database}\`.* TO ${quoteSqlString(source.user)}@'%'`);
  const evidence = { database, source: source.database, ...verified, allBaseTableCountsMatched: tables.length, sourceWrites: false, note: "Initial dump/import completed; interrupted per-table verification was replaced with batched verification. No dump contents retained." };
  fs.writeFileSync(path.join(__dirname, "clone-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("Clone verified:", JSON.stringify(evidence));
  const r = spawnSync(process.execPath, [path.join(root, "scripts/ops/reconcile-category-runtime.cjs")], { env: { ...process.env, DATABASE_URL: cloneUrl }, encoding: "utf8" });
  const result = redact(String(r.stdout || "") + String(r.stderr || ""), secrets);
  fs.writeFileSync(path.join(__dirname, "reconcile.log"), result);
  console.log(result);
  if (r.status !== 0) throw new Error("Reconcile failed; clone retained");
} catch (error) {
  console.error(redact(error.message, secrets));
  process.exitCode = 1;
}
