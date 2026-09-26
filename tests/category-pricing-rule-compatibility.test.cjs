const test = require("node:test");
const assert = require("node:assert/strict");
const { categoryPricingRuleError } = require("../apps/api/dist/modules/rental-core/category-pricing-rule-compatibility.js");

const base = { pricing: {}, overdue: { feeMode: "none" } };

test("hour-to-day is accepted only where both hour and 24-hour day pricing exist", () => {
  assert.equal(categoryPricingRuleError(["hour", "day_24h"], {
    ...base, pricing: { hourToDayEnabled: true }
  }), undefined);
  assert.match(categoryPricingRuleError(["calendar_day", "night"], {
    ...base, pricing: { hourToDayEnabled: true }
  }), /同时支持小时和24小时日租/u);
  assert.match(categoryPricingRuleError(["hour", "shift"], {
    ...base, pricing: { hourToDayEnabled: true }
  }), /同时支持小时和24小时日租/u);
});

test("daily-overdue and shift boundaries are rejected when the category cannot use them", () => {
  assert.equal(categoryPricingRuleError(["calendar_day", "day_24h"], {
    ...base, overdue: { feeMode: "hourly_to_daily" }
  }), undefined);
  assert.match(categoryPricingRuleError(["calendar_day", "night"], {
    ...base, overdue: { feeMode: "hourly_to_daily" }
  }), /需要当前品类支持24小时日租/u);
  assert.match(categoryPricingRuleError(["hour", "calendar_day"], {
    ...base, pricing: { shiftStartHours: [0, 8, 16] }
  }), /仅适用于支持班次计价/u);
});
