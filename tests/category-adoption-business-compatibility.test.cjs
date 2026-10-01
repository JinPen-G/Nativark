"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { categoryAdoptionBusinessCompatibility: check, categoryCurrentAndFuture, categoryAdoptionInspectionFieldsValid: inspectionValid } = require("../apps/api/dist/modules/rental-core/category-adoption-business-compatibility.js");
const target = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const now = new Date("2026-09-30T00:00:00Z");
const timed = (id, date, value, sequence = 0) => ({ id, effectiveFrom: new Date(date), sequence, value });
const rule = { pricing: {}, overdue: { feeMode: "none" }, payment: { preauthorizationRequired: false, depositMode: "none" } };
const input = { settings: null, locations: [], prices: [timed("historical", "2025-01-01", [{ unit: "shift" }]), timed("current", "2026-09-01", [{ unit: "hour" }])], rules: [] };
assert.equal(check(target, input, now).valid, true, "历史价格保留原版本，不阻碍现有兼容组合");
for (const settings of [false, [], {}, { pricing: {} }, { pricing: { enabledUnits: "hour" }, fulfillment: { enabledModes: [] }, calendar: {} }]) {
  assert.ok(check(target, { ...input, settings }, now).blockers.some((row) => row.id === "structure"), "异常经营设置应返回阻碍，不抛出服务器错误");
}
for (const value of [null, [], {}, { payment: {}, overdue: null }, { ...rule, pricing: [] }, { ...rule, qualification: "required" }, { ...rule, fulfillment: { pickupInspectionRequired: "false" } }, { ...rule, overdue: { feeMode: "unknown" } }, { ...rule, overdue: { feeMode: { toString: "none" } } }]) {
  const bad = { ...input, rules: [timed("invalid-current", "2026-01-01", value)] }, before = structuredClone(bad);
  assert.ok(check(target, bad, now).blockers.some((row) => row.id === "invalid-current"));
  assert.deepEqual(bad, before, "预览不补默认值或修改规则正文");
  assert.equal(check(target, { ...input, rules: [timed("invalid-old", "2025-01-01", value), timed("valid-current", "2026-01-01", rule)] }, now).valid, true, "历史异常不改写也不误作当前规则");
}
const future = { ...input, prices: [...input.prices, timed("future", "2026-12-01", [{ unit: "shift" }])] };
const pending = { id: "pending-price", status: "pending", finalRates: [{ unit: "shift" }] };
assert.ok(check(target, { ...input, adjustments: [pending] }, now).blockers.some((row) => row.id === pending.id));
for (const finalRates of [null, {}, [], [null]]) assert.equal(check(target, { ...input, adjustments: [{ ...pending, finalRates }] }, now).valid, false);
for (const status of ["draft", "cancelled", "applied", "failed"]) assert.equal(check(target, { ...input, adjustments: [{ ...pending, status }] }, now).valid, true);
assert.equal(check(target, { ...input, adjustments: [{ ...pending, finalRates: [{ unit: "hour" }] }] }, now).valid, true);
const feePlan = { id: "fees", status: "enabled", effectiveTo: null, rates: [{ unit: "hour" }], fulfillmentFees: [{ mode: "onsite_delivery" }] };
assert.ok(check(target, { ...input, pricingPlans: [feePlan] }, now).blockers.some((row) => row.id === "fees:fulfillmentFees"));
for (const over of [{ status: "disabled" }, { effectiveTo: new Date("2025-01-01") }, { fulfillmentFees: null }, { fulfillmentFees: [] }, { fulfillmentFees: [{ mode: "store_pickup_return" }] }]) assert.equal(check(target, { ...input, pricingPlans: [{ ...feePlan, ...over }] }, now).valid, true);
const feeBefore = structuredClone(feePlan);
check(target, { ...input, pricingPlans: [feePlan] }, now);
assert.deepEqual(feePlan, feeBefore, "兼容检查不替换费用定义");
for (const rates of [null, {}, [], [null], [[]], [{ unit: "shift" }]]) {
  const plan = { ...feePlan, fulfillmentFees: null, rates };
  const before = structuredClone(plan);
  assert.deepEqual(check(target, { ...input, pricingPlans: [plan] }, now).blockers.map((row) => row.id), ["fees:rates"], "不设置履约费也必须检查计划费率单位");
  assert.deepEqual(plan, before, "阻碍报告不修改非法计划费率");
  for (const override of [{ status: "disabled" }, { effectiveTo: now }]) assert.equal(check(target, { ...input, pricingPlans: [{ ...plan, ...override }] }, now).valid, true, "停用和恰好到期计划不阻碍采用");
}
for (const value of [[null], [[]], [{ unit: "unknown" }]]) assert.equal(check(target, { ...input, prices: [timed("malformed", "2026-09-01", value)] }, now).valid, false, "非法价格结构必须报告阻碍而非抛出类型错误");
const service = { id: "service", status: "enabled", applicableFulfillmentModes: ["onsite_delivery"], mandatoryRule: { fulfillmentModes: ["onsite_delivery"] } };
const serviceBefore = structuredClone(service);
assert.deepEqual(check(target, { ...input, services: [service] }, now).blockers.map((row) => row.id), ["service:fulfillmentModes", "service:mandatoryRule"]);
assert.equal(check(target, { ...input, services: [{ ...service, status: "disabled" }] }, now).valid, true);
for (const value of [null, undefined, [], ["store_pickup_return"]]) {
  assert.equal(check(target, { ...input, services: [{ ...service, applicableFulfillmentModes: value, mandatoryRule: { fulfillmentModes: value } }] }, now).valid, true);
}
for (const value of [{}, "store_pickup_return", [null], ["unknown"]]) {
  assert.equal(check(target, { ...input, services: [{ ...service, applicableFulfillmentModes: value, mandatoryRule: null }] }, now).valid, false);
}
for (const value of [[], "invalid", { fulfillmentModes: {} }, { fulfillmentModes: ["unknown"] }]) {
  assert.equal(check(target, { ...input, services: [{ ...service, applicableFulfillmentModes: [], mandatoryRule: value }] }, now).valid, false);
}
check(target, { ...input, services: [service] }, now);
assert.deepEqual(service, serviceBefore, "采用预览不得替换服务条件或历史权益");
assert.deepEqual(check(target, future, now).blockers.map((row) => row.id), ["future"], "未来价格不能被当前兼容价格掩盖");
assert.equal(check(target, { ...input, locations: [{ id: "retired", type: "project_site", status: "disabled" }] }, now).valid, true);
assert.equal(check(target, { ...input, locations: [{ id: "active", type: "project_site", status: "enabled" }] }, now).valid, false);
target.businessModel.pricingUnits = ["hour"];
target.businessModel.supportsHolidayPricing = false;
target.businessModel.supportsPreauthorization = false;
const settings = { pricing: { enabledUnits: ["hour", "day_24h"], defaultUnit: "day_24h", holidayPricingEnabled: true }, calendar: { holidayPricingEnabled: true }, fulfillment: { enabledModes: ["onsite_delivery"] } };
const settingsResult = check(target, { ...input, settings }, now);
assert.equal(settingsResult.blockers.filter((row) => row.domain === "settings").length, 4);
const rules = [timed("old-rule", "2025-01-01", { ...rule, pricing: { hourToDayEnabled: true } }), timed("current-rule", "2026-09-01", rule), timed("scheduled-rule", "2027-01-01", { ...rule, pricing: { hourToDayEnabled: true }, preauthorization: { mode: "order_fixed" } })];
const result = check(target, { ...input, rules }, now);
assert.deepEqual(result.checkedRuleVersionIds, ["current-rule", "scheduled-rule"]);
assert.equal(result.blockers.filter((row) => row.id === "scheduled-rule").length, 2);
assert.equal(result.complete, false, "不得用局部兼容检查宣称整个采用已经就绪");
const ties = [timed("older-price", "2026-09-01", {}, 1), timed("new-price", "2026-09-01", {}, 2)];
assert.deepEqual(categoryCurrentAndFuture(ties, now).map((row) => row.id), ["new-price"]);
assert.equal(categoryCurrentAndFuture(ties.map((row) => ({ ...row, sequence: 0 })), now).length, 2, "歧义规则不能静默忽略");
assert.equal(check(target, { ...input, rules: [timed("tie-a", "2026-09-01", rule), timed("tie-b", "2026-09-01", rule)] }, now).blockers.length, 2, "即使配置都兼容，也必须拒绝歧义生效组合");
target.businessModel.supportsQualificationReview = false;
const safetyRule = { ...rule, qualification: { required: true }, membershipSecurityReduction: { preauthorization: { enabled: true } }, fulfillment: { pickupInspectionRequired: true, returnInspectionRequired: true } };
const field = { code: "condition", label: "成色", type: "boolean", required: true };
const safetyInput = { ...input, rules: [timed("historical-safety", "2025-01-01", safetyRule), timed("current-safety", "2026-09-01", rule), timed("future-safety", "2027-01-01", safetyRule)], inspections: [{ id: "pickup", stage: "pickup", enabled: true, fields: [field] }, { id: "disabled-return", stage: "return", enabled: false, fields: [] }] };
const safetyBefore = structuredClone(safetyInput);
const safetyResult = check(target, safetyInput, now);
assert.deepEqual(safetyResult.blockers.map((row) => row.id), ["future-safety", "future-safety", "future-safety:return"], "未来资质、会员预授权减免及停用归还模板不能被遗漏；历史规则不影响新业务");
assert.equal(check(target, { ...safetyInput, inspections: [{ id: "broken", stage: "pickup", enabled: true, fields: {} }] }, now).blockers.filter((row) => row.domain === "inspection").length, 2, "错误结构不能冒充可读取模板");
assert.deepEqual(safetyInput, safetyBefore, "不以新版默认项覆盖租户模板、旧规则或资金配置");
assert.equal(inspectionValid([]), false, "空模板不能满足强制检查");
assert.equal(inspectionValid([field]), true);
for (const invalid of [[field, field], [{ ...field, code: "__proto__" }], [{ ...field, required: "true" }], [{ ...field, usageMetric: true }], [{ ...field, type: "select", options: [] }], [{ ...field, type: "unsupported" }]]) assert.equal(inspectionValid(invalid), false);
assert.equal(inspectionValid([{ ...field, type: "number", usageMetric: true }]), true);
assert.equal(inspectionValid([{ ...field, type: "select", options: ["ok", "bad"] }]), true);
const qualificationRule = { ...rule, qualification: { required: true, documentTypes: ["license"] } };
const qualificationInput = { ...input, rules: [timed("qual", "2026-09-01", qualificationRule)], qualificationTypes: [{ code: "license", categoryCode: "CAMERA", capabilityCode: null, status: "enabled" }] };
target.businessModel.supportsQualificationReview = true;
assert.equal(check(target, qualificationInput, now).valid, true);
for (const types of [[], [{ ...qualificationInput.qualificationTypes[0], status: "disabled" }], [{ ...qualificationInput.qualificationTypes[0], categoryCode: "vehicle" }], [{ ...qualificationInput.qualificationTypes[0], capabilityCode: "unknown" }]]) assert.equal(check(target, { ...qualificationInput, qualificationTypes: types }, now).valid, false);
assert.equal(check(target, { ...qualificationInput, rules: [timed("empty-qual", "2026-09-01", { ...qualificationRule, qualification: { required: true, documentTypes: [] } })] }, now).valid, false);
assert.deepEqual(input, { settings: null, locations: [], prices: [timed("historical", "2025-01-01", [{ unit: "shift" }]), timed("current", "2026-09-01", [{ unit: "hour" }])], rules: [] }, "检查不得改写当前或历史资料");
console.log("category-adoption-business-compatibility: 当前/未来组合、历史保留、范围收窄、规则依赖及部分校验边界通过");
