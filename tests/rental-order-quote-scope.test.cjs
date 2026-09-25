const assert = require("node:assert/strict");
const { RentalOrderConfirmationService } = require("../apps/api/dist/modules/rental-core/rental-order-confirmation.service.js");

const service = new RentalOrderConfirmationService(null, null, null, null, null, null);
const request = {
  fulfillmentMode: "store_pickup_return", fulfillmentLocationId: "loc", returnLocationId: undefined,
  startAt: "2030-01-01T00:00:00.000Z", endAt: "2030-01-02T00:00:00.000Z",
  customerType: "personal", customerId: "customer", bookingIdentity: undefined,
  lines: [{ pricingGroupId: "group-a", itemGroupId: "model-1", quantity: 1, reservationPrecision: "exact_model" }]
};
const quote = { request };
service.assertOrderMatchesQuote({ ...request, lines: [{ pricingGroupId: "group-a", itemGroupId: "model-1", quantity: 1 }] }, quote);
assert.throws(
  () => service.assertOrderMatchesQuote({ ...request, lines: [{ pricingGroupId: "group-b", itemGroupId: "model-1", quantity: 1 }] }, quote),
  /订单内容与服务端报价快照不一致/,
  "不能用相同型号在确认时偷换定价组或扩大组内替换范围"
);
console.log("order confirmation pricing-group snapshot gate passed");
