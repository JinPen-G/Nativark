"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { readCategoryAdoptionCompatibility: read } = require("../apps/api/dist/modules/rental-core/category-adoption-compatibility-reader.js");
const { CategoryAdoptionPreparationService } = require("../apps/api/dist/modules/rental-core/category-adoption-preparation.service.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const target = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const now = new Date("2026-10-01T00:00:00Z");
const data = {
  rentalTenantBusinessSettings: null,
  rentalFulfillmentLocation: [{ id: "l", type: "store", status: "enabled", operatorId: "op", parentLocationId: null, capabilities: ["pickup", "return"] }],
  rentalFulfillmentOperator: [{ id: "op" }],
  rentalPriceVersion: [], rentalRuleVersion: [], rentalInspectionTemplate: [],
  workspaceCapabilityInstance: [], customerMembershipQualificationType: [],
  rentalPriceAdjustmentPlan: [], rentalPricingPlan: [], rentalValueAddedService: [],
  rentalPricingGroup: [{ id: "p", status: "enabled", defaultPricingUnit: "hour", members: [{ itemGroupId: "g" }] }],
  rentalDiscountPlan: [], rentalCouponTemplate: [], rentalServiceCapacity: []
};
const calls = [];
const tx = new Proxy({}, { get(target, model) {
  // Explicit transaction auth rows supplied later by the production-mapping
  // fixture; all compatibility models retain the read-only/scoped assertions.
  if (Object.hasOwn(target, model)) return Reflect.get(target, model);
  assert.ok(model in data, `不得使用事务外读取/写入: ${String(model)}`);
  return new Proxy({}, { get(_, method) {
    assert.ok(["findFirst", "findMany"].includes(method), `不允许写方法 ${method}`);
    return async (query) => {
      assert.equal(query.where.tenantId, "t");
      assert.equal(query.where.workspaceId, "w");
      calls.push({ model, query });
      return structuredClone(data[model]);
    };
  } });
} });
const records = { groups: [{ id: "g", status: "enabled", inventoryMode: "serialized", bundleComponents: [] }], assets: [{ id: "a", itemGroupId: "g", locationId: "l" }] };
const capabilities = { adoptionCompatibility(definition, instances, versions) {
  assert.equal(definition, target); assert.deepEqual(instances, []); assert.deepEqual(versions, ["test"]);
  return { valid: true, blockers: [], checkedCapabilityCodes: [] };
} };
(async () => {
  const before = structuredClone({ data, records, target });
  const result = await read(tx, "t", "w", target, records, capabilities, { registeredVersions: () => ["test"] }, now);
  assert.equal(result.valid, true); assert.equal(result.complete, false);
  assert.equal(calls.length, 16);
  assert.equal(calls.find((row) => row.model === "rentalFulfillmentLocation").query.select.operatorId, true);
  assert.deepEqual({ data, records, target }, before);
  data.rentalFulfillmentLocation[0].operatorId = "foreign";
  const foreignOperator = await read(tx, "t", "w", target, records, capabilities, { registeredVersions: () => ["test"] }, now);
  assert.equal(foreignOperator.valid, false);
  assert.ok(foreignOperator.blockers.some((row) => row.domain === "fulfillment_reference"));
  data.rentalFulfillmentLocation[0].operatorId = "op";
  const emptyBundleRecords = { ...records, groups: [...records.groups,
    { id: "empty-bundle", status: "enabled", inventoryMode: "BUNDLE", bundleComponents: [] }] };
  const brokenGraph = await read(tx, "t", "w", target, emptyBundleRecords, capabilities, { registeredVersions: () => ["test"] }, now);
  assert.equal(brokenGraph.valid, false);
  assert.ok(brokenGraph.blockers.some((row) => row.domain === "bundle_reference"));
  assert.deepEqual(calls.find((row) => row.model === "rentalServiceCapacity").query.where.windowEnd, { gt: now });
  assert.equal(calls.find((row) => row.model === "rentalInspectionTemplate").query.select.categoryCode, true, "启用模板归属必须进入事务投影");
  const { WorkspaceCapabilityService } = require("../apps/api/dist/modules/rental-core/workspace-capability.service.js");
  const liveCapability = { code: "camera_compatibility", status: "enabled", revision: 7, implementationVersion: "cam-1.0", config: { relations: [{ id: "r", relationType: "model_fit", source: { kind: "item_group", id: "foreign" }, target: { kind: "asset", id: "a" }, outcome: "warn", sourceName: "fixture", reason: "fixture" }] } };
  data.workspaceCapabilityInstance = [liveCapability];
  const liveBefore = structuredClone(data.workspaceCapabilityInstance);
  const actualCapabilities = new WorkspaceCapabilityService({});
  const actualHooks = { registeredVersions: () => ["camera_compatibility@cam-1.0"] };
  const unprepared = await read(tx, "t", "w", target, records, actualCapabilities, actualHooks, now);
  assert.ok(unprepared.blockers.some((row) => row.domain === "capability_reference"));
  const prepared = await read(tx, "t", "w", target, records, actualCapabilities, actualHooks, now, [{ code: liveCapability.code, expectedRevision: 7, expectedImplementationVersion: "cam-1.0", config: { relations: [] } }]);
  assert.ok(!prepared.blockers.some((row) => row.domain === "capability_reference"), "引用检查必须消费准备配置，不应重复检查旧活动关系");
  assert.deepEqual(data.workspaceCapabilityInstance, liveBefore, "共享读取不能改变活动关系");
  data.workspaceCapabilityInstance = [];
  data.rentalPricingGroup[0].members = [{ itemGroupId: "foreign" }];
  data.rentalPriceVersion.push({ id: "future", effectiveFrom: new Date("2126-01-01"), sequence: 1, rates: [{ itemGroupId: "foreign", unit: "shift" }] });
  const invalid = await read(tx, "t", "w", target, records, capabilities, { registeredVersions: () => ["test"] }, now);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.blockers.some((row) => row.domain === "pricing_group"));
  assert.ok(invalid.blockers.some((row) => row.domain === "price_reference"));
  data.rentalPricingGroup = []; data.rentalPriceVersion = [];
  let commercialReads = 0, commercialFails = false;
  const subscriptions = { async readCategoryCommercialContext(tenantId, transaction, timestamp) {
    commercialReads++;
    assert.equal(tenantId, "t"); assert.equal(transaction, tx); assert.ok(timestamp instanceof Date);
    if (commercialFails) throw new Error("订阅读取失败");
    return { serviceStatus: "expired", revision: 1, newBusinessAllowed: false, entitlements: [], complete: false };
  } };
  const { categoryWorkspaceAuth } = require("./fixtures/category-workspace-auth.cjs");
  const access = categoryWorkspaceAuth(tx, { tenantId: "t", userId: "operator", workspaceId: "w" });
  const service = new CategoryAdoptionPreparationService({ $transaction: (fn) => fn(tx) }, capabilities, { registeredVersions: () => ["test"] }, subscriptions, access.auth);
  service.context = async () => ({ workspace: { categoryVersionId: "old", categoryAdoptionRevision: 0 }, workspaceId: "w", target: { versionLabel: "new" }, definition: target, sourceDefinition: target, preparation: null, records: { groups: [], assets: [] } });
  const user = { id: "operator", tenantId: "t", isSaasAdmin: false, permissions: ["rental-os:category:adopt"] };
  const preview = (candidate = user) => runWithRequestIdentity(access.identity, () => service.preview(candidate, "new", "upgrade"));
  const expired = await preview();
  assert.equal(expired.businessCompatibility.valid, false);
  assert.ok(expired.businessCompatibility.blockers.some((row) => row.domain === "commercial"));
  assert.equal(expired.adoptionImplemented, false);
  await assert.rejects(preview({ ...user, permissions: [] }), /仅获授权/);
  assert.equal(commercialReads, 1, "无权限在商业读取前拒绝");
  commercialFails = true;
  await assert.rejects(preview(), /订阅读取失败/, "商业读取异常不可伪装成未配置或兼容");
  console.log("category-adoption-compatibility-reader: 16个同事务空间读取、只读、履约关联和未来价格复用通过");
})().catch((error) => { console.error(error); process.exitCode = 1; });
