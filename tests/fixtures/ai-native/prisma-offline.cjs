"use strict";
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { spawnSync } = require("node:child_process");

/** No generate/migrate/deploy command is exposed; validate and datamodel-to-datamodel diff only. */
function offlinePrismaSchema(schema, before) {
  const cli = require.resolve("prisma/build/index.js");
  const preload = path.join(__dirname, "prisma-offline-preload.cjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rental-os-ai-schema-"));
  const auditFile = path.join(directory, "offline-audit.log");
  try {
    fs.writeFileSync(auditFile, "");
    fs.writeFileSync(path.join(directory, "schema.prisma"), schema);
    if (before !== undefined) fs.writeFileSync(path.join(directory, "before.prisma"), before);
    const env = {};
    for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, {
      DATABASE_URL: "mysql://offline:offline@127.0.0.1:1/rental_os_offline",
      AI_OFFLINE_AUDIT: auditFile, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1",
      PRISMA_DISABLE_TELEMETRY: "1", NO_COLOR: "1"
    });
    const run = args => {
      const result = spawnSync(process.execPath, ["--require", preload, cli, ...args], { cwd: directory, env, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      const violations = fs.readFileSync(auditFile, "utf8");
      if (violations) throw new Error(`Offline guard triggered: ${violations}`);
      if (result.error || result.status !== 0) throw new Error(`Prisma ${args[0]} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
      if (/Environment variables loaded/iu.test(result.stdout)) throw new Error("Unexpected environment file loading");
      return result.stdout;
    };
    const validation = run(["validate", "--schema", "schema.prisma"]);
    const diff = before === undefined ? undefined : run(["migrate", "diff", "--from-schema-datamodel", "before.prisma", "--to-schema-datamodel", "schema.prisma", "--script"]);
    return { validation, diff, violations: fs.readFileSync(auditFile, "utf8") };
  } finally {
    // Only this successfully-created mkdtemp directory, never a prefix cleanup.
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
module.exports = { offlinePrismaSchema };
