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

test("generation environment keeps both original preloads and worktree-local caches", () => {
  const script = path.join(root, "scripts/ai-native-generate-local-prisma.cjs");
  const context = { require: createRequire(script), module: { exports: {} }, __dirname: path.dirname(script), process };
  require("node:vm").runInNewContext(fs.readFileSync(script, "utf8") + '\nmodule.exports.environment = generationEnvironment;', context);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "rental-os-ai-env-")), childTemp = path.join(temporary, "tmp");
  fs.mkdirSync(childTemp);
  const audit = path.join(temporary, "audit.log"); fs.writeFileSync(audit, "");
  const env = context.module.exports.environment(temporary, audit, childTemp);
  for (const key of ["TEMP", "TMP", "TMPDIR", "XDG_CACHE_HOME", "npm_config_cache", "V8_COMPILE_CACHE_CACHE_DIR", "NODE_COMPILE_CACHE"]) {
    assert.equal(env[key], childTemp); assert.ok(path.isAbsolute(env[key]));
  }
  assert.equal(env.NODE_DISABLE_COMPILE_CACHE, "1"); assert.equal(env.DISABLE_V8_COMPILE_CACHE, "1"); assert.equal(env.TS_NODE_CACHE, "false");
  assert.equal(env.DATABASE_URL, "mysql://offline:offline@127.0.0.1:1/rental_os_offline");
  assert.equal(env.AI_OFFLINE_WRITE_ROOT, temporary); assert.equal(env.AI_OFFLINE_AUDIT, audit);
  const code = 'console.log(JSON.stringify(JSON.parse(process.env.TS_NODE_COMPILER_OPTIONS).paths))';
  const child = spawnSync(process.execPath, ["-e", code], { cwd: temporary, env, encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout)["@prisma/client"], ["apps/api/node_modules/@prisma/client/index.d.ts"]);
  assert.equal(fs.readFileSync(audit, "utf8"), "");
});

test("generator cleanup preserves junctions under the original write guard", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rental-os-ai-cleanup-"));
  const allowed = path.join(parent, "allowed"), outside = path.join(parent, "outside");
  fs.mkdirSync(allowed); fs.mkdirSync(outside);
  const generated = path.join(allowed, "generated"), plain = path.join(allowed, "plain");
  fs.mkdirSync(generated); fs.mkdirSync(plain);
  fs.writeFileSync(path.join(generated, "owned.txt"), "generated");
  fs.writeFileSync(path.join(plain, "owned.txt"), "generated");
  const sentinel = path.join(outside, "sentinel.txt"), audit = path.join(allowed, "audit.log");
  fs.writeFileSync(sentinel, "unchanged"); fs.writeFileSync(audit, "");
  const nested = path.join(generated, "node_modules"); fs.mkdirSync(nested);
  const link = path.join(nested, "runtime");
  fs.symlinkSync(outside, link, "junction");
  try {
    const script = path.join(root, "scripts/ai-native-generate-local-prisma.cjs");
    const code = String.raw`const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context={require:require('node:module').createRequire(${JSON.stringify(script)}),module:{exports:{}},__dirname:path.dirname(${JSON.stringify(script)}),process,console};
vm.runInNewContext(fs.readFileSync(${JSON.stringify(script)},'utf8')+'\n;module.exports.cleanup=removeOwnedDirectory;',context);
console.log(JSON.stringify({retained:context.module.exports.cleanup(${JSON.stringify(generated)}),removed:context.module.exports.cleanup(${JSON.stringify(plain)})}));`;
    const result = spawnSync(process.execPath, ["--require", path.join(__dirname, "fixtures/ai-native/prisma-offline-preload.cjs"), "-e", code], {
      cwd: allowed, env: { ...process.env, AI_OFFLINE_AUDIT: audit, AI_OFFLINE_WRITE_ROOT: allowed,
        DATABASE_URL: "mysql://offline:offline@127.0.0.1:1/rental_os_offline", NODE_DISABLE_COMPILE_CACHE: "1", DISABLE_V8_COMPILE_CACHE: "1" },
      encoding: "utf8", timeout: 10000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { retained: false, removed: true });
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(generated, "owned.txt")), false);
    assert.equal(fs.existsSync(plain), false);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "unchanged");
    assert.equal(fs.readFileSync(audit, "utf8"), "");
  } finally {
    if (fs.existsSync(link)) fs.unlinkSync(link);
    fs.rmSync(parent, { recursive: true, force: true });
  }
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
