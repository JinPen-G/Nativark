"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { RentalBusinessConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-business-config.repository.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const definition = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera");
const calls = [];
const binding = { categoryVersionId: "v2", adoptionRevision: 2 };
const client = {
  $transaction: async (write) => { calls.push("tx"); return write(client); },
  businessWorkspace: { findFirst: async () => { calls.push("scope"); return { id: "ws" }; } },
  $queryRaw: async () => { calls.push("lock"); return [{ categoryCode: "CAMERA", categoryVersionId: "v2", categoryAdoptionRevision: 2, status: "ACTIVE" }]; },
  rentalCategoryVersion: { findUnique: async () => { calls.push("definition"); return { categoryCode: "CAMERA", structureVersion: 1, status: "published", definition }; } },
  rentalDiscountPlan: { findUnique: async () => null, upsert: async () => { calls.push("discount"); } },
  rentalValueAddedService: { findUnique: async () => null, upsert: async () => { calls.push("service"); } },
  rentalValueAddedServiceVersion: { findUnique: async () => null, create: async () => { calls.push("snapshot"); } }
};
const repo = new RentalBusinessConfigRepository(client);
const scope = (fn) => runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, fn);
const discount = { id: "d", tenantId: "t", categoryCode: "camera", discountValue: 10, minimumSpend: 0, effectiveFrom: "2030-01-01", createdAt: "2030-01-01" };
const service = { id: "s", tenantId: "t", categoryCode: "camera", price: 10, applicableFulfillmentModes: [], version: "1.0", createdAt: "2030-01-01", updatedAt: "2030-01-01" };
(async () => {
  await scope(() => repo.upsertDiscountPlan(discount, binding));
  assert.deepEqual(calls.splice(0), ["scope", "tx", "lock", "definition", "discount"]);
  await scope(() => repo.upsertService(service, binding));
  assert.deepEqual(calls.splice(0), ["scope", "tx", "lock", "definition", "service", "snapshot"]);
  for (const write of [() => repo.upsertDiscountPlan(discount, { ...binding, adoptionRevision: 1 }), () => repo.upsertService(service, { ...binding, adoptionRevision: 1 })]) {
    await assert.rejects(scope(write), /版本已变化/);
    assert.deepEqual(calls.splice(0), ["scope", "tx", "lock"]);
  }
  for (const invalid of [{ ...service, applicableFulfillmentModes: ["onsite_delivery"] }, { ...service, mandatoryRule: { fulfillmentModes: ["onsite_delivery"] } }]) {
    await assert.rejects(scope(() => repo.upsertService(invalid)), /不支持/);
    assert.deepEqual(calls.splice(0), ["scope", "tx", "lock", "definition"]);
  }
  console.log("category-marketing-write: 优惠/服务锁序、过期绑定及不适用履约条件拒绝通过（执行仓储替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
