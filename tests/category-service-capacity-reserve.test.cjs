"use strict";
const assert = require("node:assert/strict");
const { RentalServiceCapacityService } = require("../apps/api/dist/modules/rental-core/rental-service-capacity.service.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const old = { id: "c", serviceId: "s", locationId: "l", windowStart: new Date("2099-01-01"), windowEnd: new Date("2099-01-02"), totalCapacity: 5, reservedQuantity: 0, usedQuantity: 0 };
let changed, recorded = 0;
const client = {
  businessWorkspace: { findFirst: async () => ({ id: "ws" }) },
  rentalServiceReservation: { findFirst: async () => null, create: async () => { ++recorded; } },
  rentalServiceCapacity: {
    findFirst: async () => old,
    updateMany: async ({ where }) => {
      assert.equal(where.tenantId, "t"); assert.equal(where.workspaceId, "ws");
      assert.equal(where.serviceId, old.serviceId); assert.equal(where.locationId, old.locationId);
      assert.deepEqual(where.windowStart, old.windowStart); assert.deepEqual(where.windowEnd, old.windowEnd);
      const current = { ...old, ...changed };
      return { count: ["serviceId", "locationId", "windowStart", "windowEnd"].every((key) => String(where[key]) === String(current[key])) ? 1 : 0 };
    }
  }
};
const service = new RentalServiceCapacityService(client);
service.releaseExpired = async () => 0;
const order = { id: "o", reservations: [], serviceSnapshots: [{ serviceId: "s", serviceName: "test", requiresCapacity: true, capacityQuantity: 1, serviceLocationId: "l", scheduledStartAt: "2099-01-01T01:00:00Z", scheduledEndAt: "2099-01-01T02:00:00Z" }] };
const reserve = () => runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, () => service.reserveForOrder("t", order, "key", client));
(async () => {
  for (changed of [{ serviceId: "other" }, { locationId: "other" }, { windowStart: new Date("2100-01-01") }, { windowEnd: new Date("2100-01-02") }]) {
    await assert.rejects(reserve(), /容量已被其他订单占用/);
    assert.equal(recorded, 0, "陈旧窗口不可登记预留流水");
  }
  changed = {};
  await reserve(); assert.equal(recorded, 1, "窗口未变仍按原有条件预留");
  console.log("category-service-capacity-reserve: 服务/地点/时段四类陈旧身份拒绝、计数及作用域条件保留通过（执行替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
