"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { createRequire } = require("node:module"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), apiRequire = createRequire(path.join(root, "apps/api/package.json"));
const { generateLocalAiPrismaClient } = require("../scripts/ai-native-generate-local-prisma.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

test("generated Prisma package really resolves inside this worktree with current models", () => {
  const local = fs.realpathSync(path.join(root, "apps/api/node_modules/@prisma/client"));
  assert.ok(fs.realpathSync(apiRequire.resolve("@prisma/client")).startsWith(local + path.sep));
  const client = apiRequire("@prisma/client");
  for (const name of ["AiTask", "AiRun", "AiStep", "AiApproval", "AiApprovalConsumption", "RentalCategoryVersion"]) assert.equal(client.Prisma.ModelName[name], name);
  assert.equal(client.Prisma.PrismaClientKnownRequestError, require("@prisma/client").Prisma.PrismaClientKnownRequestError);
  const owner = JSON.parse(fs.readFileSync(path.join(local, ".rental-ai-client-owner.json"), "utf8"));
  assert.equal(owner.worktree, fs.realpathSync(root));
  assert.equal(owner.schemaHash, hash(fs.readFileSync(path.join(root, "apps/api/prisma/schema.prisma"), "utf8").replace(/\r\n/gu, "\n")));
  assert.equal(owner.generatorFormat, 2);
  for (const file of ["index.js", "index.d.ts", "default.js", "default.d.ts", "schema.prisma", "package.json"]) assert.equal(owner.files[file], hash(fs.readFileSync(path.join(local, file))));
});

test("up-to-date generation is an idempotent no-op and does not rewrite the shared client", () => {
  const shared = path.dirname(require.resolve("prisma/package.json"));
  const sharedClient = path.join(path.dirname(shared), ".prisma/client/index.d.ts");
  const before = hash(fs.readFileSync(sharedClient));
  const result = generateLocalAiPrismaClient();
  assert.equal(result.generated, false);
  assert.equal(hash(fs.readFileSync(sharedClient)), before);
});

test("generation guard blocks writes outside its temporary root including symlink destinations", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rental-os-ai-write-guard-"));
  const allowed = path.join(parent, "allowed"), outside = path.join(parent, "outside");
  fs.mkdirSync(allowed); fs.mkdirSync(outside);
  const sentinel = path.join(outside, "sentinel.txt"), audit = path.join(allowed, "audit.log");
  fs.writeFileSync(sentinel, "synthetic unchanged"); fs.writeFileSync(audit, "");
  fs.symlinkSync(outside, path.join(allowed, "link"), "junction");
  try {
    const preload = path.join(__dirname, "fixtures/ai-native/prisma-offline-preload.cjs");
    const env = { AI_OFFLINE_AUDIT: audit, AI_OFFLINE_WRITE_ROOT: allowed, SystemRoot: process.env.SystemRoot, PATH: process.env.PATH };
    const run = code => spawnSync(process.execPath, ["--require", preload, "-e", code], { cwd: allowed, env, encoding: "utf8", timeout: 10000 });
    const permitted = run("require('node:fs').writeFileSync('ok.txt', 'allowed')");
    assert.equal(permitted.status, 0, permitted.stderr);
    for (const code of [
      "require('node:fs').writeFileSync('../outside/sentinel.txt', 'changed')",
      "require('node:fs').writeFileSync('link/sentinel.txt', 'changed')",
      "require('node:fs').openSync('../outside/sentinel.txt', 'w')",
      "require('node:fs').renameSync('../outside/sentinel.txt', 'moved.txt')",
      "require('node:fs').promises.writeFile('../outside/new.txt', 'new')"
    ]) {
      const result = run(code);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /write-outside-temp/u);
    }
    assert.equal(fs.readFileSync(sentinel, "utf8"), "synthetic unchanged");
    assert.equal(fs.existsSync(path.join(outside, "new.txt")), false);
    assert.equal(fs.readFileSync(audit, "utf8").trim().split("\n").length, 5);
  } finally {
    // Explicitly remove our link first; never recurse into its target through a junction.
    fs.unlinkSync(path.join(allowed, "link"));
    for (const directory of [allowed, outside]) {
      for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
      fs.rmdirSync(directory);
    }
    fs.rmdirSync(parent);
    assert.equal(fs.existsSync(parent), false);
  }
});
