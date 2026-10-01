"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { categoryAdoptionRuleParameterErrors: check } = require("../apps/api/dist/modules/rental-core/category-adoption-rule-parameters.js");
const { categoryAdoptionBusinessCompatibility: preview } = require("../apps/api/dist/modules/rental-core/category-adoption-business-compatibility.js");
const rule = { pricing: {}, payment: { preauthorizationRequired: false, depositMode: "none" }, overdue: { feeMode: "none" } };
assert.deepEqual(check(rule), [], "不替代缺省的旧版规则节");
for (const value of [undefined, 0, -1, 25, NaN, Infinity, "8", null]) {
  assert.ok(check({ ...rule, pricing: { hourToDayEnabled: true, hourToDayThresholdHours: value } }).length);
}
assert.deepEqual(check({ ...rule, pricing: { hourToDayEnabled: true, hourToDayThresholdHours: 24 } }), []);
for (const value of [undefined, 0, -1, 101, NaN, Infinity, "10"]) {
  assert.ok(check({ ...rule, overdue: { feeMode: "hourly_to_daily", hourlyRatePercent: value, dailyAfterHours: 8 } }).length);
}
for (const value of [undefined, 0, 25, Infinity]) assert.ok(check({ ...rule, overdue: { feeMode: "hourly_to_daily", hourlyRatePercent: 10, dailyAfterHours: value } }).length);
assert.deepEqual(check({ ...rule, overdue: { feeMode: "hourly_to_daily", hourlyRatePercent: 100, dailyAfterHours: 24 } }), []);
for (const value of [null, [], { mode: "order_fixed" }, { mode: "none", fixedAmount: 10 }, { mode: "invalid" }, { mode: "order_fixed", fixedAmount: -1 }]) {
  assert.ok(check({ ...rule, deposit: value }).length);
}
assert.ok(check({ ...rule, preauthorization: { mode: "risk_surcharge" } }).length);
assert.deepEqual(check({ ...rule, deposit: { mode: "order_fixed", fixedAmount: 0 }, preauthorization: { mode: "risk_surcharge", riskSurchargeAmount: 5 } }), []);
const policy = { enabled: true, allowedRiskLevels: ["standard"], maxReductionPercent: 50, maxReductionAmount: 100 };
for (const value of [null, [], { unknown: policy }, { deposit: { enabled: "false" } }, { deposit: { ...policy, allowedRiskLevels: [] } }, { deposit: { ...policy, allowedRiskLevels: ["unknown"] } }, { deposit: { ...policy, maxReductionPercent: 101 } }, { deposit: { ...policy, maxReductionAmount: 0 } }]) assert.ok(check({ ...rule, membershipSecurityReduction: value }).length);
assert.deepEqual(check({ ...rule, membershipSecurityReduction: { deposit: policy, preauthorization: { enabled: false } } }), []);
for (const value of [0, -1, NaN, Infinity, "15"]) assert.ok(check({ ...rule, payment: { ...rule.payment, unpaidHoldMinutes: value } }).length);
for (const value of [0, 1.5, 1441]) assert.ok(check({ ...rule, payment: { ...rule.payment, quoteValidityMinutes: value } }).length);
assert.deepEqual(check({ ...rule, payment: { ...rule.payment, quoteValidityMinutes: 1440 } }), []);
assert.ok(check({ ...rule, damage: { manualReviewRequired: false } }).length);
assert.ok(check({ ...rule, cancellation: { weatherExceptionEnabled: true } }).length);
for (const noShow of [null, [], {}, { pickupGraceMinutes: 0, finalizationMinutes: 1, feeType: "percentage", feeValue: 101 }]) assert.ok(check({ ...rule, cancellation: { noShow } }).length);
const target = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"), now = new Date("2026-10-01");
const timed = (id, effectiveFrom, value) => ({ id, effectiveFrom: new Date(effectiveFrom), sequence: 0, value });
const invalid = { ...rule, overdue: { feeMode: "hourly_to_daily", hourlyRatePercent: 0, dailyAfterHours: 8 } };
const input = { settings: null, locations: [], prices: [], rules: [timed("historical", "2025-01-01", invalid), timed("current", "2026-01-01", rule)] };
const before = structuredClone(input);
assert.equal(preview(target, input, now).valid, true, "不追改历史参数");
const candidate = preview(target, { ...input, rules: [...input.rules, timed("future", "2027-01-01", invalid)] }, now);
assert.ok(candidate.blockers.some((row) => row.id === "future:parameters"));
assert.equal(candidate.complete, false);
assert.deepEqual(input, before, "参数复核不修改规则或补默认数值");
console.log("category-adoption-rule-parameters: thresholds, money obligations, risk limits, finite numbers and historical isolation passed");
