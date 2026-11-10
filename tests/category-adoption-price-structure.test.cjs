"use strict";
require("reflect-metadata");
const assert = require("node:assert/strict");
const { categoryAdoptionRateErrors: check, categoryAdoptionPriceStructure: preview } = require("../apps/api/dist/modules/rental-core/category-adoption-price-structure.js");
const rate = { id: "r", itemGroupId: "g", itemGroupCode: "G", itemGroupName: "name", unit: "hour", baseAmount: 10, weekendMultiplier: 1, holidayMultiplier: 1, depositAmount: 0, minimumUnits: 1 };
assert.deepEqual(check(rate), []);
assert.deepEqual(check({ ...rate, pricingGroupId: "p", pricingGroupCode: "P", pricingGroupName: "plan", maxAmount: 0, baseAmount: 0 }), [], "展示元数据与免租零值合法");
const window = { fromWeekday: 1, fromTime: "08:00", toWeekday: 1, toTime: "10:00", multiplier: 1 };
const override = { id: "x", start: "2027-01-01T00:00:00Z", end: "2027-01-02T00:00:00Z", multiplier: 1 };
for (const bad of [null, [], {}, { ...rate, baseAmount: -1 }, { ...rate, baseAmount: "10" }, { ...rate, minimumUnits: 0 },
  { ...rate, hourGranularityMinutes: 0 }, { ...rate, unknownExecution: true },
  { ...rate, tiers: [{ minUnits: 1, unitAmount: 1 }, { minUnits: 1, unitAmount: 2 }] },
  { ...rate, tierMode: "progressive" }, { ...rate, includedUsage: 0 },
  { ...rate, dayTypePrices: { weekend: -1 } }, { ...rate, dayTypePrices: { weekend: "1" } }, { ...rate, dayTypePrices: { invented: 1 } },
  { ...rate, periodicWindows: [window, window] }, { ...rate, periodicWindows: [{ ...window, toTime: "08:00" }] },
  { ...rate, periodicWindows: [{ ...window, toTime: "24:59" }] },
  { ...rate, datetimeOverrides: [override, override] }, { ...rate, datetimeOverrides: [{ ...override, end: override.start }] }]) {
  const before = structuredClone(bad); assert.ok(check(bad).length); assert.deepEqual(bad, before);
}
assert.deepEqual(check({ ...rate, periodicWindows: [window, { ...window, fromTime: "10:00", toTime: "24:00" }], datetimeOverrides: [override], dayTypePrices: { workday: 1, weekend: 1, statutory_holiday: 1.5, makeup_workday: 1, tenant_special: 0 } }), [], "相邻半开区间、合法日类型和24:00边界允许");
const usage = { ...rate, unit: "usage", excessUsageAmount: 0, includedUsage: 0, usagePrecision: 2 };
assert.deepEqual(check(usage), []);
assert.deepEqual(check({ ...usage, excessUsageAmount: undefined, tierMode: "progressive", tiers: [{ minUnits: 1, unitAmount: 2 }] }), []);
for (const bad of [{ ...usage, excessUsageAmount: undefined }, { ...usage, tierMode: "whole_order" },
  { ...usage, tierMode: "progressive", tiers: [{ minUnits: 1, unitAmount: 2 }] },
  { ...usage, excessUsageAmount: undefined, tierMode: "progressive", tiers: [{ minUnits: 2, unitAmount: 2 }] }]) assert.ok(check(bad).length);
const unsafe = JSON.parse(JSON.stringify(rate)); Object.defineProperty(unsafe, "__proto__", { value: {}, enumerable: true });
assert.ok(check(unsafe).length); assert.ok(Object.hasOwn(unsafe, "__proto__"));
const now = new Date("2026-10-01"), timed = (id, at, value) => ({ id, effectiveFrom: new Date(at), sequence: 1, value });
const invalid = { ...rate, baseAmount: -1 }, input = { prices: [timed("old", "2025-01-01", [invalid]), timed("current", "2026-01-01", [rate])], adjustments: [], plans: [] };
const before = structuredClone(input); assert.equal(preview(input, now).valid, true);
assert.equal(preview({ ...input, prices: [...input.prices, timed("future", "2027-01-01", [invalid])] }, now).valid, false);
assert.equal(preview({ ...input, prices: [timed("empty", "2026-01-01", [])] }, now).valid, true, "价格时间轴合法空值不替代报价就绪门禁");
for (const status of ["draft", "cancelled", "applied"]) assert.equal(preview({ ...input, adjustments: [{ id: "a", status, finalRates: [invalid] }] }, now).valid, true);
assert.equal(preview({ ...input, adjustments: [{ id: "a", status: "pending", finalRates: [invalid] }] }, now).valid, false);
assert.equal(preview({ ...input, plans: [{ id: "p", status: "enabled", effectiveTo: null, rates: [invalid] }] }, now).valid, false);
assert.equal(preview({ ...input, plans: [{ id: "p", status: "enabled", effectiveTo: now, rates: [invalid] }] }, now).valid, true);
assert.deepEqual(input, before); assert.equal(preview(input, now).complete, false);
const plan = { id: "fee-plan", status: "enabled", effectiveTo: null, rates: [rate] };
assert.equal(preview({ ...input, plans: [{ ...plan, fulfillmentFees: [{ mode: "store_pickup_return", amount: 0, crossLocationAmount: 0 }] }] }, now).valid, true, "零履约费合法且不等于缺金额");
for (const fulfillmentFees of [{}, [{ mode: "store_pickup_return" }], [{ mode: "store_pickup_return", amount: -1 }], [{ mode: "store_pickup_return", amount: "0" }],
  [{ mode: "store_pickup_return", amount: 0, unknownExecutor: true }], [{ mode: "store_pickup_return", amount: 0 }, { mode: "store_pickup_return", amount: 1 }]]) {
  const selected = { ...plan, fulfillmentFees }, saved = structuredClone(selected);
  assert.ok(preview({ ...input, plans: [selected] }, now).blockers.some(row => row.id === "fee-plan:fulfillmentFees"));
  assert.deepEqual(selected, saved);
  assert.equal(preview({ ...input, plans: [{ ...selected, effectiveTo: now }] }, now).valid, true);
}
console.log("category-adoption-price-structure: input contract, pricing windows, usage tiers, fulfillment fees, zero values and historical isolation passed");
