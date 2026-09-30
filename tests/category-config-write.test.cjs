"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { RentalCoreConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-core-config.repository.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const calls = [];
const client = {
  $transaction: async (write, options) => { assert.equal(options?.isolationLevel, "ReadCommitted", "自建配置事务必须避免锁前旧快照"); calls.push("transaction"); return write(client); },
  businessWorkspace: { findFirst: async () => ({ id: "ws" }) },
  $queryRaw: async () => { calls.push("lock"); return [{ categoryCode: "CAMERA", categoryVersionId: "v2", categoryAdoptionRevision: 2, status: "ACTIVE" }]; },
  rentalCategoryVersion: { findUnique: async () => { calls.push("version"); return { categoryCode: "CAMERA", structureVersion: 1, status: "published", definition }; } }
};
for (const name of ["rentalTenantBusinessSettings", "rentalFulfillmentLocation", "rentalFulfillmentOperator", "rentalInspectionTemplate"]) client[name] = {
  findUnique: async () => null, upsert: async () => { calls.push(name); return {}; }
};
const repo = new RentalCoreConfigRepository(client);
const scope = (fn) => runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, fn);
const binding = { categoryVersionId: "v2", adoptionRevision: 2 };
const stale = { categoryVersionId: "v1", adoptionRevision: 1 };
const settings = { tenantId: "t", categoryCode: "camera", pricing: { enabledUnits: ["hour"], defaultUnit: "hour" }, fulfillment: { enabledModes: ["store_pickup_return"] }, calendar: { holidayPricingEnabled: false } };
(async () => {
  await scope(() => repo.upsertBusinessSettings(settings, "admin", undefined, binding));
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "rentalTenantBusinessSettings"]);
  await assert.rejects(scope(() => repo.upsertBusinessSettings(settings, "admin", undefined, stale)), /版本已变化/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"], "冲突不写入也不发布缓存");
  for (const invalid of [
    { ...settings, pricing: { enabledUnits: ["shift"], defaultUnit: "shift" } },
    { ...settings, fulfillment: { enabledModes: ["onsite_delivery"] } },
    { ...settings, categoryCode: "vehicle" }
  ]) await assert.rejects(scope(() => repo.upsertBusinessSettings(invalid, "admin")), /不支持|不一致/);
  definition.businessModel.supportsHolidayPricing = false;
  await assert.rejects(scope(() => repo.upsertBusinessSettings({ ...settings, calendar: { holidayPricingEnabled: true } }, "admin")), /节假日/);
  calls.length = 0;
  const location = { id: "l", tenantId: "t", type: "store", code: "L", name: "store", capabilities: ["pickup"], status: "enabled" };
  await scope(() => repo.upsertLocation(location, client, binding));
  assert.deepEqual(calls.splice(0), ["lock", "version", "rentalFulfillmentLocation"], "外层事务直接复用，不嵌套开事务");
  await assert.rejects(scope(() => repo.upsertLocation({ ...location, type: "project_site" })), /不支持/);
  await assert.rejects(scope(() => repo.upsertLocation(location, undefined, stale)), /版本已变化/);
  calls.length = 0;
  await scope(() => repo.upsertOperator({ id: "op", tenantId: "t", code: "OP", name: "operator", type: "self_operated", status: "enabled", createdAt: new Date().toISOString() }));
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "rentalFulfillmentOperator"]);
  await scope(() => repo.upsertInspectionTemplate({ id: "inspection", tenantId: "t", categoryCode: "camera", code: "I", name: "inspection", stage: "pickup", version: "1", fields: [], enabled: true }));
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "rentalInspectionTemplate"]);
  console.log("category-config-write: 设置/地点绑定复核、当前定义校验、主体/检查模板同锁与外层事务复用通过（仓储替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
