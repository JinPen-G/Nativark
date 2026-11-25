/** 根包与显式 workspace 的索引回归，在内存替换声明资料并只读本仓源码。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildRepositoryCapabilityIndex } = require("../packages/core-contracts/dist/repository-index.js");
const { PLATFORM_SOURCE_WORKSPACES } = require("../packages/core-contracts/dist/platform-source.js");

test("标准底座显式 workspace 能定位公共能力及独立 API 消费者", () => {
  const root = path.resolve(__dirname, "..");
  const packageFile = path.join(root, "package.json");
  const originalRead = fs.readFileSync;
  const metadata = JSON.parse(originalRead(packageFile, "utf8"));
  const fixture = Buffer.from(JSON.stringify({
    ...metadata,
    workspaces: [...PLATFORM_SOURCE_WORKSPACES, "packages/platform-core-host",
      "packages/__core_capability_nested_fixture_missing__/*", "__core_capability_directory_fixture_missing__"]
  }));

  fs.readFileSync = (file, options) => {
    if (typeof file !== "string" || path.resolve(file) !== packageFile) return originalRead(file, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? fixture.toString(encoding) : Buffer.from(fixture);
  };
  try {
    const index = buildRepositoryCapabilityIndex(root);
    assert.equal(index.issues.filter(issue => issue.code === "workspace_pattern").length, 0);
    for (const directory of PLATFORM_SOURCE_WORKSPACES) {
      assert.equal(index.capabilities.filter(item => item.id === `module:${directory}`).length, 1);
    }
    assert.ok(index.coverage.some(item =>
      item.source === "packages/__core_capability_nested_fixture_missing__" && item.state === "not_present"));
    assert.ok(index.coverage.some(item =>
      item.source === "__core_capability_directory_fixture_missing__" && item.state === "not_present"));
    const capability = index.capabilities.find(item =>
      item.id === "export:@rental-os/platform-core-host:createPublicCorePackageDeploymentSources");
    assert.ok(capability);
    assert.equal(capability.entry.module, "@rental-os/platform-core-host");
    assert.equal(capability.sources[0].path, "packages/platform-core-host/src/core-package-deployment.ts");
    assert.ok(capability.details.directImports.some(item => item.path === "apps/platform-api/src/core-assembly.ts"));
  } finally {
    fs.readFileSync = originalRead;
  }
});

test("独立根包与workspace去重，来源和缺失出口保持真实边界", () => {
  const root = path.resolve(__dirname, "../packages/core-contracts");
  const packageFile = path.join(root, "package.json");
  const nestedPackageFile = path.join(root, "test/package.json");
  const sourceFile = path.join(root, "src/version.ts");
  const consumerFile = path.join(root, "src/reference.ts");
  const configFile = path.join(root, "tsconfig.json");
  const emittedFile = path.join(root, "dist/version.js");
  const gitMarker = path.join(root, ".git");
  const originalRead = fs.readFileSync, originalLstat = fs.lstatSync;
  const fileStat = originalLstat(sourceFile);
  let workspaces, missingExport = false, unavailableConfig, foreignGit = false;
  fs.lstatSync = (file, ...args) => {
    const resolved = typeof file === "string" ? path.resolve(file) : undefined;
    if (resolved === nestedPackageFile || resolved === emittedFile) return fileStat;
    if (resolved === gitMarker) return foreignGit ? fileStat : undefined;
    if (resolved === configFile && unavailableConfig === "linked") return { isSymbolicLink: () => true };
    return originalLstat(file, ...args);
  };
  fs.readFileSync = (file, options) => {
    if (typeof file !== "string") return originalRead(file, options);
    const resolved = path.resolve(file);
    let text;
    if (resolved === packageFile) text = JSON.stringify({ name: "@fixture/root", version: "1.2.3",
      exports: { ".": missingExport ? "./dist/version.js" : "./src/version.ts" },
      dependencies: { zod: "3.25.76" }, ...(workspaces === undefined ? {} : { workspaces }) });
    else if (resolved === nestedPackageFile) text = JSON.stringify({ name: "@fixture/nested", version: "1.2.3",
      exports: { ".": "../src/reference.ts" } });
    else if (resolved === sourceFile) text = "throw new Error('不能执行Core模块');\n"
      + "export const ROOT_VALUE = 7;\nexport function createRootValue() { throw new Error('不能执行Core函数'); }\n"
      + "export { z } from 'zod';\nimport type { ZodTypeAny as ExternalType } from 'zod';\nexport type { ExternalType };\n";
    else if (resolved === consumerFile) text = "import { ROOT_VALUE, createRootValue } from '@fixture/root';\n"
      + "export const REFERENCE_VALUE = ROOT_VALUE;\ncreateRootValue();\n";
    else if (resolved === configFile && unavailableConfig === "unreadable") {
      throw Object.assign(new Error("配置读取被拒绝"), { code: "EACCES" });
    } else if (resolved === emittedFile) text = "throw new Error('不能执行或索引历史生成物');";
    else return originalRead(file, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? Buffer.from(text).toString(encoding) : Buffer.from(text);
  };
  try {
    for (workspaces of [undefined, [], [".", "./.", "test", "./test", "test"]]) {
      const index = buildRepositoryCapabilityIndex(root);
      const rootModule = index.capabilities.find(item => item.id === "module:.");
      assert.ok(rootModule);
      assert.equal(index.capabilities.filter(item => item.id === "module:.").length, 1);
      assert.equal(rootModule.sources[0].path, "package.json");
      assert.ok(rootModule.documentation.some(item => item.path === "README.md"));
      assert.equal(index.source.revision, undefined);
      assert.equal(index.source.workingTreeChanged, undefined);
      assert.deepEqual(index.coverage.filter(item => item.source === "package.json"),
        [{ source: "package.json", count: 1, state: "indexed" }]);
      const capability = index.capabilities.find(item => item.id === "export:@fixture/root:ROOT_VALUE");
      assert.ok(capability);
      assert.equal(capability.sources[0].path, "src/version.ts");
      assert.ok(capability.details.directImports.some(item => item.path === "src/reference.ts"));
      const external = index.capabilities.find(item => item.id === "export:@fixture/root:z");
      assert.equal(external.details.reexport.dependency.source.path, "package.json");
      const forwarded = index.capabilities.find(item => item.id === "export:@fixture/root:ExternalType");
      assert.equal(forwarded.entry.typeOnly, true);
      assert.equal(forwarded.details.declarationStatus, "external-dependency");
      assert.equal(forwarded.details.reexport.symbol, "ZodTypeAny");
      assert.equal(forwarded.details.reexport.dependency.source.path, "package.json");
      assert.equal(index.capabilities.filter(item => item.id === "module:test").length, workspaces?.length ? 1 : 0);
    }
    workspaces = undefined;
    missingExport = true;
    for (unavailableConfig of [undefined, "linked", "unreadable"]) {
      const index = buildRepositoryCapabilityIndex(root);
      assert.ok(index.capabilities.some(item => item.id === "module:."));
      assert.ok(index.issues.some(issue => issue.code === "export_source" && issue.path === "package.json"));
      assert.ok(index.coverage.some(item => item.source === "package.json" && item.state === "partial"));
      assert.equal(index.capabilities.some(item => item.entry?.module === "@fixture/root"), false);
    }
    foreignGit = true;
    assert.throws(() => buildRepositoryCapabilityIndex(root), /Git工作树根与源码查询目录不一致/u);
  } finally {
    fs.readFileSync = originalRead;
    fs.lstatSync = originalLstat;
  }
});

test("工单清单静态资产沿正式schema展开，动态无效与覆盖保持缺口", () => {
  const root = path.resolve(__dirname, "..");
  const packageFile = path.join(root, "package.json");
  const manifestFile = path.join(root, "packages/example-tickets-core/src/manifest.ts");
  const originalRead = fs.readFileSync;
  const metadata = JSON.parse(originalRead(packageFile, "utf8"));
  let manifestFixture;
  fs.readFileSync = (file, options) => {
    const resolved = typeof file === "string" ? path.resolve(file) : undefined;
    const text = resolved === packageFile
      ? JSON.stringify({ ...metadata, workspaces: ["packages/core-contracts", "packages/example-tickets-core"] })
      : resolved === manifestFile ? manifestFixture : undefined;
    if (text === undefined) return originalRead(file, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? Buffer.from(text).toString(encoding) : Buffer.from(text);
  };
  try {
    const index = buildRepositoryCapabilityIndex(root);
    const core = index.capabilities.find(item => item.id === "core:example-tickets");
    const names = ["contracts", "service", "server", "manifest", "mysql", "http", "nest", "openapi", "metadata", "package", "platform-host"];
    assert.deepEqual(core.details.manifest.assets, ["package.json", ...names.map(name => `dist/${name}.js`),
      ...["index", ...names].map(name => `dist/${name}.d.ts`)]);
    assert.equal(core.details.manifest.assets.length, 24);
    assert.equal(core.details.assetsSource.status, "indexed");
    assert.deepEqual(core.details.assetsSource.issues, []);
    assert.equal(core.details.assetsSource.source.path, "packages/example-tickets-core/src/manifest.ts");
    assert.equal(core.details.unresolvedMetadata.includes("assets"), false);
    assert.ok(core.details.unresolvedMetadata.includes("source"));
    assert.ok(index.issues.some(issue => issue.code === "core_metadata" && issue.path === "packages/example-tickets-core/src/manifest.ts"));
    for (const [name, declaration, valid] of [["empty", "assets: []", true],
      ["dynamic", "assets: unavailable()", false], ["invalid", 'assets: ["../escape.js"]', false],
      ["covered", 'assets: ["safe.js"], ...unavailable()', false],
      ["duplicate", 'assets: ["old.js"], assets: ["latest.js"]', false]]) {
      manifestFixture = `
import { CoreManifestSchema } from "@rental-os/core-contracts";
import { TICKETS_CORE_ID, TICKETS_CORE_VERSION } from "./contracts";
export function createTicketsManifest(source) {
  throw new Error("queried Core function must not execute");
  return CoreManifestSchema.parse({ manifestVersion: 1, id: TICKETS_CORE_ID, version: TICKETS_CORE_VERSION,
    name: "资产fixture", source, ${declaration} });
}`;
      const fixtureIndex = buildRepositoryCapabilityIndex(root);
      const fixtureCore = fixtureIndex.capabilities.find(item => item.id === "core:example-tickets");
      assert.ok(fixtureCore, name);
      assert.equal(Object.hasOwn(fixtureCore.details.manifest, "assets"), valid, name);
      assert.equal(fixtureCore.details.unresolvedMetadata.includes("assets"), !valid, name);
      assert.ok(fixtureCore.details.unresolvedMetadata.includes("source"), name);
      assert.ok(fixtureCore.details.assetsSource.expression, name);
      if (valid) assert.deepEqual(fixtureCore.details.manifest.assets, []);
      if (name === "dynamic") assert.equal(fixtureCore.details.assetsSource.status, "source-reference");
    }
  } finally {
    fs.readFileSync = originalRead;
  }
});

test("工单页面静态权限沿正式schema展开，动态和无效权限保留来源", () => {
  const root = path.resolve(__dirname, "..");
  const packageFile = path.join(root, "package.json");
  const adminFile = path.join(root, "packages/example-tickets-core/admin/index.tsx");
  const originalRead = fs.readFileSync;
  const metadata = JSON.parse(originalRead(packageFile, "utf8"));
  const permissionLine = originalRead(adminFile, "utf8").split(/\r?\n/).findIndex(line => line.startsWith("const permission =")) + 1;
  let adminFixture;
  fs.readFileSync = (file, options) => {
    const resolved = typeof file === "string" ? path.resolve(file) : undefined;
    const text = resolved === packageFile
      ? JSON.stringify({ ...metadata, workspaces: ["packages/core-contracts", "packages/example-tickets-core"] })
      : resolved === adminFile ? adminFixture : undefined;
    if (text === undefined) return originalRead(file, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? Buffer.from(text).toString(encoding) : Buffer.from(text);
  };
  try {
    const index = buildRepositoryCapabilityIndex(root);
    const read = { resource: "ticket", action: "read" };
    for (const [id, expected] of [["tickets", [read]], ["setup", []],
      ["create", [read, { resource: "ticket", action: "create" }]], ["detail", [read]]]) {
      const page = index.capabilities.find(item => item.id === `page:example-tickets:${id}`);
      assert.ok(page);
      assert.deepEqual(page.details.permissions, expected);
      assert.equal(page.details.permissionsSource.status, "indexed");
      assert.deepEqual(page.details.permissionsSource.issues, []);
      assert.equal(page.details.permissionsSource.source.path, "packages/example-tickets-core/admin/index.tsx");
      assert.equal(page.details.unresolvedMetadata.includes("permissions"), false);
      if (expected.length && id !== "create") {
        assert.ok(page.details.permissionsSource.fieldSources.some(field => field.pointer === "/0/action"));
      }
      if (id === "create") for (const pointer of ["/0/action", "/1/action"]) {
        const field = page.details.permissionsSource.fieldSources.find(field => field.pointer === pointer);
        assert.ok(field);
        assert.equal(field.source.line, permissionLine);
      }
    }
    assert.equal(index.issues.some(issue => issue.code === "page_metadata" && issue.path === "packages/example-tickets-core/admin/index.tsx"), false);
    adminFixture = `
import { TICKETS_CORE_ID, TICKETS_CORE_VERSION } from "@rental-os/example-tickets-core/contracts";
declare const action: string;
declare const extra: object;
const permission = (action: string) => [{ resource: "ticket", action }];
export function createTicketsAdmin() {
  throw new Error("queried Core function must not execute");
  return { coreId: TICKETS_CORE_ID, implementationVersion: TICKETS_CORE_VERSION, pages: [
    { id: "dynamic", path: "/dynamic", title: "动态", permissions: permission(action), component: null },
    { id: "invalid", path: "/invalid", title: "无效", permissions: [{ resource: "ticket", action: "READ" }], component: null },
    { id: "covered", path: "/covered", title: "覆盖", permissions: permission("read"), ...extra, component: null }
  ] };
}`;
    const partial = buildRepositoryCapabilityIndex(root);
    for (const id of ["dynamic", "invalid"]) {
      const page = partial.capabilities.find(item => item.id === `page:example-tickets:${id}`);
      assert.ok(page);
      assert.equal(Object.hasOwn(page.details, "permissions"), false);
      assert.ok(page.details.unresolvedMetadata.includes("permissions"));
      assert.ok(page.details.permissionsSource.expression);
      assert.ok(partial.issues.some(issue => issue.code === "page_metadata" && issue.message.includes(id)));
    }
    const dynamic = partial.capabilities.find(item => item.id === "page:example-tickets:dynamic");
    assert.equal(dynamic.details.permissionsSource.status, "source-reference");
    assert.ok(dynamic.details.permissionsSource.issues.length);
    assert.equal(partial.capabilities.some(item => item.id === "page:example-tickets:covered"), false);
    assert.ok(partial.issues.some(issue => issue.code === "page_metadata" && issue.message.includes('id: "covered"')));
  } finally {
    fs.readFileSync = originalRead;
  }
});

test("Rental页面聚合追实际订单描述，直接数组定位而控制流与动态分支保留缺口", () => {
  const root = path.resolve(__dirname, "..");
  const packageFile = path.join(root, "package.json"), adminFile = path.join(root, "packages/rental-core/admin/index.tsx");
  const pagesFile = path.join(root, "packages/rental-core/admin/orders/pages.ts");
  const originalRead = fs.readFileSync, metadata = JSON.parse(originalRead(packageFile, "utf8"));
  const unused = originalRead(pagesFile, "utf8").replace("export const RENTAL_ORDER_PAGES = {", `export const RENTAL_ORDER_PAGES = {
    unused: { id: "unreferenced", path: "/unreferenced", title: "未引用", permissions: [] },`);
  let adminFixture;
  fs.readFileSync = (file, options) => {
    const resolved = typeof file === "string" ? path.resolve(file) : undefined;
    const text = resolved === packageFile ? JSON.stringify({ ...metadata, workspaces: ["packages/core-contracts", "packages/rental-core"] })
      : resolved === pagesFile ? unused : resolved === adminFile ? adminFixture : undefined;
    if (text === undefined) return originalRead(file, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? Buffer.from(text).toString(encoding) : Buffer.from(text);
  };
  try {
    const index = buildRepositoryCapabilityIndex(root), pages = index.capabilities.filter(item => item.kind === "page" && item.owner === "rental");
    assert.equal(pages.length, 31);
    for (const [id, route] of [["orders", "/orders"], ["order-create", "/orders/new"], ["order-detail", "/orders/:id"]]) {
      const page = pages.find(item => item.id === `page:rental:${id}`);
      assert.equal(page.entry.path, `/cores/rental${route}`);
      assert.ok(page.sources.some(location => location.path === "packages/rental-core/admin/index.tsx"));
      assert.ok(page.sources.some(location => location.path === "packages/rental-core/admin/orders/index.tsx"));
      assert.ok(page.details.descriptorSource.fieldSources.some(field => field.pointer === "/id" && field.source.path.endsWith("/orders/pages.ts")));
      for (const field of ["permissions", "component", "implementationVersion"]) assert.ok(page.details.unresolvedMetadata.includes(field));
    }
    assert.equal(pages.find(item => item.id === "page:rental:orders").details.menu.order, 10);
    assert.equal(pages.find(item => item.id === "page:rental:order-detail").details.parent, "orders");
    assert.equal(pages.some(item => item.id === "page:rental:unreferenced"), false);
    assert.equal(JSON.stringify(pages).includes("unreferenced"), false);
    const version = pages.find(item => item.id === "page:rental:orders").details.implementationVersionSource;
    assert.equal(version.status, "source-reference");
    const rootVersion = version.contributions.find(item => item.source.path === "packages/rental-core/admin/index.tsx");
    assert.equal(rootVersion.source.line, 56);
    assert.equal(rootVersion.parameter.line, 42);
    assert.equal(rootVersion.expression, "implementationVersion");
    for (const [id, group, index, line] of [
      ["work-orders", "work-orders", 0, 16], ["work-order-detail", "work-orders", 1, 26],
      ["payment-reconciliation", "payment-reconciliation", 0, 11], ["payment-reconciliation-detail", "payment-reconciliation", 1, 21],
      ["qualification-types", "membership", 0, 15], ["membership-reviews", "membership", 1, 32],
      ["personal-members", "membership", 2, 42], ["personal-member-detail", "membership", 3, 52],
      ["corporate-members", "membership", 4, 62], ["corporate-member-detail", "membership", 5, 72],
      ["membership-plans", "membership", 6, 82], ["membership-rewards", "membership", 7, 92],
      ["workbench", "operations", 0, 11], ["operation-report", "operations", 1, 18],
    ]) {
      const page = pages.find(item => item.id === `page:rental:${id}`), descriptor = page.details.descriptorSource;
      assert.equal(descriptor.schema.id, id);
      assert.equal(page.entry.path, `/cores/rental${descriptor.schema.path}`);
      assert.equal(descriptor.arrayIndex, index);
      assert.ok(descriptor.fieldSources.some(field => field.pointer === "/id"
        && field.source.path === `packages/rental-core/admin/${group}/pages.ts` && field.source.line === line));
      assert.equal(descriptor.fieldSources.some(field => /^\/\d+(?:\/|$)/u.test(field.pointer)), false);
      assert.ok(descriptor.issues.some(issue => issue.startsWith("/permissions:") || issue.startsWith("/permissions/")));
      const componentLine = { "work-orders": 26, "payment-reconciliation": 28, membership: 41, operations: 28 }[group];
      assert.ok(descriptor.unresolvedFieldSources.some(field => field.pointer === "/component"
        && field.source.path === `packages/rental-core/admin/${group}/index.tsx` && field.source.line === componentLine));
      assert.ok(descriptor.unresolvedFieldSources.some(field => field.pointer === "/permissions" && field.source.path.endsWith(`/${group}/pages.ts`)));
      assert.equal(descriptor.unresolvedFieldSources.some(field => /^\/\d+(?:\/|$)/u.test(field.pointer)), false);
      assert.equal(Object.hasOwn(descriptor, "sourceFields"), false);
      if (id === "qualification-types") {
        const membershipVersion = page.details.implementationVersionSource.contributions.find(item => item.source.path.endsWith("/membership/index.tsx"));
        assert.equal(membershipVersion.source.line, 33);
        assert.equal(membershipVersion.parameter.line, 28);
      }
      for (const field of ["permissions", "component", "implementationVersion"]) assert.ok(page.details.unresolvedMetadata.includes(field));
    }
    for (const [id, order] of [["item-groups", 0], ["assets", 20], ["locations", 40]]) {
      const page = pages.find(item => item.id === `page:rental:${id}`);
      assert.equal(page.details.menu.order, order);
      assert.equal(page.details.unresolvedMetadata.includes("menu"), false);
    }
    for (const [control, expected] of [["if (unavailable()) return {};", 0], ["", 3]]) {
      adminFixture = `import { createRentalOrdersAdminContribution } from "./orders";
export function createRentalAdminContribution(version, contexts) {
  const orders = createRentalOrdersAdminContribution(version, contexts.useOrderContext);
  ${control}
  return { coreId: orders.coreId, implementationVersion: version, pages: [...orders.pages, ...unavailable()] };
}
export function mappedContribution(version) {
  ${control}
  return { coreId: "rental", implementationVersion: version, pages:
    Object.values({ one: { id: "fixture-map", path: "/fixture-map", title: "映射", permissions: [] } })
      .map(page => ({ ...page, component: () => null })) };
}`;
      const result = buildRepositoryCapabilityIndex(root);
      assert.equal(result.capabilities.filter(item => item.kind === "page" && item.owner === "rental" && item.id !== "page:rental:fixture-map").length, expected);
      assert.equal(result.capabilities.some(item => item.id === "page:rental:fixture-map"), !control);
      assert.ok(result.issues.some(issue => issue.code === "page_metadata" && issue.message.includes(control ? "控制流" : "unavailable()")));
      assert.equal(result.capabilities.some(item => item.id === "page:rental:unreferenced"), false);
    }
    const block = (table, extra = "", modifier = "") => `Object.values(definitions).map(${modifier}definition => {
      const Content = ${table}[definition.id];
      const Page = () => { throw Error("must-not-execute-component"); };
      ${extra}
      return { ...definition, component: Page };
    })`;
    const refused = [
      ["extraCall", block("components", "unavailable();")], ["control", block("components", "if (unavailable()) return {};")],
      ["asynchronous", block("components", "", "async ")], ["unknownCover", block("unknownComponents")],
      ["accessor", block("getterComponents")], ["delayed", block("delayedComponents")], ["dynamicReference", block("runtimeComponents")],
    ];
    adminFixture = `function StaticComponent() { throw Error("must-not-execute-imported-component"); }
const definitions = { entry: { id: "selected", path: "/selected", title: "静态", permissions: [] } };
const components = { selected: StaticComponent };
const unknownComponents = { ...unavailable(), selected: StaticComponent };
const getterComponents = { get selected() { throw Error("must-not-execute-getter"); } };
const delayedComponents = { selected: StaticComponent };
function writeLater() { Object.assign(delayedComponents, { selected: StaticComponent }); }
const runtimeComponents = { selected: unavailable() };
const accepted = ${block("components")};
${refused.map(([name, expression]) => `const ${name} = ${expression};`).join("\n")}`;
    const ts = require("typescript"), { RepositorySource } = require("../packages/core-contracts/dist/repository-source.js");
    const { describeRepositorySchema } = require("../packages/core-contracts/dist/repository-openapi.js");
    const source = new RepositorySource(root, [adminFile], {});
    const declarations = source.source(adminFile).statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]);
    const describe = name => describeRepositorySchema(source, declarations.find(node => node.name.getText() === name).name);
    const accepted = describe("accepted");
    assert.equal(accepted.schema[0].id, "selected");
    assert.equal(accepted.status, "source-reference");
    assert.ok(accepted.issues.includes("/0/component:unsupported-expression"));
    for (const [name] of refused) {
      const result = describe(name);
      assert.equal(result.status, "source-reference", name);
      assert.equal(Object.hasOwn(result, "schema"), false, name);
    }
  } finally { fs.readFileSync = originalRead; }
});

test("继承配置定位真实AI出口，越界、链接和不可读配置保留未解析", () => {
  const root = path.resolve(__dirname, "..");
  const packageFile = path.join(root, "package.json");
  const rentalPackageFile = path.join(root, "apps/rental-api/package.json");
  const aiConfigFile = path.join(root, "apps/rental-api/tsconfig.ai.json");
  const baseConfigFile = path.join(root, "apps/rental-api/tsconfig.json");
  const emittedFile = path.join(root, "apps/rental-api/dist-ai/ai-app.module.js");
  const originalRead = fs.readFileSync, originalStat = fs.statSync, originalLstat = fs.lstatSync;
  const metadata = JSON.parse(originalRead(packageFile, "utf8"));
  const rentalMetadata = JSON.parse(originalRead(rentalPackageFile, "utf8"));
  const aiConfig = JSON.parse(originalRead(aiConfigFile, "utf8"));
  const fileStat = originalStat(baseConfigFile);
  let scenario, forbiddenReads = 0;
  fs.statSync = (file, ...args) => typeof file === "string" && path.resolve(file) === scenario?.extends
    ? fileStat : originalStat(file, ...args);
  fs.lstatSync = (file, ...args) => {
    const resolved = typeof file === "string" ? path.resolve(file) : undefined;
    if (resolved === emittedFile) return fileStat;
    if (scenario?.linked && resolved === baseConfigFile) return { isSymbolicLink: () => true };
    return originalLstat(file, ...args);
  };
  fs.readFileSync = (file, options) => {
    if (typeof file !== "string") return originalRead(file, options);
    const resolved = path.resolve(file);
    let text;
    if (resolved === packageFile) text = JSON.stringify({ ...metadata, workspaces: ["apps/rental-api"] });
    else if (resolved === rentalPackageFile) text = JSON.stringify({ ...rentalMetadata,
      exports: { "./ai-app-module": rentalMetadata.exports["./ai-app-module"] } });
    else if (resolved === aiConfigFile && scenario?.extends) text = JSON.stringify({ ...aiConfig, extends: scenario.extends });
    else if (resolved === scenario?.extends) {
      forbiddenReads++;
      text = JSON.stringify({ compilerOptions: { rootDir: path.join(root, "apps/rental-api/src") } });
    } else if (resolved === baseConfigFile && scenario?.unreadable) {
      throw Object.assign(new Error("配置读取被拒绝"), { code: "EACCES" });
    } else if (resolved === emittedFile) text = "throw new Error('生成物不能作为源码或执行');";
    else return originalRead(file, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? Buffer.from(text).toString(encoding) : Buffer.from(text);
  };
  try {
    const index = buildRepositoryCapabilityIndex(root);
    const capability = index.capabilities.find(item =>
      item.id === "export:@rental-os/rental-api/ai-app-module:RentalAiAppModule");
    assert.ok(capability);
    assert.equal(capability.sources[0].path, "apps/rental-api/src/ai-app.module.ts");
    assert.equal(index.issues.some(issue => issue.code === "export_source"), false);
    for (scenario of [
      { extends: path.resolve(root, "../outside-tsconfig.json") },
      { extends: path.join(root, "node_modules/blocked-tsconfig.json") },
      { linked: true },
      { unreadable: true }
    ]) {
      const rejected = buildRepositoryCapabilityIndex(root);
      assert.ok(rejected.issues.some(issue => issue.code === "export_source"), JSON.stringify(scenario));
      assert.equal(rejected.capabilities.some(item => item.entry?.module === "@rental-os/rental-api/ai-app-module"), false);
    }
    assert.equal(forbiddenReads, 0);
  } finally {
    fs.readFileSync = originalRead;
    fs.statSync = originalStat;
    fs.lstatSync = originalLstat;
  }
});

test("静态API资料定位正则原文与DTO字段，动态校验和缺失引用保持来源", () => {
  const ts = require("typescript");
  const { RepositorySource } = require("../packages/core-contracts/dist/repository-source.js");
  const { describeRepositorySchema, repositoryApiDocumentation } = require("../packages/core-contracts/dist/repository-openapi.js");
  const root = path.resolve(__dirname, "..");
  const file = path.join(root, "packages/core-contracts/src/repository-openapi.ts");
  const originalRead = fs.readFileSync;
  const fixture = String.raw`
const originalPattern = /^[A-Za-z0-9_\/-]{2,64}$/u;
const patternAlias = originalPattern;
const limits = { maxItems: 4, dynamic: () => { throw new Error("must-not-run"); } };
const STATIC_FIELD_SCHEMAS = { Result: { type: "object", properties: { ok: { type: "boolean" } } } };
const STATIC_FIELD_OPERATIONS = [{ method: "POST", path: "/api/static-fields",
  requestSchema: { type: "object", properties: { code: { type: "string", pattern: patternAlias.source }, codes: { type: "array", maxItems: limits.maxItems } } },
  responseSchema: { $ref: "#/components/schemas/Result" } }];
const dynamicSchema = { type: "string", pattern: new RegExp("dynamic").source };
const missingSchema = { $ref: "#/components/schemas/Missing" };
const incompleteSchema = { type: "object", "x-schemaStatus": "incomplete", "x-schemaGaps": ["dynamic-response"] };
class RequestDto { code!: string; items?: Array<{ id: string }>; static marker = "internal"; }
class DerivedDto extends RequestDto { reason?: string; }
class GenericDto<T> { value!: T; }
@Controller("static-fields") class StaticFieldsController {
  @Post() save(@Body() input: RequestDto) {}
  @Post("derived") derived(@Body() input: DerivedDto) {}
  @Post("generic") generic(@Body() input: GenericDto<string>) {}
}
`;
  fs.readFileSync = (source, options) => {
    if (typeof source !== "string" || path.resolve(source) !== file) return originalRead(source, options);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? fixture : Buffer.from(fixture);
  };
  try {
    const source = new RepositorySource(root, [file], {});
    const documentation = repositoryApiDocumentation(source);
    const operation = documentation.get("POST /api/static-fields");
    assert.equal(operation.details.openapiSource.schemas.requestSchema.schema.properties.code.pattern, "^[A-Za-z0-9_\\/-]{2,64}$");
    assert.equal(operation.details.openapiSource.schemas.requestSchema.schema.properties.codes.maxItems, 4);
    assert.equal(operation.details.openapiSource.schemas.requestSchema.status, "indexed");
    const body = operation.details.controllerRequestBodies[0];
    assert.deepEqual(body.fields.map(field => field.name), ["code", "items"]);
    assert.equal(body.fields[1].declaredType, "Array<{ id: string }>");
    assert.equal(body.status, "source-reference");
    for (const suffix of ["derived", "generic"]) {
      const value = documentation.get(`POST /api/static-fields/${suffix}`);
      assert.equal(value.details.apiFieldsStatus, "source-reference");
      assert.equal(value.details.controllerRequestBodies[0].fieldNamesStatus, "source-reference");
      assert.deepEqual(value.details.controllerSource.issues, ["responseSchema:source-reference"]);
    }
    const declarations = source.source(file).statements.filter(ts.isVariableStatement)
      .flatMap(statement => [...statement.declarationList.declarations]);
    const expression = name => declarations.find(node => node.name.getText() === name).initializer;
    assert.equal(describeRepositorySchema(source, expression("dynamicSchema")).status, "source-reference");
    assert.equal(describeRepositorySchema(source, expression("incompleteSchema")).status, "source-reference");
    const missing = describeRepositorySchema(source, expression("missingSchema"), [expression("STATIC_FIELD_SCHEMAS")]);
    assert.equal(missing.status, "not-indexed");
    assert.equal(missing.references[0].mapSources[0].path, "packages/core-contracts/src/repository-openapi.ts");
    assert.ok(missing.references[0].mapSources[0].line > 0);
  } finally {
    fs.readFileSync = originalRead;
  }
});

test("静态对象组合保留最后覆盖与出处，后置写入和未知来源准确失效", () => {
  const ts = require("typescript");
  const { RepositorySource, UNRESOLVED } = require("../packages/core-contracts/dist/repository-source.js");
  const { describeRepositorySchema, repositoryApiDocumentation } = require("../packages/core-contracts/dist/repository-openapi.js");
  const root = path.resolve(__dirname, "..");
  const file = path.join(root, "packages/core-contracts/src/repository-openapi.ts");
  const importedFile = path.join(root, "packages/core-contracts/src/repository-source.ts");
  const originalRead = fs.readFileSync;
  const fixture = String.raw`
import { sharedMap } from "./repository-source";
const base = { type: "object", properties: { old: { type: "string", maxLength: 12 } } };
const replacement = { properties: { current: { type: "number" } } };
const assigned = Object.assign({}, base, replacement);
const identity = schema => schema;
const asArray = schema => ({ type: "array", items: identity(schema) });
const nestedCalls = asArray(base);
const clone = schema => Object.assign({}, schema, { description: "static" });
const cloned = clone(base);
const noops = Object.assign({}, base, null, 0, true, "");
const tombstone = Object.assign({}, base, { properties: unavailable() });
const afterUnknown = Object.assign({}, base, unavailable(), { properties: { current: { type: "boolean" } } });
const partial = { ...unavailable(), properties: { current: { type: "integer" } }, "a/b": { "~tag": true } };
const partialSpread = { ...base, ...partial };
const unknownSpread = { ...base, ...unavailable() };
const unsupportedSpread = { ...base, ...["unexpanded"], type: "number" };
const knownAfterSpread = { ...base, ...unavailable(), type: "number" };
const unknownProperty = { ...base, type: unavailable() };
const nestedUnknownProperty = { ...base, ...{ type: unavailable() } };
const unknownComputed = { ...base, [unavailable()]: "ignored", type: "integer" };
const getterOverwrite = { ...base, get type() { throw new Error("must-not-run"); } };
const deeperPartialSpread = { ...base, ...partialSpread };
const arrayParts = [{ action: "first" }, { action: "second" }];
const spreadArray = [{ action: "before" }, ...arrayParts, ...[...arrayParts], { action: "after" }];
const partialArray = [...[{ action: unavailable(), resource: "ticket" }]];
const mapOf = (name, schema) => ({ [name]: schema });
const nestedMap = { schemas: mapOf("Built", assigned) };
const selectedMap = nestedMap.schemas;
const builtReference = { $ref: "#/components/schemas/Built" };
const postMap = { Result: { type: "string", maxLength: 20 } };
Object.hasOwn(postMap, "Result");
const alias = postMap;
const beforeMap = { ...postMap };
Object.assign(alias, { Result: assigned }, { Added: { type: "boolean" } });
const statementMap = { Result: { type: "string" } };
const statementWrite = Object.assign(statementMap, { Result: { type: "number" } }), statementSnapshot = { ...statementMap };
const delayedMap = { Result: { type: "string" } };
const delayedSnapshot = { ...delayedMap };
function mutateLater() { Object.assign(delayedMap, { Result: { type: "number" } }); }
const STATIC_COMPOSE_SCHEMAS = postMap;
const STATIC_COMPOSE_OPERATIONS = [{ method: "POST", path: "/api/static-compositions", responseSchema: { $ref: "#/components/schemas/Result" } }];
const resultReference = { $ref: "#/components/schemas/Result" };
const loopMap = { Result: { type: "string" } };
for (const name of unavailable()) loopMap[name] = { type: "number" };
const escapedMap = { Result: { type: "string" } };
mutate(escapedMap);
const getterSource = Object.assign({}, { get properties() { throw new Error("must-not-run"); } }, { type: "object" });
const getterTarget = Object.assign({ get type() { throw new Error("must-not-run"); } }, { type: "string" });
const unknownTarget = Object.assign(unavailable(), { type: "string" });
const frozenTarget = Object.assign(Object.freeze({}), { type: "string" });
enum StaticNames { Ok = "ok" }
const frozenEnumTarget = Object.assign(Object.freeze(StaticNames), { type: "string" });
const shadowed = Object => Object.assign({}, { type: "string" });
const shadowedObject = shadowed({ assign: unavailable });
const asyncBuilder = async () => ({ type: "string" });
const asyncTarget = Object.assign(asyncBuilder(), { type: "number" });
const prototypeSource = Object.assign({}, { ["__proto__"]: { type: "string" } });
const parentMap = { Inner: { type: "string" } };
const memberAlias = parentMap.Inner;
Object.assign(memberAlias, { type: "number" });
const destructuredMap = { Inner: { type: "string" } };
const { Inner: bindingAlias } = destructuredMap;
bindingAlias.type = "number";
const importedMap = sharedMap;
Object.assign(sharedMap, { Result: { type: "number" } });
const routeTable = { read: { path: "tickets", schema: unavailable() }, other: { path: "other" } };
register(routeTable.read.path);
routeTable.read.schema.parse(unavailableInput);
const schemaAlias = routeTable.read.schema;
schemaAlias.parse(unavailableInput);
let scalarAlias = routeTable.read.path;
const routedPath = routeTable.read.path, otherRoutedPath = routeTable.other.path;
const escapedRoutes = { path: "unavailable" };
register(escapedRoutes);
const escapedRoutePath = escapedRoutes.path;
const writtenRoutes = { path: "initial" };
writtenRoutes.path = "changed";
const writtenRoutePath = writtenRoutes.path;
const escapedBranch = { read: { path: "unavailable" }, other: { path: "other" } };
register(escapedBranch.read);
const escapedBranchPath = escapedBranch.read.path, siblingBranchPath = escapedBranch.other.path;
const descriptorTable = { current: { id: "current", path: "/current", title: "当前", permissions: ["read"] }, other: { id: "other", path: "/other", title: "其他", permissions: [] } };
inspect(descriptorTable.current.permissions);
descriptorTable.current.permissions.push("write");
const selectedDescriptor = descriptorTable.current, untouchedDescriptor = descriptorTable.other;
const scalarDescriptorFields = { path: routeTable.read.path, id: descriptorTable.current.id };
const escapedDescriptor = escapedBranch.read;
const dynamicDescriptor = descriptorTable[unavailableKey];
`;
  fs.readFileSync = (source, options) => {
    if (typeof source !== "string" || ![file, importedFile].includes(path.resolve(source))) return originalRead(source, options);
    const text = path.resolve(source) === file ? fixture : 'export const sharedMap = { Result: { type: "string" } };';
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? text : Buffer.from(text);
  };
  try {
    const source = new RepositorySource(root, [file], {});
    const declarations = source.source(file).statements.filter(ts.isVariableStatement)
      .flatMap(statement => [...statement.declarationList.declarations]);
    const declaration = name => declarations.find(node => node.name.getText() === name);
    const describe = name => describeRepositorySchema(source, declaration(name).name);
    const line = text => fixture.slice(0, fixture.indexOf(text)).split(/\r?\n/).length;
    for (const name of ["postMap", "alias", "loopMap", "escapedMap", "parentMap", "destructuredMap", "importedMap"]) {
      assert.equal(source.value(declaration(name).name), UNRESOLVED, name);
      assert.ok(source.unresolvedProperties(declaration(name).name).some(issue => issue.startsWith("post-write:")), name);
    }
    assert.equal(source.value(declaration("routedPath").name), "tickets");
    const scalarDescriptorFields = describe("scalarDescriptorFields");
    assert.equal(scalarDescriptorFields.schema.path, "tickets");
    assert.equal(scalarDescriptorFields.schema.id, "current");
    const selectedDescriptor = describe("selectedDescriptor");
    assert.equal(selectedDescriptor.schema.id, "current");
    assert.equal(selectedDescriptor.schema.path, "/current");
    assert.equal(selectedDescriptor.schema.title, "当前");
    assert.equal(Object.hasOwn(selectedDescriptor.schema, "permissions"), false);
    assert.equal(selectedDescriptor.status, "source-reference");
    assert.ok(selectedDescriptor.issues.includes("/permissions:dynamic-object-write"));
    assert.ok(selectedDescriptor.fieldSources.some(field => field.pointer === "/id"));
    assert.ok(selectedDescriptor.unresolvedFieldSources.some(field => field.pointer === "/permissions"));
    assert.equal(selectedDescriptor.fieldSources.some(field => field.pointer.startsWith("/other")), false);
    const untouchedDescriptor = describe("untouchedDescriptor");
    assert.equal(untouchedDescriptor.status, "indexed");
    assert.deepEqual(untouchedDescriptor.schema.permissions, []);
    for (const name of ["escapedDescriptor", "dynamicDescriptor"]) {
      assert.equal(describe(name).status, "source-reference", name);
      assert.equal(Object.hasOwn(describe(name), "schema"), false, name);
    }

    for (const name of ["otherRoutedPath", "siblingBranchPath"]) assert.equal(source.value(declaration(name).name), "other", name);
    for (const name of ["escapedRoutePath", "writtenRoutePath", "escapedBranchPath"]) assert.equal(source.value(declaration(name).name), UNRESOLVED, name);
    assert.equal(source.value(declaration("routeTable").name), UNRESOLVED);
    assert.ok(source.unresolvedProperties(declaration("routeTable").name).some(issue => issue.startsWith("post-write:")));
    assert.equal(source.value(declaration("beforeMap").name).Result.type, "string");
    assert.ok(source.unresolvedProperties(declaration("alias").name).includes(`post-write:packages/core-contracts/src/repository-openapi.ts:${line("Object.assign(alias")}`));
    assert.equal(source.value(declaration("statementSnapshot").name).Result, undefined);
    const statementUsage = declaration("statementSnapshot").initializer.properties[0].expression;
    assert.ok(source.unresolvedProperties(statementUsage).includes(`post-write:packages/core-contracts/src/repository-openapi.ts:${line("const statementWrite")}`));
    for (const [name, write] of [["statementSnapshot", "const statementWrite"], ["delayedSnapshot", "function mutateLater"]]) {
      const result = describe(name);
      assert.equal(result.status, "source-reference", name);
      assert.equal(result.schema.Result, undefined, name);
      assert.ok(result.sources.some(location => location.line === line(write)), name);
    }
    for (const [name, keys] of [["unknownSpread", []], ["unsupportedSpread", ["type"]], ["knownAfterSpread", ["type"]],
      ["unknownProperty", ["properties"]], ["nestedUnknownProperty", ["properties"]],
      ["unknownComputed", ["type"]], ["getterOverwrite", ["properties"]],
      ["partialSpread", ["properties", "a/b"]], ["deeperPartialSpread", ["properties", "a/b"]]]) {
      assert.deepEqual(Object.keys(source.value(declaration(name).name)), keys, name);
      assert.ok(source.unresolvedProperties(declaration(name).initializer).length, name);
    }
    assert.equal(source.value(declaration("knownAfterSpread").name).type, "number");
    const spreadArray = describe("spreadArray");
    assert.deepEqual(spreadArray.schema.map(item => item.action), ["before", "first", "second", "first", "second", "after"]);
    for (let index = 0; index < 6; index++) {
      const field = spreadArray.fieldSources.find(field => field.pointer === `/${index}/action`);
      assert.ok(field);
      assert.equal(field.source.line, line(index === 0 || index === 5 ? "const spreadArray" : "const arrayParts"));
    }
    const partialArray = describe("partialArray");
    assert.equal(partialArray.status, "source-reference");
    assert.ok(partialArray.issues.some(issue => issue.startsWith("/0/action:")));
    assert.ok(partialArray.fieldSources.some(field => field.pointer === "/0/resource"));
    const assigned = describe("assigned");
    assert.equal(assigned.status, "indexed");
    assert.deepEqual(Object.keys(assigned.schema.properties), ["current"]);
    assert.equal(assigned.fieldSources.find(field => field.pointer === "/properties/current/type").source.line, line("const replacement"));
    assert.equal(assigned.fieldSources.some(field => field.pointer.includes("/old")), false);
    assert.equal(describe("nestedCalls").status, "indexed");
    assert.equal(describe("nestedCalls").schema.items.properties.old.maxLength, 12);
    assert.equal(describe("cloned").status, "indexed");
    assert.equal(describe("cloned").schema.description, "static");
    assert.equal(describe("noops").status, "indexed");
    assert.equal(describe("noops").schema.properties.old.maxLength, 12);
    const tombstone = describe("tombstone");
    assert.equal(tombstone.status, "source-reference");
    assert.equal(Object.hasOwn(tombstone.schema, "properties"), false);
    assert.equal(tombstone.fieldSources.some(field => field.pointer.startsWith("/properties")), false);
    for (const name of ["afterUnknown", "partialSpread"]) {
      const result = describe(name);
      assert.equal(result.status, "source-reference");
      assert.deepEqual(Object.keys(result.schema.properties), ["current"]);
      assert.ok(result.fieldSources.some(field => field.pointer === "/properties/current/type"));
      assert.equal(result.fieldSources.some(field => field.pointer.includes("/old")), false);
    }
    assert.ok(describe("partialSpread").fieldSources.some(field => field.pointer === "/a~1b/~0tag"));
    const built = describeRepositorySchema(source, declaration("builtReference").initializer, [declaration("selectedMap").name]);
    assert.equal(built.status, "indexed");
    assert.equal(built.references[0].schema.properties.current.type, "number");
    const operation = repositoryApiDocumentation(source).get("POST /api/static-compositions");
    assert.equal(operation.details.openapiSource.schemas.responseSchema.references[0].schema.properties.current.type, "number");
    assert.equal(describe("beforeMap").schema.Result.type, "string");
    assert.equal(describe("alias").schema.Result.properties.current.type, "number");
    for (const name of ["loopMap", "escapedMap"]) {
      const result = describe(name);
      assert.equal(result.status, "source-reference");
      assert.equal(Object.hasOwn(result, "schema"), false);
      const reference = describeRepositorySchema(source, declaration("resultReference").initializer, [declaration(name).name]);
      assert.deepEqual(reference.references[0].issues, ["schema-map:source-reference"]);
      assert.ok(reference.references[0].mapSources.some(location => location.line === line(name === "loopMap" ? "for (const name" : "mutate(escapedMap)")));
    }
    for (const name of ["getterSource", "getterTarget", "unknownTarget", "frozenTarget", "frozenEnumTarget", "shadowedObject", "asyncTarget", "prototypeSource"]) {
      assert.equal(describe(name).status, "source-reference");
    }
    assert.equal(describe("memberAlias").schema.type, "number");
    for (const name of ["parentMap", "destructuredMap", "importedMap"]) {
      const result = describe(name);
      assert.equal(result.status, "source-reference");
      assert.equal(Object.hasOwn(result, "schema"), false);
    }
    const rentalFile = path.join(root, "packages/rental-core/src/http-openapi-rental-exchange-inspection-preparation.schemas.ts");
    const rental = new RepositorySource(root, [rentalFile], {});
    const rentalDeclaration = rental.source(rentalFile).statements.filter(ts.isVariableStatement)
      .flatMap(statement => [...statement.declarationList.declarations])
      .find(node => node.name.getText() === "RENTAL_EXCHANGE_INSPECTION_SCHEMAS");
    assert.equal(rental.value(rentalDeclaration.name), UNRESOLVED);
    const rentalIssues = rental.unresolvedProperties(rentalDeclaration.name);
    for (const line of [52, 70]) assert.ok(rentalIssues.includes(`post-write:packages/rental-core/src/http-openapi-rental-exchange-inspection-preparation.schemas.ts:${line}`));
    assert.equal(Object.keys(describeRepositorySchema(rental, rentalDeclaration.name).schema).length, 17);
  } finally {
    fs.readFileSync = originalRead;
  }
});
