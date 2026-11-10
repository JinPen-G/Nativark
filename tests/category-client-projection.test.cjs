"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { clientCategoryMetadata, clientItemAttributes } = require("../apps/api/dist/modules/rental-core/category-client-projection.js");
const { ClientApiService } = require("../apps/api/dist/modules/client/client-api.service.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const { categoryCreationTemplates } = require("../apps/api/dist/modules/rental-core/category-creation-templates.js");
const { parsePublishedRentalCategory } = require("../apps/api/dist/modules/rental-core/rental-category-resolver.service.js");

function definition(code = "wardrobe_hire") {
  const source = structuredClone(categoryCreationTemplates()[0].definition);
  return { ...source, code, name: "服装租赁", version: "1.0", businessModel: { ...source.businessModel, assetFields: [
    { code: "brand", label: "品牌", scope: "item_group", type: "string" },
    { code: "size", label: "尺码", scope: "item_group", type: "select", options: ["M", "L"], clientVisible: true },
    { code: "weight", label: "重量", scope: "item_group", type: "number", unit: "kg", clientVisible: true },
    { code: "washed", label: "已清洗", scope: "item_group", type: "boolean", clientVisible: true },
    { code: "serialNo", label: "内部编号", scope: "asset", type: "string", clientVisible: true },
    { code: "internalNote", label: "内部备注", scope: "item_group", type: "string", clientVisible: false }
  ] } };
}

test("customer projection excludes internal, asset and undeclared properties and preserves false/zero", () => {
  const category = definition();
  const input = { brand: "内部品牌", size: "M", weight: 0, washed: false, serialNo: "asset-secret", internalNote: "secret", unregistered: "secret" };
  assert.deepEqual(clientItemAttributes(category, input), {
    attributes: { size: "M", weight: 0, washed: false }, attributeLabels: { size: "尺码", weight: "重量", washed: "已清洗" }
  });
  const metadata = clientCategoryMetadata(category, "published-version");
  assert.equal(metadata.categoryVersionId, "published-version");
  assert.deepEqual(metadata.fields.map(field => field.code), ["size", "weight", "washed"]);
  assert.equal(metadata.fields.some(field => "clientVisible" in field || "scope" in field || "unique" in field), false);
  assert.deepEqual(clientItemAttributes(category, { size: "not-an-option", weight: NaN, washed: "false" }).attributes, {});
});

test("builtin compatibility allows only declared technical specs; explicit internal flags override it", () => {
  const category = definition("camera");
  assert.deepEqual(clientItemAttributes(category, { brand: "公开品牌", unregistered: "secret" }).attributes, { brand: "公开品牌" });
  category.businessModel.assetFields[0].clientVisible = false;
  assert.deepEqual(clientItemAttributes(category, { brand: "已隐藏" }).attributes, {});
});

test("published parser rejects a visibility declaration on an asset", () => {
  const template = structuredClone(categoryCreationTemplates()[0].definition);
  assert.doesNotThrow(() => parsePublishedRentalCategory(template, template.code));
  const asset = template.businessModel.assetFields.find(field => field.scope === "asset");
  assert.ok(asset);
  asset.clientVisible = true;
  assert.throws(() => parsePublishedRentalCategory(template, template.code));
  delete asset.clientVisible;
  assert.doesNotThrow(() => parsePublishedRentalCategory(template, template.code));
});

function catalogService(changed) {
  const category = definition();
  const binding = { definition: category, categoryVersionId: "version-one", adoptionRevision: 2 };
  let reads = 0;
  const service = Object.create(ClientApiService.prototype);
  service.categoryResolver = { forWorkspace: async (tenant, workspace) => {
    assert.equal(tenant, "tenant-one"); assert.equal(workspace, "workspace-one");
    return ++reads > 1 && changed ? { ...binding, categoryVersionId: "version-two", adoptionRevision: 3 } : binding;
  } };
  service.context = async () => ({ profile: { categoryCode: category.code }, category,
    settings: { pricing: { currency: "CNY" }, calendar: {}, fulfillment: { enabledModes: ["pickup"] } },
    groups: [{ id: "item-one", code: "item", name: "服装", status: "enabled", inventoryMode: "serialized", attributes: { size: "L", internalNote: "secret" } }], pricingGroups: [], locations: [] });
  service.business = { listSpaceRatesAt: async () => [], listServices: () => [], listDiscountPlans: () => [], effectiveRuleAt: () => undefined };
  return service;
}
const identity = { tenantId: "tenant-one", userId: "customer-one", isSaasAdmin: false, audience: "client", workspaceId: "workspace-one" };
const summary = { workspaceCode: "wardrobe", workspaceName: "服装", categoryCode: "wardrobe_hire", membershipStatus: "guest" };
test("catalog uses the adopted Core projection without manufacturing a missing starting price", async () => {
  const result = await runWithRequestIdentity(identity, () => catalogService(false).buildCatalog("tenant-one", "tenant", summary));
  assert.deepEqual(result.items[0].attributes, { size: "L" });
  assert.equal(result.items[0].startingPrice, undefined);
  assert.equal(result.categoryMetadata.categoryVersionId, "version-one");
});
test("catalog rejects adoption changes during reads and absence of trusted workspace scope", async () => {
  await assert.rejects(runWithRequestIdentity(identity, () => catalogService(true).buildCatalog("tenant-one", "tenant", summary)), /品类版本已变化/);
  await assert.rejects(catalogService(false).buildCatalog("tenant-one", "tenant", summary), /受权空间/);
});

function load(file, modules) {
  const source = fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    assert.ok(name in modules, `unexpected import ${name}`); return modules[name];
  }, console, setTimeout, clearTimeout, URLSearchParams });
  return module.exports;
}

test("customer catalog discards late session responses and rejects unknown display versions", async () => {
  let version = 1, resolve;
  const catalog = { workspace: { workspaceCode: "wardrobe", categoryCode: "wardrobe_hire" }, categoryCode: "wardrobe_hire", items: [] };
  const store = load("apps/miniprogram/src/core/catalogStore.ts", {
    "../api/catalog": { fetchPublicCatalog: () => new Promise(done => { resolve = done; }) },
    "./geo": {}, "./images": {}, "./labels": {}, "./money": {}, "./zones": {},
    "./session": { contextVersion: () => version, isSignedIn: () => false, currentServiceCode: () => "wardrobe" }
  });
  const first = store.loadCatalog("wardrobe"); version = 2; resolve(catalog);
  await assert.rejects(first, /会话已变化/);
  assert.equal(store.cachedCatalog("wardrobe"), undefined);
  const second = store.loadCatalog("wardrobe"); resolve({ ...catalog, categoryMetadata: { structureVersion: 99 } });
  await assert.rejects(second, /不支持此品类展示版本/);
  assert.equal(store.cachedCatalog("wardrobe"), undefined);
});

test("employee inspections reject unsupported controls and invalid select values while preserving false", () => {
  const form = load("apps/staff-miniprogram/src/core/inspection-form.ts", {});
  assert.throws(() => form.inspectionRows({ fields: [{ code: "new", label: "新版检查", type: "signature", required: true }] }), /不支持/);
  const rows = form.inspectionRows({ fields: [{ code: "kit_complete", label: "齐套", type: "boolean", required: true }, { code: "size", label: "尺码", type: "select", options: ["M"], required: true }] });
  rows[1].value = "M";
  assert.deepEqual(JSON.parse(JSON.stringify(form.inspectionResults(rows))), { results: { kit_complete: false, size: "M" } });
  rows[1].value = "invalid";
  assert.match(form.inspectionResults(rows).error, /可选值/);
});

test("employee refresh re-reads the current workspace definition even when its category code stays the same", async () => {
  let category = definition(), reads = 0;
  class Emitter { on() { return () => {}; } emit() {} }
  const context = load("apps/staff-miniprogram/src/core/context.ts", {
    "../api/context": { sessionContext: async () => ({ tenant: { categoryCode: "camera", capabilities: [] } }),
      listCategories: async () => { reads++; return category ? [category] : []; }, listLocations: async () => [] },
    "./events": { Emitter },
    "./session": { contextVersion: () => 1, currentWorkspaceId: () => "wardrobe", currentWorkspace: () => ({ categoryCode: "wardrobe_hire" }),
      applySessionContext: () => {}, sessionEvents: new Emitter() },
    "./http": { ApiError: Error }, "./storage": { STORAGE_KEYS: {}, readStorage: () => undefined, writeStorage: () => {} }
  });
  assert.equal((await context.loadContext()).categoryCode, "wardrobe_hire");
  category = { ...category, name: "新发布服装定义", version: "2.0" };
  assert.equal((await context.loadContext(true)).categoryName, "新发布服装定义");
  assert.equal(reads, 2);
  category = undefined;
  await assert.rejects(context.loadContext(true), /品类定义缺失/);
});

test("website consumes Core labels/units and leaves unprovided financial and inventory facts missing", async () => {
  const bootstrap = { tenantCode: "tenant", merchant: { name: "商户" }, services: [{ code: "wardrobe", name: "服装空间", categoryCode: "wardrobe_hire", status: "open" }] };
  const catalog = { tenantCode: "tenant", workspace: { workspaceCode: "wardrobe" }, categoryCode: "wardrobe_hire",
    categoryMetadata: { structureVersion: 1, name: "服装租赁", icon: "clothing" }, pricingUnits: [{ code: "hour", label: "小时" }], pricingGroups: [],
    items: [{ id: "item", code: "item", name: "礼服", attributes: { weight: 0, washed: false }, attributeLabels: { weight: "重量", washed: "已清洗" } }] };
  const site = load("apps/tenant-website/src/data/remoteSite.ts", { "./apiClient": { clientApi: { publicCatalog: async () => catalog } } });
  const result = await site.loadRemoteCatalogs("tenant", bootstrap);
  const product = result.products[0];
  assert.equal(product.price, undefined); assert.equal(product.deposit, undefined); assert.equal(product.availableQuantity, undefined);
  assert.equal(product.stockStatus, "unknown");
  assert.deepEqual(JSON.parse(JSON.stringify(product.specs)), { 重量: "0", 已清洗: "否" });
  catalog.items[0].startingPrice = { amount: 0, unit: "hour", currency: "CNY" };
  assert.equal((await site.loadRemoteCatalogs("tenant", bootstrap)).products[0].priceUnit, "小时");
  catalog.categoryMetadata.structureVersion = 2;
  assert.equal((await site.loadRemoteCatalogs("tenant", bootstrap)).products.length, 0);
});
