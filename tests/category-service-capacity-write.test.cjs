"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { RentalServiceCapacityService } = require("../apps/api/dist/modules/rental-core/rental-service-capacity.service.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const definition = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera");
const calls = [];
let locationType = "store";
let bindingStatus = "ACTIVE";
const input = { serviceId: "s", locationId: "l", windowStart: "2099-01-01", windowEnd: "2099-01-02", totalCapacity: 3, status: "enabled" };
const client = {
  businessWorkspace: { findFirst: async () => ({ id: "ws" }) },
  $transaction: async (write, options) => { assert.equal(options.isolationLevel, "ReadCommitted"); return write(client); },
  $queryRaw: async (sql) => { calls.push(sql.sql.includes("rental_service_capacities") ? "row-lock" : "space-lock"); return [{ categoryCode: "CAMERA", categoryVersionId: "v2", categoryAdoptionRevision: 1, status: bindingStatus }]; },
  rentalCategoryVersion: { findUnique: async () => { calls.push("definition"); return { categoryCode: "CAMERA", structureVersion: 1, status: "published", definition }; } },
  rentalValueAddedService: { findFirst: async () => { calls.push("service"); return { requiresCapacity: true }; } },
  rentalFulfillmentLocation: { findFirst: async () => { calls.push("location"); return { type: locationType }; } },
  rentalServiceCapacity: {
    findUnique: async () => { calls.push("existing"); return { ...input, tenantId: "t", workspaceId: "ws", reservedQuantity: 0, usedQuantity: 0, windowStart: new Date(input.windowStart), windowEnd: new Date(input.windowEnd) }; },
    findFirst: async () => { calls.push("overlap"); return null; },
    upsert: async () => { calls.push("write"); return { ...input, id: "c", tenantId: "t", workspaceId: "ws", reservedQuantity: 0, usedQuantity: 0, windowStart: new Date(input.windowStart), windowEnd: new Date(input.windowEnd), createdAt: new Date(), updatedAt: new Date() }; }
  }
};
const service = new RentalServiceCapacityService(client);
const save = (overrides = {}) => runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, () => service.saveCapacity("t", { ...input, ...overrides }));
(async () => {
  await save();
  assert.deepEqual(calls.splice(0), ["space-lock", "definition", "service", "location", "overlap", "write"]);
  await save({ id: "c" });
  assert.deepEqual(calls.splice(0), ["space-lock", "definition", "row-lock", "service", "location", "existing", "overlap", "write"]);
  locationType = "project_site";
  await assert.rejects(save(), /不支持/);
  assert.ok(!calls.splice(0).includes("write"));
  await save({ status: "disabled" });
  assert.ok(calls.splice(0).includes("write"), "不阻断停用不再适用的窗口");
  await save({ windowStart: "2000-01-01", windowEnd: "2000-01-02" });
  assert.ok(calls.splice(0).includes("write"), "历史窗口不强套新地点定义");
  bindingStatus = "PAUSED";
  await assert.rejects(save(), /不可用/);
  assert.deepEqual(calls.splice(0), ["space-lock"]);
  console.log("category-service-capacity-write: RC/空间锁/容量行锁、最新地点范围、停用与历史保留通过（执行替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
