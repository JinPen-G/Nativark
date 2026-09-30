"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { RentalBusinessConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-business-config.repository.js");
const { RentalBusinessService } = require("../apps/api/dist/modules/rental-core/rental-business.service.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const calls = [];
const binding = { categoryVersionId: "v2", adoptionRevision: 2 };
const old = { ...binding, adoptionRevision: 1 };
const client = {
  $transaction: async (write) => { calls.push("transaction"); return write(client); },
  businessWorkspace: { findFirst: async () => { calls.push("scope"); return { id: "ws" }; } },
  $queryRaw: async () => { calls.push("lock"); return [{ categoryCode: "CAMERA", categoryVersionId: "v2", categoryAdoptionRevision: 2, status: "ACTIVE" }]; },
  rentalCategoryVersion: { findUnique: async () => { calls.push("version"); return { categoryCode: "CAMERA", structureVersion: 1, status: "published", definition }; } },
  rentalPricingPlan: { findUnique: async () => null, upsert: async () => { calls.push("plan"); } },
  rentalPriceVersion: { findFirst: async () => { calls.push("timeline"); return null; }, aggregate: async () => { calls.push("aggregate"); return { _max: { sequence: 0 } }; }, create: async () => { calls.push("price"); return { id: "price" }; } },
  rentalPriceAdjustmentPlan: { findFirst: async () => ({ id: "a", status: "draft", changes: [], scheduledAt: new Date("2090-01-01"), planId: "plan" }) }
};
const repo = new RentalBusinessConfigRepository(client);
const scope = (fn) => runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, fn);
const plan = { id: "plan", tenantId: "t", categoryCode: "camera", code: "P", name: "Price", currency: "CNY", status: "draft", version: "1.0", effectiveFrom: "2030-01-01T00:00:00Z", createdAt: "2030-01-01T00:00:00Z", rates: [{ itemGroupId: "g", unit: "hour", amount: 10 }] };
(async () => {
  await scope(() => repo.upsertPricingPlan(plan, undefined, binding));
  assert.deepEqual(calls.splice(0), ["scope", "transaction", "lock", "version", "plan"], "范围查询不能在等待锁前建立价格事务旧快照");
  await scope(() => repo.upsertPricingPlan(plan, client, binding));
  assert.deepEqual(calls.splice(0), ["scope", "lock", "version", "plan"], "复用外层事务");
  await assert.rejects(scope(() => repo.upsertPricingPlan(plan, undefined, old)), /版本已变化/);
  assert.deepEqual(calls.splice(0), ["scope", "transaction", "lock"]);
  for (const invalid of [{ ...plan, rates: [{ unit: "shift" }] }, { ...plan, fulfillmentFees: [{ mode: "onsite_delivery", amount: 1 }] }]) {
    await assert.rejects(scope(() => repo.upsertPricingPlan(invalid)), /不支持/);
    assert.deepEqual(calls.splice(0), ["scope", "transaction", "lock", "version"]);
  }
  const service = Object.create(RentalBusinessService.prototype);
  const input = { tenantId: "t", workspaceId: "ws", effectiveFrom: new Date(), rates: plan.rates, changeReason: "fixture" };
  await service.appendSpaceVersion(client, input);
  assert.deepEqual(calls.splice(0), ["lock", "version", "timeline", "aggregate", "price"]);
  await assert.rejects(service.appendSpaceVersion(client, { ...input, rates: [{ unit: "shift" }] }), /不支持/);
  assert.deepEqual(calls.splice(0), ["lock", "version"]);
  service.prisma = client;
  service.workspaceOf = () => "ws";
  service.state = () => ({ pricingPlans: [plan] });
  service.categoryResolver = { forWorkspace: async () => ({ definition, ...old }) };
  const context = { profile: { categoryCode: "camera" }, category: definition, pricingGroups: [{ id: "g", name: "group" }] };
  await assert.rejects(service.updatePricingGroupSecurityRates("t", context, "g", []), /版本已变化/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"]);
  await assert.rejects(service.restoreSpacePriceVersion("t", context, 1, "restore"), /版本已变化/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"]);
  await assert.rejects(service.confirmPriceAdjustment("t", context, "plan", "a"), /版本已变化/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"]);
  await assert.rejects(service.applyPriceAdjustmentInternal("t", context, "plan", "a"), /版本已变化/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"]);
  service.categoryResolver = { forWorkspace: async () => { throw new Error("不能替换确认请求的原绑定"); } };
  await assert.rejects(service.applyPriceAdjustmentInternal("t", context, "plan", "a", undefined, old), /版本已变化/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"], "即时确认必须沿用入口绑定，不能重新取绑定绕过旧请求保护");
  await assert.rejects(service.applyPriceAdjustmentInternal("t", context, "plan", "a", undefined, binding), /尚未到生效时间/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version"], "锁后发现未来定时计划必须拒绝，不提前生成价格版本");
  console.log("category-price-write: 价格计划/版本适用范围、外层事务复用、资金费率/恢复/确认/执行旧绑定拒绝通过（替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
