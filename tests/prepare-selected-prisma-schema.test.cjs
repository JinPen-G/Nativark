"use strict";
/** 首次构建的离线回归：最小原源码夹具没有 dist、node_modules 或生成 Client。
 * 只读锁定依赖，官方 WASM 只在内存解析 schema；所有夹具/输出集中在本树
 * output/.tmp/rental-lead-data，成功或失败均 finally 清理，不生成客户端或迁移。
 * node tests/prepare-selected-prisma-schema.test.cjs [--deps <node_modules>]
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--deps"), "只接受 --deps <node_modules>");
const deps = path.resolve(args[1] || path.join(root, "node_modules"));
const temporary = path.resolve(root, "output/.tmp/rental-lead-data");
const fixture = path.join(temporary, "source");
const script = "scripts/prepare-selected-prisma-schema.cjs";
const publicSchema = "apps/platform-api/prisma/schema.prisma";
const guard = path.join(root, "tests/fixtures/ai-native/prisma-offline-preload.cjs");
const sha = value => createHash("sha256").update(value).digest("hex");

function noLinkedAncestors(directory) {
  for (let at = directory; ; at = path.dirname(at)) {
    if (fs.existsSync(at)) assert.ok(fs.lstatSync(at).isDirectory() && !fs.lstatSync(at).isSymbolicLink(), at);
    if (path.dirname(at) === at) break;
  }
}
noLinkedAncestors(path.dirname(temporary));
assert.equal(fs.existsSync(temporary), false, "不接管已有临时工作目录");
fs.mkdirSync(temporary, { recursive: true });
const originalEnvironment = new Map();
for (const [key, value] of Object.entries({
  DATABASE_URL: "mysql://offline:offline@127.0.0.1:1/rental_os_offline",
  AI_OFFLINE_AUDIT: path.join(temporary, "audit.log"), AI_OFFLINE_WRITE_ROOT: temporary,
  TEMP: temporary, TMP: temporary,
})) {
  originalEnvironment.set(key, process.env[key]);
  process.env[key] = value;
}
const audit = process.env.AI_OFFLINE_AUDIT;
let completedGroups = 0;
try {
  require(guard);
  const copyOriginal = relative => {
    const output = path.join(fixture, relative);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(root, relative), output);
  };
  const restoreAfter = (relative, replacement, consume) => {
    const file = path.join(fixture, relative), original = fs.readFileSync(file);
    try { fs.writeFileSync(file, replacement); return consume(); }
    finally { fs.writeFileSync(file, original); }
  };
  const host = mode => path.join(fixture, "apps", mode === "platform" ? "platform-api" : "rental-api");
  const target = (mode, leaf) => path.join(host(mode), leaf);
  copyOriginal(script);
  copyOriginal(publicSchema);
  fs.mkdirSync(host("rental"), { recursive: true });
  const blocker = path.join(temporary, "no-business-runtime.cjs");
  fs.writeFileSync(blocker, `"use strict";
const Module = require("node:module"), load = Module._load;
Module._load = function(name, ...rest) {
  if (/(^|[\\\\/])dist([\\\\/]|$)|(^|[\\\\/])\\.prisma[\\\\/]client|(^|[\\\\/])@prisma[\\\\/]client($|[\\\\/])/u.test(name))
    throw new Error("first-build refused business dist/default Client: " + name);
  return load.call(this, name, ...rest);
};
`);
  const execute = parameters => spawnSync(process.execPath,
    ["--require", guard, "--require", blocker, path.join(fixture, script), ...parameters],
    { cwd: fixture, encoding: "utf8", timeout: 30_000, windowsHide: true, env: process.env });
  // The same hard blocker protects in-process fault injection as well as the real CLI.
  require(blocker);
  const api = require(path.join(fixture, script));
  const prepared = [];
  const expected = {
    platform: { models: 40, enums: 14, sha256: "f48640864789e6d4d7bd35c3ab7090c5b92e82eb4df6ed45c6c7e452cbb93411" },
    rental: { models: 161, enums: 19, sha256: "444f044e2899c4d82e13735ccfa73c3796e61fc5da572fcc2b44384f80020f4b" },
    "rental-ai": { models: 247, enums: 35, sha256: "04d22e39010c0a03c61f9a853dac45dc6250b92202f3378c79767f9e0cf754a0" },
  };
  const sourceFiles = [
    "packages/core-contracts/src/prisma.ts", "packages/core-contracts/src/manifest.ts",
    "packages/core-contracts/src/version.ts", "packages/rental-core/src/prisma-schema.ts",
    "packages/rental-core/src/prisma-public-relations.ts", "packages/rental-core/prisma/schema.prisma",
  ];
  for (const mode of Object.keys(expected)) {
    if (mode === "rental") {
      copyOriginal("package-lock.json");
      sourceFiles.forEach(copyOriginal);
    } else if (mode === "rental-ai") {
      for (const name of ["data", "artifacts", "prisma-schema", "prisma-relations"])
        copyOriginal(`packages/ai-native-data/src/${name}.ts`);
      // Exact registered original assets only; no runtime, original full schema or full tree copy.
      const artifacts = fs.readFileSync(path.join(root, "packages/ai-native-data/src/artifacts.ts"), "utf8");
      const files = [...artifacts.matchAll(/"file":\s*"(prisma\/[^"]+)"/gu)].map(match => match[1]);
      assert.ok(files.length > 2);
      files.forEach(file => copyOriginal("packages/ai-native-data/" + file));
    }
    const output = target(mode, "selected-" + mode);
    const dependencyDirectory = mode === "platform" ? path.join(temporary, "absent-dependencies") : deps;
    const result = execute(["--mode", mode, "--output", output, "--deps", dependencyDirectory]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.status, "schema-prepared");
    assert.equal(receipt.deployment, "not-evaluated");
    assert.equal(receipt.clientGenerated, false);
    assert.equal(receipt.clientOutput, path.join(host(mode), "generated/client"));
    assert.deepEqual(fs.readdirSync(output), ["schema.prisma"]);
    assert.equal(fs.existsSync(receipt.clientOutput), false);
    const bytes = fs.readFileSync(receipt.schema);
    assert.equal(receipt.schemaSha256, sha(bytes));
    assert.equal(receipt.schemaSha256, expected[mode].sha256);
    const repeated = api.main(["--mode", mode, "--output", target(mode, "repeat-" + mode), "--deps", dependencyDirectory]);
    assert.deepEqual(fs.readFileSync(repeated.schema), bytes, "同原材料必须生成相同字节");
    prepared.push({ mode, schema: bytes.toString("utf8"), sha256: receipt.schemaSha256 });
  }
  assert.equal(fs.existsSync(path.join(fixture, "node_modules")), false);
  assert.equal(fs.existsSync(path.join(fixture, "packages/rental-core/dist")), false);
  assert.equal(fs.existsSync(path.join(fixture, "apps/rental-api/generated")), false);

  const cliFile = path.join(deps, "prisma/build/index.js");
  assert.equal(JSON.parse(fs.readFileSync(path.join(deps, "prisma/package.json"), "utf8")).version, "5.22.0");
  const cli = fs.readFileSync(cliFile, "utf8"), start = cli.indexOf("var yI=S("), end = cli.indexOf(";var bI=S(", start);
  assert.ok(start >= 0 && end > start, "须使用原锁定的官方 WASM wrapper");
  const S = (initialize, cache) => () => {
    if (!cache) { cache = { exports: {} }; initialize(cache.exports, cache); }
    return cache.exports;
  };
  const wasm = new Function("S", "require", "__dirname", cli.slice(start, end) + ";return yI();")(
    S, createRequire(cliFile), path.dirname(cliFile));
  for (const item of prepared) {
    const dmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: item.schema, noColor: true })));
    assert.equal(dmmf.datamodel.models.length, expected[item.mode].models);
    assert.equal(dmmf.datamodel.enums.length, expected[item.mode].enums);
  }
  completedGroups++;

  const prepare = (output, mode = "rental") => api.prepareSelectedPrismaSchema({ mode, output, dependencies: deps });
  const preserved = target("rental", "preserved");
  fs.mkdirSync(preserved);
  fs.writeFileSync(path.join(preserved, "sentinel"), "keep");
  for (const output of [preserved, host("rental"), target("platform", "wrong-host"),
    path.join(temporary, "outside-host"), target("rental", "nested/child"), "relative-target"])
    assert.throws(() => prepare(output), /已存在|直接子目录|绝对路径/u);
  assert.equal(fs.readFileSync(path.join(preserved, "sentinel"), "utf8"), "keep");
  for (const parameters of [[], ["--mode", "wrong"], ["--mode", "platform", "--mode", "rental"],
    ["--mode", "rental", "--output"], ["--generate", "yes"]])
    assert.throws(() => api.main(parameters), /用法|须明确选择|绝对路径/u);
  const rejectedCli = execute(["--mode", "invalid", "--output", target("rental", "invalid")]);
  assert.equal(rejectedCli.status, 1);
  assert.equal(fs.existsSync(target("rental", "invalid")), false);
  const originalPublic = fs.readFileSync(path.join(fixture, publicSchema), "utf8");
  restoreAfter(publicSchema, originalPublic.replace("../generated/client", "../../generated/client"),
    () => assert.throws(() => prepare(target("platform", "bad-generator"), "platform"), /生成器须/u));
  assert.equal(fs.existsSync(target("platform", "bad-generator")), false);
  completedGroups++;

  const linkDestination = path.join(temporary, "link-destination");
  fs.mkdirSync(linkDestination);
  for (const link of [target("rental", "linked-target"), target("rental", "generated")]) {
    fs.symlinkSync(linkDestination, link, "junction");
    try { assert.throws(() => prepare(link.endsWith("generated") ? target("rental", "linked-client") : link), /链接|已存在/u); }
    finally { fs.unlinkSync(link); }
  }
  const originalHost = host("rental"), relocatedHost = path.join(temporary, "original-host");
  fs.renameSync(originalHost, relocatedHost);
  try {
    fs.symlinkSync(relocatedHost, originalHost, "junction");
    try { assert.throws(() => prepare(target("rental", "linked-host")), /链接/u); }
    finally { fs.unlinkSync(originalHost); }
  } finally { fs.renameSync(relocatedHost, originalHost); }
  assert.deepEqual(fs.readdirSync(linkDestination), []);
  completedGroups++;

  const aiSchema = "packages/ai-native-data/prisma/schema.prisma";
  restoreAfter(aiSchema, Buffer.concat([fs.readFileSync(path.join(fixture, aiSchema)), Buffer.from("\n// changed\n")]),
    () => assert.throws(() => prepare(target("rental", "changed-ai"), "rental-ai"), /摘要变化/u));
  assert.equal(fs.existsSync(target("rental", "changed-ai")), false);
  const pureSource = "packages/rental-core/src/prisma-schema.ts";
  const originalPureSource = fs.readFileSync(path.join(fixture, pureSource), "utf8");
  for (const forbidden of ["@prisma/client", "node:fs", "./not-allowlisted"]) {
    restoreAfter(pureSource, `import ${JSON.stringify(forbidden)};\n` + originalPureSource,
      () => assert.throws(() => prepare(target("rental", "forbidden-source")), /未允许|不在白名单/u));
    assert.equal(fs.existsSync(target("rental", "forbidden-source")), false);
  }
  const lock = JSON.parse(fs.readFileSync(path.join(fixture, "package-lock.json"), "utf8"));
  lock.packages["node_modules/typescript"].version = "0.0.0";
  restoreAfter("package-lock.json", JSON.stringify(lock),
    () => assert.throws(() => prepare(target("rental", "wrong-version")), /锁定版本不一致/u));
  assert.equal(fs.existsSync(target("rental", "wrong-version")), false);
  assert.throws(() => api.main(["--mode", "rental", "--output", target("rental", "no-dependency-fallback")]),
    error => error.code === "ENOENT");
  assert.equal(fs.existsSync(target("rental", "no-dependency-fallback")), false);
  completedGroups++;

  const failureTarget = target("platform", "failed-write"), write = fs.writeFileSync;
  let injected = false;
  fs.writeFileSync = function(file, bytes, ...rest) {
    if (typeof file === "number") {
      injected = true;
      write.call(this, file, Buffer.from("partial"));
      throw new Error("injected schema write failure");
    }
    return write.call(this, file, bytes, ...rest);
  };
  try { assert.throws(() => prepare(failureTarget, "platform"), /injected schema write failure/u); }
  finally { fs.writeFileSync = write; }
  assert.equal(injected, true);
  assert.equal(fs.existsSync(failureTarget), false, "部分 schema 和本次目录必须已清理");
  assert.equal(fs.readFileSync(path.join(preserved, "sentinel"), "utf8"), "keep");
  completedGroups++;
  assert.equal(fs.existsSync(audit) ? fs.readFileSync(audit, "utf8") : "", "", "不得触发环境/外部连接/越界写入");
  console.log(JSON.stringify({ passed: completedGroups, schemas: prepared.map(({ mode, sha256 }) => ({
    mode, sha256, models: expected[mode].models, enums: expected[mode].enums,
  })), defaultClient: false, businessDist: false, generatedClients: 0 }));
} finally {
  // This is the directory exclusively created above. Never follow any junction during cleanup.
  assert.equal(path.dirname(temporary), path.resolve(root, "output/.tmp"));
  noLinkedAncestors(temporary);
  fs.rmSync(temporary, { recursive: true, force: false });
  assert.equal(fs.existsSync(temporary), false);
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
