"use strict";
const assert = require("node:assert/strict");
const { RentalServiceCapacityService } = require("../apps/api/dist/modules/rental-core/rental-service-capacity.service.js");
const { RentalBusinessConfigRepository } = require("../apps/api/src/modules/rental-core/rental-business-config.repository");
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
  const occurrence = { ...order.serviceSnapshots[0], occurrenceId: "original", workspaceId: "ws", quantity: 1,
    reservationKey: "original-capacity", executionStatus: "not_started" };
  let readTrace = [];
  const originalReceipt = { id: "r", idempotencyKey: "original-capacity", serviceId: "s", capacityId: "c", quantity: 1, status: "confirmed" };
  const originalCapacity = { ...old, status: "enabled", reservedQuantity: 0, usedQuantity: 1 };
  let receipt = originalReceipt, capacity = originalCapacity;
  client.$queryRaw = async query => {
    assert.match(query.sql, /FOR UPDATE/);
    if (/rental_service_reservations/.test(query.sql)) { readTrace.push("receipt"); return receipt ? [receipt] : []; }
    assert.match(query.sql, /rental_service_capacities/); readTrace.push("capacity"); return [capacity];
  };
  const retained = () => runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, () => service.assertRetainedForExchange("t", "o", [occurrence], client));
  await retained(); assert.deepEqual(readTrace, ["receipt", "capacity"]);
  await assert.rejects(runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, () =>
    service.assertRetainedForExchange("t", "o", [occurrence, { ...occurrence, occurrenceId: "duplicate" }], client)), /共用了容量收据/);
  for (const patch of [{ status: "released" }, { status: "reserved" }, { serviceId: "other" }, { quantity: 2 }]) {
    receipt = { ...originalReceipt, ...patch }; await assert.rejects(retained(), /原已确认容量/);
  }
  receipt = originalReceipt;
  for (const patch of [{ status: "disabled" }, { locationId: "other" }, { serviceId: "other" },
    { windowStart: new Date("2100-01-01") }, { usedQuantity: 0 }, { totalCapacity: 0 }, { reservedQuantity: 5 }]) {
    capacity = { ...originalCapacity, ...patch }; await assert.rejects(retained(), /原容量已停用|数量不一致/);
  }
  capacity = { ...originalCapacity, status: "disabled" };
  await runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, () =>
    service.assertServiceChangeForExchange("t", "o", [], [occurrence], client));
  await assert.rejects(retained(), /原容量已停用/);
  for (const patch of [{ quantity: 2 }, { serviceId: "other" }, { status: "used" }]) {
    receipt = { ...originalReceipt, ...patch };
    await assert.rejects(runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, () =>
      service.assertServiceChangeForExchange("t", "o", [], [occurrence], client)), /原已确认容量/);
  }
  receipt = originalReceipt;
  assert.equal(recorded, 1, "换货只读复验原容量，不另预留或释放");
  const trace = [];
  const db = { businessWorkspace: { findFirst: async () => ({ id: "ws" }) }, $queryRaw: async query => {
    assert.match(query.sql, /FOR UPDATE/);
    if (/business_workspaces/.test(query.sql)) { trace.push("workspace"); return [{ id: "ws" }]; }
    trace.push("current-services"); assert.match(query.sql, /rental_value_added_services/);
    return [{ id: "s", tenantId: "t", workspaceId: "ws", categoryCode: "CAMERA", code: "S", name: "Current",
      serviceType: "other", billingUnit: "per_order", price: 1, minimumQuantity: 1, maximumQuantity: 1,
      termsVersion: "1", terms: "原条款", customerScope: "all", selectionMode: "optional", requiresCapacity: 1,
      status: "enabled", version: "1", createdAt: new Date(0), updatedAt: new Date(0) }];
  } };
  const catalog = await runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, () =>
    new RentalBusinessConfigRepository({}).readServicesForExchange("t", "ws", db));
  assert.deepEqual(trace, ["workspace", "current-services"]); assert.equal(catalog[0].requiresCapacity, true);
  assert.equal(catalog[0].categoryCode, "camera");
  console.log("category-service-capacity-reserve: 原预留CAS、换货原容量收据及同空间当前服务锁/SQL布尔映射通过（执行替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
