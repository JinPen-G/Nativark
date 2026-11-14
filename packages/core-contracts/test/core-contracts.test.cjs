"use strict";
/** 使用实际编译产物；测试包仅是格式夹具，不模拟已接通的业务宿主或授权。 */
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const taskRoot = path.join(repoRoot, "output/.tmp/core-contracts");
const dist = path.join(taskRoot, "dist");
const fixtureRoot = path.join(taskRoot, "fixtures");
const inside = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
let created = false;
let CoreManifestSchema, CorePackagePathSchema, CoreVersionRangeSchema, coreObjectKey,
  checkCoreCombination, inspectCorePackage;
before(() => {
  assert.equal(fs.existsSync(taskRoot), false, "已有临时目录须先核对归属，不能覆盖");
  let ancestor = path.dirname(taskRoot);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realRoot = fs.realpathSync(repoRoot), realAncestor = fs.realpathSync(ancestor);
  assert.ok(realAncestor === realRoot || inside(realRoot, realAncestor));
  fs.mkdirSync(taskRoot, { recursive: true });
  created = true;
  const config = ts.readConfigFile(path.join(packageRoot, "tsconfig.json"), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options, outDir: dist, incremental: false, baseUrl: packageRoot,
    paths: { zod: [path.dirname(require.resolve("zod/package.json"))] },
    typeRoots: [path.resolve(path.dirname(require.resolve("@types/node/package.json")), "..")]
  });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => repoRoot, getNewLine: () => "\n"
  }));
  const reverseImports = program.getSourceFiles().filter(file => {
    const name = path.resolve(file.fileName);
    return inside(repoRoot, name) && !inside(packageRoot, name) && !name.includes(`${path.sep}node_modules${path.sep}`);
  });
  assert.deepEqual(reverseImports.map(file => file.fileName), [], "合同包不能反向加载宿主或行业源码");
  assert.equal(program.emit().emitSkipped, false);
  ({ CoreManifestSchema, CorePackagePathSchema, CoreVersionRangeSchema, coreObjectKey,
    checkCoreCombination } = require(path.join(dist, "index.js")));
  ({ inspectCorePackage } = require(path.join(dist, "package.js")));
});
after(() => {
  if (!created) return;
  assert.ok(inside(fs.realpathSync(repoRoot), fs.realpathSync(taskRoot)));
  assert.equal(fs.lstatSync(taskRoot).isSymbolicLink(), false);
  fs.rmSync(taskRoot, { recursive: true });
  assert.equal(fs.existsSync(taskRoot), false);
});
const supported = { minInclusive: "0.1.0", maxExclusive: "0.2.0" };
const host = { platform: "0.1.0", contract: "0.1.0", node: "22.12.0", capabilities: {} };
const manifest = (id = "example-tickets") => ({
  manifestVersion: 1, id, name: "格式检查夹具", description: "只验证发布包结构，不是工单业务实现", author: "Example maintainer",
  version: "0.1.0", source: { repository: "https://example.invalid/example/tickets", commit: "a".repeat(40) },
  license: "MIT", compatibility: { platform: supported, contract: supported },
  runtime: { node: { minInclusive: "22.12.0", maxExclusive: "25.0.0" } },
  entries: { server: "server.cjs" },
  permissions: [{ resource: "ticket", action: "read", name: "查看工单" }],
  scope: { kind: "tenant" }, data: { version: "0.1.0", readable: supported, migrations: [] }, requires: []
});
let sequence = 0;
function fixture(value = manifest()) {
  const dir = path.join(fixtureRoot, String(++sequence));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "core.manifest.json"), JSON.stringify(value));
  fs.writeFileSync(path.join(dir, "server.cjs"), 'throw new Error("检查不能执行包内模块");');
  for (const file of ["README.md", "LICENSE", "CORE_GUIDE.md"]) fs.writeFileSync(path.join(dir, file), "格式夹具");
  return dir;
}

test("清单最小贡献和可选 AI 分开，未知字段及错误版本有结构化诊断", () => {
  assert.equal(CoreManifestSchema.parse(manifest()).entries.ai, undefined);
  for (const change of [
    { manifestVersion: 2 }, { id: "../rental" }, { id: "rental\n" }, { entries: { server: "../outside.js" } },
    { source: { repository: "not-a-url", commit: "a".repeat(40) } },
    { compatibility: { platform: { minInclusive: "latest", maxExclusive: "1.0.0" }, contract: supported } },
    { compatibility: { platform: { minInclusive: "1.0.0", maxExclusive: "0.1.0" }, contract: supported } },
    { autoAuthorizeTenant: true }
  ]) assert.equal(CoreManifestSchema.safeParse({ ...manifest(), ...change }).success, false);
  assert.equal(CoreVersionRangeSchema.safeParse({ minInclusive: "0.01.0", maxExclusive: "1.0.0" }).success, false);
  const duplicate = manifest();
  duplicate.permissions.push({ ...duplicate.permissions[0] });
  assert.equal(CoreManifestSchema.safeParse(duplicate).success, false);
});

test("无 Core、单 Core、多 Core，以及底座和 Core 独立版本预检", () => {
  assert.deepEqual(checkCoreCombination([], host).issues, []);
  const tickets = manifest();
  const rental = manifest("rental");
  assert.deepEqual(checkCoreCombination([tickets, rental], host).issues, []);
  assert.deepEqual(checkCoreCombination([tickets, rental], { ...host, platform: "0.1.10" }).issues, []);
  assert.deepEqual(checkCoreCombination([{ ...tickets, version: "0.1.1" }, rental], host).issues, []);
  assert.equal(checkCoreCombination([tickets, tickets], host).issues[0].code, "duplicate_core");
  assert.equal(checkCoreCombination([tickets], { ...host, platform: "0.2.0" }).issues[0].code, "platform_version");
  assert.equal(checkCoreCombination([tickets], { ...host, contract: "0.2.0" }).issues[0].code, "contract_version");
  assert.equal(checkCoreCombination([tickets], { ...host, node: "20.0.0" }).issues[0].code, "node_version");
  tickets.requires = [{ capability: "file-storage", version: supported }];
  assert.equal(checkCoreCombination([tickets], host).issues[0].code, "missing_capability");
  assert.equal(checkCoreCombination([tickets], { ...host, capabilities: { "file-storage": "1.0.0" } }).issues[0].code, "capability_version");
  assert.deepEqual(checkCoreCombination([tickets], { ...host, capabilities: { "file-storage": "0.1.4" } }).issues, []);
});

test("对象定位隔离 Core、租户与容器，不拼接有歧义的字符串", () => {
  const ref = { coreId: "tickets", tenantId: "tenant-a", objectType: "ticket", objectId: "1" };
  const keys = [coreObjectKey(ref), coreObjectKey({ ...ref, coreId: "rental" }),
    coreObjectKey({ ...ref, tenantId: "tenant-b" }),
    coreObjectKey({ ...ref, container: { type: "project", id: "1" } }),
    coreObjectKey({ ...ref, container: { type: "project", id: "2" } })];
  assert.equal(new Set(keys).size, keys.length);
  assert.notEqual(coreObjectKey({ ...ref, objectType: "a:b", objectId: "c" }), coreObjectKey({ ...ref, objectType: "a", objectId: "b:c" }));
  assert.equal(coreObjectKey({ ...ref, revision: "2" }), coreObjectKey(ref), "修订不改变对象身份");
});

test("路径拒绝越界、Windows 特殊路径和不可移植名称", () => {
  for (const bad of ["../main.js", "/tmp/a.js", "C:/a.js", "\\\\host\\share", "a/../../b.js", "a//b.js", "./a.js", "a%2fb.js", "a:b.js", "con.js", "a/../b", "a/space ", "a/b."])
    assert.equal(CorePackagePathSchema.safeParse(bad).success, false, bad);
  assert.equal(CorePackagePathSchema.safeParse("dist/server.js").success, true);
});

test("包检查不加载代码，缺入口/指南/兼容前置均不能当通过", () => {
  const dir = fixture();
  const checked = inspectCorePackage(dir, host);
  assert.equal(checked.ok, true);
  assert.equal(checked.compatibilityChecked, true);
  assert.equal(inspectCorePackage(dir).compatibilityChecked, false);
  fs.unlinkSync(path.join(dir, "server.cjs"));
  assert.ok(inspectCorePackage(dir).issues.some(i => i.file === "server.cjs" && i.code === "file_unavailable"));
  fs.unlinkSync(path.join(dir, "CORE_GUIDE.md"));
  assert.ok(inspectCorePackage(dir).issues.some(i => i.file === "CORE_GUIDE.md"));
});

test("迁移摘要、重复迁移路径与大小写冲突有明确拒绝", () => {
  const body = "CREATE TABLE sample_fixture (id integer);";
  const value = manifest();
  value.data.migrations = [{ id: "initial", file: "initial.sql", sha256: createHash("sha256").update(body).digest("hex") }];
  const dir = fixture(value);
  fs.writeFileSync(path.join(dir, "initial.sql"), body);
  assert.equal(inspectCorePackage(dir).ok, true);
  fs.appendFileSync(path.join(dir, "initial.sql"), "-- changed");
  assert.ok(inspectCorePackage(dir).issues.some(i => i.code === "checksum_mismatch"));
  value.data.migrations.push({ ...value.data.migrations[0], id: "other" });
  assert.equal(CoreManifestSchema.safeParse(value).success, false);
  const mixed = manifest();
  mixed.entries.admin = "Server.cjs";
  assert.ok(inspectCorePackage(fixture(mixed)).issues.some(i => i.code === "path_collision"));
});

test("目录链接不能把包内入口指向外部", () => {
  const value = manifest();
  value.entries.server = "linked/server.cjs";
  const dir = fixture(value);
  const other = fixture();
  fs.symlinkSync(other, path.join(dir, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.ok(inspectCorePackage(dir).issues.some(i => i.code === "linked_path"));
  assert.equal(fs.existsSync(path.join(other, "server.cjs")), true);
});

test("命令输出是可解析 JSON，退出码区分包错误和用法错误", () => {
  const dir = fixture();
  const cli = path.join(dist, "check.js");
  const call = args => spawnSync(process.execPath, ["--no-compilation-cache", cli, ...args], { encoding: "utf8", env: process.env });
  const valid = call([dir, "--json"]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).scope, "package-static");
  assert.equal(JSON.parse(valid.stdout).compatibilityChecked, false);
  fs.writeFileSync(path.join(dir, "core.manifest.json"), "invalid JSON");
  const bad = call([dir, "--json"]);
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).issues[0].code, "invalid_json");
  const usage = call(["--json"]);
  assert.equal(usage.status, 2);
  assert.equal(JSON.parse(usage.stdout).issues[0].code, "check_failed");
});
