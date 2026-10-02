"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { categoryAdoptionServiceCapacity: check } = require("../apps/api/dist/modules/rental-core/category-adoption-service-capacity.js");
const target = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const now = new Date("2026-10-01"), future = new Date("2099-01-01");
const service = { id: "s", status: "enabled", requiresCapacity: true };
const capacity = { id: "c", serviceId: "s", locationId: "l", status: "enabled", windowEnd: future };
const input = { services: [service], locations: [{ id: "l", type: target.businessModel.locationTypes[0] }], capacities: [capacity] };
assert.equal(check(target, input, now).valid, true);
for (const override of [{ services: [] }, { locations: [] }, { locations: [{ id: "l", type: "unsupported" }] }, { capacities: [{ ...capacity, serviceId: "foreign" }] }, { capacities: [{ ...capacity, locationId: "foreign" }] }]) {
  const bad = { ...input, ...override }, before = structuredClone(bad);
  assert.deepEqual(check(target, bad, now).blockers.map((row) => row.id), ["c"]);
  assert.deepEqual(bad, before, "检查不得重写容量或预留事实");
}
for (const override of [{ status: "disabled" }, { windowEnd: now }, { windowEnd: new Date("2025-01-01") }]) assert.equal(check(target, { ...input, locations: [], capacities: [{ ...capacity, ...override }] }, now).valid, true);
for (const override of [{ status: "disabled" }, { requiresCapacity: false }]) assert.equal(check(target, { ...input, locations: [], services: [{ ...service, ...override }] }, now).valid, true, "停用或不再使用容量的服务不影响历史预留");
assert.equal(check(target, input, now).complete, false);
console.log("category-adoption-service-capacity: 空间引用、目标地点、停用/已结束窗口、非执行服务及事实保留通过");
