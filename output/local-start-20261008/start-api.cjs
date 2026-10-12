"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
require(path.join(root, "node_modules/dotenv")).config({ path: path.join(root, ".env") });
const { buildDatabaseUrl, resolveDedicatedTarget } = require(path.join(root, "scripts/ops/dedicated-env.cjs"));
const original = process.argv[2] === "--original";
const evidence = JSON.parse(fs.readFileSync(path.join(__dirname, original ? "original-reconcile.json" : "clone-evidence.json"), "utf8"));
const source = new URL(process.env.DATABASE_URL);
const url = original ? process.env.DATABASE_URL : buildDatabaseUrl(process.env.DATABASE_URL, { user: decodeURIComponent(source.username), password: decodeURIComponent(source.password), database: evidence.database });
if (original) {
  if (!["localhost", "127.0.0.1"].includes(source.hostname) || source.pathname !== "/rental_os" || evidence.database !== "rental_os") throw new Error("Not the authorized original-local target");
} else resolveDedicatedTarget(url);
const reconcile = original ? evidence : JSON.parse(fs.readFileSync(path.join(__dirname, "reconcile.log"), "utf8").trim());
if (reconcile.result !== "passed") throw new Error("Clone reconcile has not passed");
const stdout = fs.openSync(path.join(__dirname, "api.stdout.log"), "a");
const stderr = fs.openSync(path.join(__dirname, "api.stderr.log"), "a");
const child = spawn(process.execPath, [path.join(root, "apps/api/dist/main.js")], { cwd: path.join(root, "apps/api"), env: { ...process.env, DATABASE_URL: url, API_PORT: "3000", RENTAL_DUE_JOBS_DISABLED: "1" }, detached: true, windowsHide: true, stdio: ["ignore", stdout, stderr] });
child.once("error", () => { console.error("API process failed to launch"); process.exitCode = 1; });
child.once("spawn", () => {
  fs.writeFileSync(path.join(__dirname, "api-process.json"), JSON.stringify({ pid: child.pid, database: evidence.database, port: 3000, dueJobsDisabled: true }, null, 2));
  console.log("API process launched:", child.pid, "database:", evidence.database);
  child.unref();
  fs.closeSync(stdout); fs.closeSync(stderr);
});
