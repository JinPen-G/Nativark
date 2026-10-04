"use strict";
const base = { id: "synthetic-call", type: "function", function: { name: "order_explain", arguments: JSON.stringify({ orderId: "synthetic-order" }) } };
module.exports = Object.freeze([
  Object.freeze({ name: "valid", call: base, accepted: true }),
  Object.freeze({ name: "wrong-type", call: { ...base, function: { ...base.function, arguments: JSON.stringify({ orderId: 7 }) } }, accepted: false }),
  Object.freeze({ name: "extra-field", call: { ...base, function: { ...base.function, arguments: JSON.stringify({ orderId: "synthetic-order", tenantId: "synthetic-forged" }) } }, accepted: false }),
  Object.freeze({ name: "oversized", call: { ...base, function: { ...base.function, arguments: "x".repeat(16001) } }, accepted: false }),
  Object.freeze({ name: "invalid-json", call: { ...base, function: { ...base.function, arguments: "{invalid" } }, accepted: false }),
  Object.freeze({ name: "unicode-control", call: { ...base, function: { ...base.function, arguments: JSON.stringify({ orderId: "synthetic-\u202eorder" }) } }, accepted: false }),
  Object.freeze({ name: "unknown-tool", call: { ...base, function: { ...base.function, name: "arbitrary_http" } }, accepted: false })
]);
