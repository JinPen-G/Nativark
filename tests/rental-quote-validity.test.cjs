const assert = require("node:assert/strict");
const { effectiveQuoteValidityMinutes, effectiveUnpaidHoldRule } = require("../apps/api/dist/modules/rental-core/rental-rule-defaults.js");

const legacy = { payment: { unpaidHoldMinutes: 30 } };
assert.equal(effectiveQuoteValidityMinutes(legacy), 30, "旧规则保持报价与保留时长相同的历史语义");
const current = { payment: { unpaidHoldMinutes: 30, quoteValidityMinutes: 10 } };
assert.equal(effectiveQuoteValidityMinutes(current), 10, "新规则报价有效期独立于下单后库存保留期");
assert.equal(effectiveUnpaidHoldRule(current).unpaidHoldMinutes, 30, "设置报价有效期不改变订单软预占时长");
assert.equal(effectiveQuoteValidityMinutes({ payment: { unpaidHoldMinutes: 20, quoteValidityMinutes: 0 } }), 20);
console.log("quote validity and unpaid hold boundaries passed");
