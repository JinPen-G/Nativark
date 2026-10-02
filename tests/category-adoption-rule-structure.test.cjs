"use strict";
require("reflect-metadata");
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { categoryAdoptionRuleStructureErrors: check } = require("../apps/api/dist/modules/rental-core/category-adoption-rule-structure.js");
const { categoryAdoptionBusinessCompatibility: preview } = require("../apps/api/dist/modules/rental-core/category-adoption-business-compatibility.js");
const rule = {
  payment: { timing: "order", depositMode: "none", preauthorizationRequired: false, unpaidHoldMinutes: 15 },
  overdue: { feeMode: "none", graceMinutes: 0, feeMultiplier: 0 },
  fulfillment: { pickupInspectionRequired: false, returnInspectionRequired: false, evidenceRequired: false, allowDifferentReturnLocation: false },
  cancellation: { freeBeforeHours: 24, lateFeeType: "none", lateFeeValue: 0, weatherExceptionEnabled: false },
  qualification: { required: false, documentTypes: [], minimumValidityDays: 0 }, damage: { manualReviewRequired: true }
};
const before = structuredClone(rule);
assert.deepEqual(check(rule), [], "合法旧规则可缺省新增可选节，不自动加默认值");
for (const key of ["__proto__", "constructor", "prototype"]) {
  const unsafe = JSON.parse(JSON.stringify({ ...rule, pricing: {} }));
  Object.defineProperty(unsafe.pricing, key, { value: { hidden: true }, enumerable: true });
  assert.ok(check(unsafe).some((message) => message.includes("不安全字段")), "投影前拒绝危险键，不靠转换器静默剔除后放行");
  assert.ok(Object.hasOwn(unsafe.pricing, key));
}
const cyclic = structuredClone(rule); cyclic.pricing = {}; cyclic.pricing.loop = cyclic;
assert.ok(check(cyclic).length, "非JSON循环数据也必须安全拒绝");
for (const field of ["payment", "overdue", "fulfillment", "cancellation", "qualification", "damage"]) {
  const missing = structuredClone(rule); delete missing[field];
  assert.ok(check(missing).some((message) => message.includes(field)), `必需节 ${field} 不能省略`);
}
for (const config of [null, [], false, "rule", { ...rule, unknownExecutionRule: true },
  { ...rule, payment: { ...rule.payment, unpaidHoldMinutes: "15" } },
  { ...rule, pricing: { shiftHours: 25 } },
  { ...rule, pricing: { shiftStartHours: [24] } },
  { ...rule, extension: { enabled: true, forceImmediateWhenOverdue: true, maxTimes: 0 } },
  { ...rule, extension: { enabled: true, forceImmediateWhenOverdue: true, pricingMode: "invented" } },
  { ...rule, earlyReturn: { mode: "auto", minAdvanceHours: 0, refundPercent: 101, refundUndeliveredServices: false } },
  { ...rule, tax: { rate: 2, inclusive: true } }, { ...rule, tax: { rate: 0.1, inclusive: false } },
  { ...rule, fulfillment: { ...rule.fulfillment, pickupBufferMinutes: -1 } },
  { ...rule, qualification: { ...rule.qualification, minimumValidityDays: -1 } }]) {
  const original = structuredClone(config);
  assert.ok(check(config).length, "当前或未来错误字段必须按同源DTO拒绝");
  assert.deepEqual(config, original, "校验不得清理未知字段或转换原始值");
}
assert.deepEqual(check({ ...rule, extension: { enabled: true, forceImmediateWhenOverdue: true, pricingMode: "original_total", maxTimes: 2 },
  earlyReturn: { mode: "manual_review", minAdvanceHours: 1, refundPercent: 50, refundUndeliveredServices: false }, tax: { rate: 0.1, inclusive: true } }), []);
const target = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"), now = new Date("2026-10-01");
const timed = (id, at, value) => ({ id, effectiveFrom: new Date(at), sequence: 0, value });
const oldBad = { ...rule, tax: { rate: 2, inclusive: true } }, input = { settings: null, locations: [], prices: [], rules: [timed("old", "2025-01-01", oldBad), timed("current", "2026-01-01", rule)] };
assert.equal(preview(target, input, now).valid, true, "历史规则不追改，不用当前DTO阻塞旧订单善后");
const candidate = preview(target, { ...input, rules: [...input.rules, timed("future", "2027-01-01", oldBad)] }, now);
assert.ok(candidate.blockers.some((row) => row.id === "future:structure" && row.message.includes("tax.rate")));
assert.equal(candidate.complete, false);
assert.deepEqual(rule, before);
console.log("category-adoption-rule-structure: same-source DTO, required sections, no coercion/defaults, renewal/refund/tax and historical isolation passed");
