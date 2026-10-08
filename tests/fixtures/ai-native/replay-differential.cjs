"use strict";
// Synthetic business inputs; no fingerprint or authorization algorithm here.
function input() {
  return { quoteId: "synthetic-quote", customerName: "Synthetic customer", customerType: "personal",
    fulfillmentLocationId: "store-a", capabilityExceptions: [{ capabilityCode: "synthetic-capability", reason: "Synthetic confirmation" }] };
}
const mutations = [
  { name: "quote", patch: { quoteId: "other-quote" } },
  { name: "customer", patch: { customerName: "Other customer" } },
  { name: "location", patch: { fulfillmentLocationId: "store-b" } },
  { name: "exception reason", patch: { capabilityExceptions: [{ capabilityCode: "synthetic-capability", reason: "Changed reason" }] } },
  { name: "exception capability", patch: { capabilityExceptions: [{ capabilityCode: "other-capability", reason: "Synthetic confirmation" }] } }
];
module.exports = { input, mutations };
