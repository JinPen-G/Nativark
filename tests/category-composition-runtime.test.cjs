"use strict";
// Real registered Hook implementations with a substituted instance reader; not a DB or fulfillment acceptance test.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { RENTAL_CATEGORY_DEFINITIONS, RENTAL_CAPABILITY_MODULES } = require("@rental-os/shared");
const { CapabilityHookRuntime } = require("../apps/api/dist/modules/rental-core/capability-hook.runtime.js");
const { CapabilityHookRegistrar } = require("../apps/api/dist/modules/rental-core/capability-hook.registrar.js");
const { buildCameraKitHandoverHookModule } = require("../apps/api/dist/modules/rental-core/capabilities/camera-kit-handover.js");
const { RentalCoreService } = require("../apps/api/dist/modules/rental-core/rental-core.service.js");
const { RentalBusinessService } = require("../apps/api/dist/modules/rental-core/rental-business.service.js");
const { captureCapabilityRequirements, resolveCapabilityRequirements } = require("../apps/api/dist/modules/rental-core/category-capability-conditions.js");
const { requestIdentityMiddleware, enterRequestIdentity } = require("../apps/api/dist/common/request-identity.js");

function runtime(registered = true) {
  const result = new CapabilityHookRuntime({ enabledInstances: async () => [] });
  if (registered) new CapabilityHookRegistrar(result).onApplicationBootstrap();
  return result;
}
function category() {
  const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === "camera"));
  definition.code = "event_kits";
  definition.defaultCapabilities = definition.defaultCapabilities.filter(code => RENTAL_CAPABILITY_MODULES.find(row => row.code === code).applicableCategories === "all");
  definition.defaultCapabilities.push("kit_handover");
  definition.conditionalCapabilities = [{ code: "kit_handover", when: { inventoryModes: ["bundle"] } }];
  definition.businessModel.defaults.inspectionFields = [{ code: "kit_complete", label: "套装附件齐全", type: "boolean", required: true, appliesToCapability: "kit_handover" }];
  return definition;
}
const instance = { tenantId: "tenant", workspaceId: "space", code: "kit_handover", status: "enabled", implementationVersion: "kit-1.0", configVersion: "1", config: {} };
const subject = (results = {}) => ({ order: { lines: [{ itemGroupId: "kit", itemGroupName: "布景套装", inventoryMode: "bundle", quantity: 1 }] }, results });
const input = (point, overrides = {}) => ({ point, tenantId: "tenant", workspaceId: "space", categoryCode: "event_kits",
  requiredCapabilities: ["kit_handover"], instances: [instance], subject: subject(), ...overrides });

test("composition admission uses executable registration and mandatory field bindings", () => {
  const hooks = runtime();
  const definition = category();
  assert.doesNotThrow(() => hooks.assertCategoryComposition(definition));
  assert.throws(() => runtime(false).assertCategoryComposition(definition), /未登记执行模块/);
  for (const change of [row => { row.businessModel.defaults.inspectionFields = []; },
    row => { row.businessModel.defaults.inspectionFields[0].required = false; },
    row => { delete row.businessModel.defaults.inspectionFields[0].appliesToCapability; },
    row => { row.conditionalCapabilities[0].when.inventoryModes = ["serialized"]; }]) {
    const invalid = structuredClone(definition); change(invalid);
    assert.throws(() => hooks.assertCategoryComposition(invalid));
  }
});

test("a triggered requirement cannot disappear with a missing instance or missing executable", async () => {
  const hooks = runtime();
  assert.equal((await hooks.run(input("quote_validation", { instances: [] }))).blocked, true);
  assert.equal((await hooks.run(input("order_confirmation", { instances: [] }))).blocked, true);
  assert.equal((await hooks.run(input("pickup_delivery", { instances: [{ ...instance, status: "paused" }] }))).blocked, true);
  assert.equal((await runtime(false).run(input("pickup_delivery"))).blocked, true);
  const unrelated = await hooks.run(input("pickup_delivery", { requiredCapabilities: [], inactiveConditionalCapabilities: ["kit_handover"] }));
  assert.equal(unrelated.blocked, false);
  assert.deepEqual(unrelated.executed, []);
});

test("generic kit handover requires explicit evidence and preserves the existing return exception decisions", async () => {
  const hooks = runtime();
  for (const payload of [subject(), { ...subject({ kit_complete: true }), inspectionSkipped: true }, subject({ kit_complete: "yes" })]) {
    assert.equal((await hooks.run(input("pickup_delivery", { subject: payload }))).blocked, true);
  }
  assert.equal((await hooks.run(input("pickup_delivery", { subject: subject({ kit_complete: false }) }))).blocked, true);
  const complete = subject({ kit_complete: true }), original = structuredClone(complete);
  assert.equal((await hooks.run(input("pickup_delivery", { subject: complete }))).blocked, false);
  assert.deepEqual(complete, original, "Hook opinions do not mutate order facts");
  assert.equal((await hooks.run(input("return_inspection", { subject: subject({ kit_complete: false }) }))).blocked, true);
  const returned = await hooks.run(input("return_inspection", { subject: { ...subject({ kit_complete: false }), exceptions: [{ code: "missing_item" }] } }));
  assert.equal(returned.blocked, false);
  assert.equal(returned.notices[0].code, "kit_incomplete_recorded");
});

test("camera legacy behavior and its implementation identity remain available", async () => {
  const hooks = runtime();
  assert.ok(hooks.registeredVersions().includes("camera_kit_handover@cam-kit-1.0"));
  assert.ok(hooks.registeredVersions().includes("camera_kit_handover@unimplemented"));
  const legacy = buildCameraKitHandoverHookModule();
  assert.equal((await legacy.hooks.pickup_delivery({ subject: subject() })).decision, "allow");
  assert.ok(RENTAL_CAPABILITY_MODULES.find(row => row.code === "camera_kit_handover").conflictsWith.includes("kit_handover"));
  assert.ok(RENTAL_CAPABILITY_MODULES.find(row => row.code === "kit_handover").conflictsWith.includes("camera_kit_handover"));
});

test("Core order Hooks use the original conditional goods and accept unaffected or cancelled lines", async () => {
  const policy = category();
  const groups = [{ id: "kit", inventoryMode: "bundle", attributes: {}, bundleComponents: [] },
    { id: "tripod", inventoryMode: "serialized", attributes: {}, bundleComponents: [] }];
  const requirements = captureCapabilityRequirements(policy, groups, ["kit", "tripod"], "store_pickup_return");
  const core = Object.create(RentalCoreService.prototype);
  core.hooks = runtime(); core.workspaceOf = () => "space"; core.state = () => ({ profile: { categoryCode: policy.code } });
  core.categoryResolver = { forVersion: async (code, id) => { assert.equal(code, policy.code); assert.equal(id, "original-v1"); return structuredClone(policy); } };
  const order = { id: "order", categoryCode: policy.code, categoryVersionId: "original-v1", fulfillmentMode: "store_pickup_return",
    capabilityRequirementsSnapshot: requirements, lines: [{ itemGroupId: "kit", itemGroupName: "布景套装", inventoryMode: "bundle", quantity: 1 },
      { itemGroupId: "tripod", itemGroupName: "三脚架", inventoryMode: "serialized", quantity: 1 }] };
  groups[0].inventoryMode = "serialized";
  await assert.rejects(core.runHook("tenant", "pickup_delivery", { type: "order", id: order.id }, { order, results: {} }, undefined, undefined, []));
  await core.runHook("tenant", "pickup_delivery", { type: "order", id: order.id }, { order, results: { kit_complete: true } }, undefined, undefined, [instance]);
  const narrowed = { ...order, lines: order.lines.map(line => line.itemGroupId === "kit" ? { ...line, cancelledQuantity: 1 } : line) };
  const unaffected = await core.runHook("tenant", "pickup_delivery", { type: "order", id: order.id }, { order: narrowed, results: {} }, undefined, undefined, []);
  assert.equal(unaffected.blocked, false);
  assert.deepEqual(unaffected.executed, []);
  await assert.rejects(core.runHook("tenant", "pickup_delivery", { type: "order", id: order.id }, { order: { ...order, capabilityRequirementsSnapshot: undefined }, results: {} }, undefined, undefined, [instance]), /快照缺失/);
});

test("order preparation clones the original quote's condition evidence after catalog changes", async () => {
  const policy = category(), core = Object.create(RentalCoreService.prototype);
  const state = core.seedState("tenant", policy.code, "space", "CNY", policy);
  const group = { id: "kit", code: "KIT", name: "布景套装", inventoryMode: "bundle", attributes: {}, bundleComponents: [] };
  state.itemGroups = [group]; state.pricingGroups = [];
  state.operators = [{ id: "operator", tenantId: "tenant", code: "SHOP", name: "测试商户", type: "self", status: "enabled", settlementMode: "self" }];
  state.locations = [{ id: "shop", tenantId: "tenant", operatorId: "operator", code: "SHOP", name: "测试门店", type: "store", status: "enabled", capabilities: ["pickup", "return"] }];
  core.state = () => state; core.availability = async () => ({ available: true });
  core.fulfillmentAdmission = async () => ({ locations: state.locations, operators: state.operators });
  const location = state.locations.find(row => row.capabilities.includes("pickup") && row.capabilities.includes("return"));
  assert.ok(location);
  const snapshot = captureCapabilityRequirements(policy, [group], [group.id], "store_pickup_return");
  const quote = { id: "quote", categoryVersionId: "original-v1", capabilityRequirementsSnapshot: snapshot, capabilitySnapshot: [instance],
    request: { lines: [{ itemGroupId: "kit", quantity: 1 }] }, chargeLines: [{ code: "rental:KIT", amount: 12 }],
    ruleSnapshot: { qualification: { required: false }, payment: { unpaidHoldMinutes: 10 } }, rentalAmount: 12, payableAmount: 12 };
  const input = { customerName: "客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id,
    startAt: "2026-11-10T00:00:00Z", endAt: "2026-11-11T00:00:00Z", lines: [{ itemGroupId: group.id, quantity: 1 }] };
  group.attributes.changedLater = true;
  const order = await new Promise((resolve, reject) => requestIdentityMiddleware({}, {}, () => {
    enterRequestIdentity({ tenantId: "tenant", workspaceId: "space", userId: "operator", isSaasAdmin: false, audience: "operator" });
    core.prepareOrder("tenant", input, "operator", quote).then(resolve, reject);
  }));
  assert.equal(order.categoryVersionId, "original-v1");
  assert.deepEqual(order.capabilityRequirementsSnapshot, snapshot);
  assert.notEqual(order.capabilityRequirementsSnapshot, snapshot);
  quote.capabilityRequirementsSnapshot.matches[0].itemGroupIds.length = 0;
  assert.deepEqual(resolveCapabilityRequirements(policy, order.capabilityRequirementsSnapshot).required, ["kit_handover"]);
});

test("incremental extension and exchange freeze their own conditions while original-total keeps the original evidence", async () => {
  const policy = category(), groups = [{ id: "kit", inventoryMode: "bundle", attributes: {}, bundleComponents: [] },
    { id: "tripod", inventoryMode: "serialized", attributes: {}, bundleComponents: [] }];
  const original = { categoryCode: policy.code, categoryVersionId: "original-v1", request: { lines: [{ itemGroupId: "kit", quantity: 1 }], fulfillmentMode: "store_pickup_return" },
    capabilityRequirementsSnapshot: captureCapabilityRequirements(policy, groups, ["kit"], "store_pickup_return"), capabilitySnapshot: [instance] };
  const business = Object.create(RentalBusinessService.prototype);
  business.workspaceOf = () => "space"; business.hooks = runtime();
  business.capabilities = { snapshotEnabled: async () => [instance] };
  business.categoryResolver = { forWorkspace: async () => ({ categoryVersionId: "current-v2", adoptionRevision: 2, definition: policy }), forVersion: async () => policy };
  business.coreConfigStore = { listInspectionTemplates: async () => ["pickup", "return"].map(stage => ({ tenantId: "tenant", categoryCode: policy.code, id: stage, code: stage,
    enabled: true, stage, fields: structuredClone(policy.businessModel.defaults.inspectionFields) })) };
  const context = { category: policy, groups };
  const incremental = await business.extensionExecutionBasis("tenant", context, original, [], "incremental", {}, [{ itemGroupId: "tripod" }]);
  assert.equal(incremental.categoryVersionId, "current-v2");
  assert.deepEqual(resolveCapabilityRequirements(policy, incremental.capabilityRequirementsSnapshot).required, []);
  const originalTotal = await business.extensionExecutionBasis("tenant", context, original, [], "original_total", {});
  assert.equal(originalTotal.categoryVersionId, "original-v1");
  assert.deepEqual(originalTotal.capabilityRequirementsSnapshot, original.capabilityRequirementsSnapshot);
  const priced = { rateSnapshot: [], ruleSnapshot: {} };
  const exchange = await business.captureExchangeExecutionBasis("tenant", context, "replacement_current_price", "2026-11-09T00:00:00Z", priced,
    { itemGroupId: "tripod", fulfillmentMode: "store_pickup_return" });
  assert.deepEqual(exchange.capabilityRequirementsSnapshot.rootItemGroupIds, ["tripod"]);
  assert.ok(exchange.inspectionTemplateSnapshots.every(template => template.fields.length === 0));
  await assert.rejects(business.captureExchangeExecutionBasis("tenant", context, "replacement_current_price", "2026-11-09T00:00:00Z", priced), /实际商品/);
  business.capabilities.snapshotEnabled = async () => [];
  await assert.rejects(business.extensionExecutionBasis("tenant", context, original, [], "incremental", {}));
});

test("Core rechecks new extension conditions at request and replays the locked action evidence at payment", async () => {
  const policy = category(), groups = [{ id: "kit", inventoryMode: "bundle", attributes: {}, bundleComponents: [] }];
  const snapshot = captureCapabilityRequirements(policy, groups, ["kit"], "store_pickup_return");
  const core = Object.create(RentalCoreService.prototype);
  core.hooks = runtime(); core.workspaceOf = () => "space"; core.state = () => ({ profile: { categoryCode: policy.code } });
  core.categoryResolver = { forVersion: async () => policy };
  const order = { id: "order", categoryCode: policy.code, lines: [{ itemGroupId: "kit", itemGroupName: "布景套装", inventoryMode: "bundle", quantity: 1 }] };
  const basis = { categoryCode: policy.code, categoryVersionId: "current-v2", adoptionRevision: 2, policySource: "current_workspace",
    capabilityRequirementsSnapshot: snapshot, capabilitySnapshot: [{ code: instance.code, implementationVersion: instance.implementationVersion, configVersion: instance.configVersion, config: {} }] };
  let binding = 2, catalogReads = 0;
  const tx = { $queryRaw: async () => [{ categoryVersionId: "current-v2", categoryAdoptionRevision: binding }],
    rentalCategoryVersion: { findUnique: async () => ({ categoryCode: policy.code, status: "published", structureVersion: 1, definition: policy }) },
    rentalItemGroup: { findMany: async () => { catalogReads++; return [{ id: "kit", inventoryMode: "BUNDLE", attributes: {}, bundleComponents: [] }]; } },
    workspaceCapabilityInstance: { findMany: async () => [instance] } };
  await core.assertExtensionCapabilityExecution("tenant", order, basis, tx, true);
  assert.equal(catalogReads, 1);
  binding = 3;
  await assert.rejects(core.assertExtensionCapabilityExecution("tenant", order, basis, tx, true), /重新试算/);
  await core.assertExtensionCapabilityExecution("tenant", order, basis, tx, false);
  assert.equal(catalogReads, 1, "a pending action's paid replay does not invent evidence from today's catalog");
  await assert.rejects(core.assertExtensionCapabilityExecution("tenant", order, { ...basis, capabilitySnapshot: [] }, tx, false));
  await assert.rejects(core.assertExtensionCapabilityExecution("tenant", order, { ...basis, capabilityRequirementsSnapshot: undefined }, tx, false), /快照缺失/);
});
