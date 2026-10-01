"use strict";
const assert = require("node:assert/strict");
const { categoryAdoptionPriceReferences: check } = require("../apps/api/dist/modules/rental-core/category-adoption-price-references.js");
const now = new Date("2026-10-01"), rate = { itemGroupId: "g", unit: "hour" };
const timed = (id, date, value) => ({ id, effectiveFrom: new Date(date), sequence: 1, value });
const input = { groups: [{ id: "g" }], pricingGroups: [{ id: "p" }], prices: [timed("old", "2025-01-01", [{ itemGroupId: "retired", unit: "hour" }]), timed("current", "2026-01-01", [rate])], adjustments: [], plans: [] };
assert.equal(check(input, now).valid, true);
for (const value of [null, [], {}, [null], [{ unit: "hour" }], [{ ...rate, pricingGroupId: "foreign" }], [rate, rate]]) {
  assert.equal(check({ ...input, prices: [timed("current", "2026-01-01", value)] }, now).valid, false);
}
assert.equal(check({ ...input, prices: [timed("current", "2026-01-01", [{ ...rate, itemGroupId: "legacy-alias", pricingGroupId: "p" }])] }, now).valid, true, "分组优先，非执行旧别名不当作目标");
assert.equal(check({ ...input, prices: [...input.prices, timed("future", "2099-01-01", [{ ...rate, itemGroupId: "foreign" }])]}, now).valid, false);
const plan = { id: "plan", status: "enabled", effectiveTo: null, rates: [{ ...rate, itemGroupId: "foreign" }] };
assert.equal(check({ ...input, plans: [plan] }, now).valid, false);
for (const override of [{ status: "disabled" }, { effectiveTo: now }]) assert.equal(check({ ...input, plans: [{ ...plan, ...override }] }, now).valid, true);
assert.equal(check({ ...input, adjustments: [{ id: "pending", status: "pending", finalRates: plan.rates }] }, now).valid, false);
assert.equal(check({ ...input, adjustments: [{ id: "past", status: "applied", finalRates: plan.rates }] }, now).valid, true);
const before = structuredClone(input); check(input, now); assert.deepEqual(input, before);
assert.equal(check(input, now).complete, false);
console.log("category-adoption-price-references: 执行目标优先级、当前/未来/待调价/启用计划、重复单位、历史保留通过");
