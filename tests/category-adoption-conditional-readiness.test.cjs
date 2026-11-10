"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
const { RENTAL_CATEGORY_DEFINITIONS, RENTAL_CORE_CAPABILITY_CODES } = require("@rental-os/shared");
const { workspaceCapabilityRequirements, captureCapabilityRequirements } = require("../apps/api/dist/modules/rental-core/category-capability-conditions.js");
const { WorkspaceCapabilityService } = require("../apps/api/dist/modules/rental-core/workspace-capability.service.js");
const { readCategoryAdoptionCompatibility } = require("../apps/api/dist/modules/rental-core/category-adoption-compatibility-reader.js");
const { CapabilityHookRuntime } = require("../apps/api/dist/modules/rental-core/capability-hook.runtime.js");
const { buildKitHandoverHookModule } = require("../apps/api/dist/modules/rental-core/capabilities/kit-handover.js");
const { CATEGORY_COMMERCIAL_REQUIREMENTS, categoryCommercialRequirements } = require("../apps/api/dist/modules/rental-core/category-adoption-commercial.js");
const pickup = "store_pickup_return", versions = ["kit_handover@kit-1.0"];
const patch = { intent: "enable_new", code: "kit_handover", expectedRevision: 0, expectedImplementationVersion: "kit-1.0", config: {} };

function definition(when = { inventoryModes: ["bundle"], itemAttribute: { code: "needsKit", values: [true] } }) {
  const target = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === "camera"));
  target.code = "studio_kits";
  target.defaultCapabilities = [...target.defaultCapabilities.filter(code => RENTAL_CORE_CAPABILITY_CODES.includes(code)), "kit_handover"];
  target.requiredCapabilities = [];
  target.businessModel.assetFields.push({ code: "needsKit", label: "需要套装清点", scope: "item_group", type: "boolean" });
  target.conditionalCapabilities = [{ code: "kit_handover", when }];
  target.businessModel.defaults.inspectionFields = [{ code: "kit_complete", label: "套装附件齐全", type: "boolean", required: true, appliesToCapability: "kit_handover" }];
  return target;
}
const group = (id, inventoryMode, attributes = {}) => ({ id, inventoryMode, attributes, bundleComponents: [], status: "enabled" });
const registeredHooks = service => {
  const hooks = new CapabilityHookRuntime(service); hooks.register(buildKitHandoverHookModule()); return hooks;
};

test("adoption condition readiness checks actual model facts without making an unmatched rule mandatory", () => {
  const target = definition(), service = new WorkspaceCapabilityService({});
  const unrelated = workspaceCapabilityRequirements(target, [group("one", "serialized"), group("two", "bundle", { needsKit: false })], [pickup]);
  assert.deepEqual(unrelated.required, []);
  assert.equal(service.adoptionCompatibility(target, [], versions, undefined, unrelated.required).valid, true);
  const matched = workspaceCapabilityRequirements(target, [group("kit", "BUNDLE", { needsKit: true })], [pickup]);
  assert.deepEqual(matched.required, ["kit_handover"]);
  assert.deepEqual(matched.matches[0].itemGroupIds, ["kit"]);
  assert.equal(service.adoptionCompatibility(target, [], versions, undefined, matched.required).valid, false);
});

test("missing classification and missing trusted fulfillment facts fail closed, while a false conjunction remains unrelated", () => {
  const target = definition({ inventoryModes: ["bundle"], fulfillmentModes: ["delivery"], itemAttribute: { code: "needsKit", values: [false] } });
  assert.deepEqual(workspaceCapabilityRequirements(target, [group("kit", "bundle")], [pickup]).required, []);
  assert.deepEqual(workspaceCapabilityRequirements(target, [group("kit", "bundle", { needsKit: false })], ["delivery"]).required, ["kit_handover"]);
  assert.throws(() => workspaceCapabilityRequirements(target, [group("kit", "bundle")], ["delivery"]), /不能当作未触发/);
  assert.throws(() => workspaceCapabilityRequirements(target, [group("kit", "bundle", { needsKit: true })], undefined), /当前履约配置/);
});

test("a declared conditional executor can be explicitly staged without activating or resuming an instance", () => {
  const target = definition(), service = new WorkspaceCapabilityService({}), current = [];
  const projected = service.prepareAdoptionConfigs(target, current, [patch], versions);
  assert.equal(current.length, 0);
  assert.equal(projected[0].revision, 0);
  assert.equal(service.adoptionCompatibility(target, projected, versions, undefined, ["kit_handover"]).valid, true);
  assert.throws(() => service.prepareAdoptionConfigs(target, [{ ...projected[0], status: "paused", revision: 3 }], [patch], versions), /已变化/);
  assert.throws(() => service.prepareAdoptionConfigs(target, [], [patch], []), /尚未注册/);
  assert.throws(() => service.prepareAdoptionConfigs({ ...target, conditionalCapabilities: [] }, [], [patch], versions), /仅允许明确准备/);
});

test("an enabled instance still needs its exact executable version even if no conditional item currently matches", () => {
  const target = definition(), service = new WorkspaceCapabilityService({});
  const active = [{ code: "kit_handover", status: "enabled", implementationVersion: "unknown-version", config: {} }];
  assert.equal(service.adoptionCompatibility(target, active, versions, undefined, []).valid, false);
});

test("whole-space readiness retains its collection limit without widening quote snapshot limits", () => {
  const target = definition(), groups = Array.from({ length: 1001 }, (_, index) => group(`g${index}`, "serialized"));
  assert.equal(workspaceCapabilityRequirements(target, groups, [pickup]).checkedItemGroupCount, 1001);
  assert.throws(() => captureCapabilityRequirements(target, groups, groups.map(row => row.id), pickup), /商品范围|支持上限/);
});

test("commercial locking can plan the potential superset while actual grants follow matched or explicitly enabled capabilities", () => {
  const target = definition(), registry = { ...CATEGORY_COMMERCIAL_REQUIREMENTS, kit_handover: ["feature-kit"] };
  assert.deepEqual(categoryCommercialRequirements(target, [], registry, ["kit_handover"]).featureCodes, ["feature-kit"]);
  assert.deepEqual(categoryCommercialRequirements(target, [], registry, []).featureCodes, []);
  assert.deepEqual(categoryCommercialRequirements(target, [{ code: "kit_handover", status: "enabled" }], registry, []).featureCodes, ["feature-kit"]);
});

test("the scoped compatibility reader exposes condition blockers and reads fresh classification on subsequent checks", async () => {
  const target = definition(), service = new WorkspaceCapabilityService({});
  const tx = new Proxy({}, { get: (_, model) => model === "rentalTenantBusinessSettings" ? { findFirst: async args => {
    assert.deepEqual(args.where, { tenantId: "tenant", workspaceId: "workspace" });
    return { settings: { fulfillment: { enabledModes: [pickup] } } };
  } } : { findMany: async args => {
    assert.equal(args.where.tenantId, "tenant"); assert.equal(args.where.workspaceId, "workspace"); return [];
  } } });
  const groups = [group("kit", "bundle", { needsKit: true })];
  const check = () => readCategoryAdoptionCompatibility(tx, "tenant", "workspace", target, { groups, assets: [] }, service,
    registeredHooks(service), new Date("2026-11-09"));
  const first = await check();
  assert.deepEqual(first.requiredCapabilityCodes, ["kit_handover"]);
  assert.ok(first.blockers.some(row => row.domain === "capability" && row.id === "kit_handover"));
  groups[0].attributes.needsKit = false;
  assert.deepEqual((await check()).requiredCapabilityCodes, []);
  groups[0].attributes = {};
  assert.ok((await check()).blockers.some(row => row.domain === "conditional_capability"));
});

test("conditional adoption checks the actual tenant pickup and return templates against the registered executor without adding or changing fields", async () => {
  const target = definition(), service = new WorkspaceCapabilityService({}), hooks = registeredHooks(service);
  const groups = [group("kit", "bundle", { needsKit: true })];
  const templates = ["pickup", "return"].map(stage => ({ id: stage, categoryCode: target.code, code: `CUSTOM_${stage}`, name: stage,
    version: "1.0", stage, enabled: true, fields: [{ code: "kit_complete", label: "现有附件检查", type: "boolean", required: false }] }));
  const original = structuredClone(templates);
  const tx = new Proxy({}, { get: (_, model) => model === "rentalTenantBusinessSettings" ? { findFirst: async () => ({ settings: { fulfillment: { enabledModes: [pickup] } } }) }
    : { findMany: async () => model === "rentalInspectionTemplate" ? structuredClone(templates) : [] } });
  const check = () => readCategoryAdoptionCompatibility(tx, "tenant", "space", target, { groups, assets: [] }, service, hooks, new Date(), [patch]);
  assert.ok(!(await check()).blockers.some(row => row.domain === "inspection_composition"));
  assert.deepEqual(templates, original, "readiness uses the same frozen policy projection as quotes, never writes templates");
  templates[1].fields = [];
  assert.ok((await check()).blockers.some(row => row.domain === "inspection_composition" && row.message.includes("归还")));
  templates[1].fields = [{ ...original[1].fields[0], type: "text" }];
  assert.ok((await check()).blockers.some(row => row.domain === "inspection_composition" && row.message.includes("合同不一致")));
  templates[1].fields = original[1].fields; templates[1].enabled = false;
  assert.ok((await check()).blockers.some(row => row.domain === "inspection_composition"));
  groups[0].attributes.needsKit = false;
  assert.ok(!(await check()).blockers.some(row => row.domain === "inspection_composition"), "unmatched objects do not acquire the kit inspection obligation");
});

test("conditional declaration or unavailable registered inspection contract cannot be treated as ready", async () => {
  const target = definition(), service = new WorkspaceCapabilityService({});
  const tx = new Proxy({}, { get: (_, model) => model === "rentalTenantBusinessSettings" ? { findFirst: async () => ({ settings: { fulfillment: { enabledModes: [pickup] } } }) }
    : { findMany: async () => [] } });
  const records = { groups: [group("one", "serialized")], assets: [] };
  const absent = await readCategoryAdoptionCompatibility(tx, "tenant", "space", target, records, service, { registeredVersions: () => versions }, new Date());
  assert.ok(absent.blockers.some(row => row.domain === "inspection_composition" && row.message.includes("执行器")));
  target.businessModel.defaults.inspectionFields[0].required = false;
  const incompatible = await readCategoryAdoptionCompatibility(tx, "tenant", "space", target, records, service, registeredHooks(service), new Date());
  assert.ok(incompatible.blockers.some(row => row.domain === "inspection_composition" && row.message.includes("必填")));
  assert.equal(incompatible.complete, false);
});

test("the admin offers a registered conditional candidate but requires an explicit selection before preparing it", () => {
  const source = fs.readFileSync("apps/admin/src/features/settings/governance/categoryPreparationCapabilities.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("exports", "require", compiled)(exports, require);
  const preview = { targetDefinition: definition(), stale: false, entities: { capabilities: [] }, registeredCapabilityVersions: versions, preparation: null };
  assert.ok(exports.preparationCapabilityDefinitions(preview).some(row => row.code === "kit_handover"));
  const drafts = exports.initialCapabilityDrafts(preview, "upgrade");
  assert.equal(drafts.kit_handover.selected, false);
  assert.deepEqual(exports.capabilityPreparationPatches(preview, drafts), []);
  drafts.kit_handover.selected = true;
  assert.deepEqual(exports.capabilityPreparationPatches(preview, drafts), [patch]);
});
