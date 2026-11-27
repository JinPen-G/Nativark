"use strict";
const fs = require("node:fs"), path = require("node:path"), { spawnSync, execFileSync } = require("node:child_process");

/** Current public relations and immutable mixed-installation SQL have distinct
 * sources. Neither reading this material nor comparing it executes a migration. */
function publicAiSchemaHistory() {
  const root = path.resolve(__dirname, "../../.."), assert = require("node:assert/strict");
  const { createHash } = require("node:crypto");
  const { createControllerSourceLoader } = require("../../../scripts/controller-sources.cjs");
  const loader = createControllerSourceLoader(root);
  const data = loader.load(loader.resolveSource(__filename, "@rental-os/ai-native-data/public-data", true));
  const files = new Map(data.PUBLIC_AI_DATA_FILES.map(asset => [asset.file,
    fs.readFileSync(path.join(root, "packages/ai-native-data", asset.file))]));
  const contribution = data.createPublicAiDataContribution(files);
  const provenance = JSON.parse(files.get("prisma-public/provenance.json").toString("utf8"));
  const revision = provenance.source.commit;
  assert.match(revision, /^[a-f0-9]{40}$/u);
  const schema = data.composePublicAiPrismaSchema(
    fs.readFileSync(path.join(root, "apps/platform-api/prisma/schema.prisma"), "utf8"), contribution);
  const git = args => execFileSync("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const migrations = git(["ls-tree", "-r", "--name-only", `${revision}:apps/api/prisma/migrations`])
    .toString("utf8").trim().split("\n").filter(file => /^[0-9]{14}_[A-Za-z0-9_]+\/migration\.sql$/u.test(file)).sort();
  assert.ok(migrations.length, "The fixed original migration history must exist");
  const migrationPath = name => {
    assert.ok(migrations.includes(`${name}/migration.sql`), `Original migration is missing: ${name}`);
    return `${revision}:apps/api/prisma/migrations/${name}/migration.sql`;
  };
  const migration = name => {
    const bytes = git(["show", migrationPath(name)]);
    const original = provenance.sourceMigrations.find(item => item.originalName === name);
    if (original) assert.equal(createHash("sha256").update(bytes).digest("hex"), original.sha256,
      "The original SQL must match the public contribution's provenance");
    return bytes.toString("utf8");
  };
  const history = ({ before, exclude } = {}) => {
    if (before) migrationPath(before);
    if (exclude) migrationPath(exclude);
    const selected = migrations.filter(file => (!before || file.split("/")[0] < before)
      && file.split("/")[0] !== exclude);
    assert.ok(selected.length, "The requested original history must not be empty");
    return git(["show", ...selected.map(file => `${revision}:apps/api/prisma/migrations/${file}`)]).toString("utf8");
  };
  return { schema, revision, migration, history };
}

/** Parse the selected schema with the same official WASM used by the existing
 * source loader. This produces metadata only, with no generated disk Client. */
function prismaSchemaWasm() {
  const assert = require("node:assert/strict"), { createRequire } = require("node:module");
  assert.equal(require("prisma/package.json").version, "5.22.0");
  const file = require.resolve("prisma/build/index.js"), cli = fs.readFileSync(file, "utf8");
  const start = cli.indexOf("var yI=S("), end = cli.indexOf(";var bI=S(", start);
  assert.ok(start >= 0 && end > start, "The original Prisma WASM wrapper must exist");
  const S = (initialize, cache) => () => {
    if (!cache) { cache = { exports: {} }; initialize(cache.exports, cache); }
    return cache.exports;
  };
  const wasm = new Function("S", "require", "__dirname", cli.slice(start, end) + ";return yI();")(
    S, createRequire(file), path.dirname(file));
  return wasm;
}
function prismaDatamodel(schema) {
  return JSON.parse(prismaSchemaWasm().get_dmmf(JSON.stringify({ prismaSchema: schema, noColor: true }))).datamodel;
}

/** Uses the installed Prisma validator and the same Schema Engine diff RPC as
 * the CLI. Only datamodel strings are accepted, with no datasource targets,
 * environment discovery, generated Client, cache or SQL execution. */
function offlinePrismaSchema(schema, before) {
  const assert = require("node:assert/strict"), wasm = prismaSchemaWasm();
  wasm.validate(JSON.stringify({ prismaSchema: schema, noColor: true }));
  const validation = "Prisma 5.22 schema is valid (official WASM).";
  if (before === undefined) return { validation, diff: undefined, violations: "" };
  wasm.validate(JSON.stringify({ prismaSchema: before, noColor: true }));
  assert.equal(require("@prisma/engines/package.json").version, "5.22.0");
  const env = { DATABASE_URL: "mysql://offline:offline@127.0.0.1:1/rental_os_offline" };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "AI_OFFLINE_WRITE_ROOT"])
    if (process.env[key]) env[key] = process.env[key];
  const preload = path.join(__dirname, "prisma-offline-preload.cjs");
  // Keep the existing synchronous helper contract for all original callers.
  // The short-lived Node process supplies the engine's print acknowledgement.
  const code = `const fs=require('node:fs'),audit=[];
    fs.appendFileSync=(_file,value)=>audit.push(String(value));
    require(${JSON.stringify(preload)});
    (${schemaDiff.toString()})(${JSON.stringify(schema)},${JSON.stringify(before)})
      .then(diff=>{if(audit.length)throw Error(audit.join(''));console.log(JSON.stringify({diff,violations:''}));})
      .catch(error=>{console.error(error);process.exitCode=1;});`;
  const result = spawnSync(process.execPath, ["--no-node-snapshot", "--no-compilation-cache", "-"], {
    cwd: path.resolve(__dirname, "../../.."), input: code, env, windowsHide: true,
    encoding: "utf8", timeout: 65000, maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.status !== 0)
    throw new Error(`Offline schema diff failed: ${result.error?.message ?? result.stderr}`);
  const answer = JSON.parse(result.stdout);
  assert.equal(typeof answer.diff, "string");
  assert.equal(answer.violations, "");
  // Prisma's CLI prints its empty command result after the engine's print RPC.
  // Preserve that final newline for the original byte-for-byte SQL assertions.
  return { validation, diff: answer.diff + "\n", violations: answer.violations };
}
async function schemaDiff(schema, before) {
  const fs = require("node:fs"), path = require("node:path"), { spawn } = require("node:child_process");
  const target = process.platform === "win32" ? "windows"
    : await require("@prisma/get-platform").getBinaryTargetForCurrentPlatform();
  const binary = path.join(path.dirname(require.resolve("@prisma/engines/package.json")),
    `schema-engine-${target}${target === "windows" ? ".exe" : ""}`);
  if (!fs.statSync(binary).isFile()) throw new Error("The installed Schema Engine must exist; downloads are not permitted");
  const env = { DATABASE_URL: "mysql://offline:offline@127.0.0.1:1/rental_os_offline" };
  for (const key of ["PATH", "SystemRoot", "WINDIR"]) if (process.env[key]) env[key] = process.env[key];
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env });
    const lines = require("node:readline").createInterface({ input: child.stdout });
    let output = "", bytes = 0, completed = false, failure;
    const stop = error => { failure ??= error; child.kill(); };
    const timeout = setTimeout(() => stop(new Error("Offline schema diff timed out")), 60000);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", value => {
      bytes += value.length;
      if (bytes > 8 * 1024 * 1024) stop(new Error("Offline schema diff exceeded its output limit"));
    });
    child.on("error", error => { failure ??= error; });
    child.stdin.on("error", error => { if (!completed) stop(error); });
    lines.on("line", line => {
      try {
        const message = JSON.parse(line);
        if (message.method === "print" && Number.isSafeInteger(message.id) && typeof message.params?.content === "string") {
          output += message.params.content + "\n";
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }) + "\n");
        } else if (message.id === 1 && message.result?.exitCode === 0) {
          completed = true; child.kill();
        } else throw new Error("Offline schema diff failed: " + JSON.stringify(message.error ?? message));
      } catch (error) { stop(error); }
    });
    child.once("close", () => {
      clearTimeout(timeout); lines.close();
      if (failure) reject(failure);
      else if (!completed) reject(new Error("Schema Engine exited without the original diff result"));
      else resolve(output);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "diff", params: {
      from: { tag: "schemaDatamodel", files: [{ path: "before.prisma", content: before }] },
      to: { tag: "schemaDatamodel", files: [{ path: "schema.prisma", content: schema }] }, script: true
    } }) + "\n");
  });
}
module.exports = { offlinePrismaSchema, publicAiSchemaHistory, prismaDatamodel };
