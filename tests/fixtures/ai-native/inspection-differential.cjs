"use strict";
const categories = ["camera", "camping", "vehicle", "construction"];
function template(stage = "pickup", overrides = {}) {
  return { id: "frozen-inspection", code: "synthetic", version: "historical-1", enabled: true, stage,
    name: "Synthetic frozen inspection", fields: [{ code: "condition", label: "Synthetic condition", required: true, type: "text" }], ...overrides };
}
function order(categoryCode, overrides = {}) {
  return { id: "synthetic-order", tenantId: "tenant_001", categoryCode, status: "reserved", fulfillmentMode: "store_pickup",
    allocations: [], reservations: [], lines: [], inspectionTemplateSnapshots: [template()], ...overrides };
}
function request(overrides = {}) { return { templateId: "frozen-inspection", results: { condition: "Synthetic checked" }, ...overrides }; }
module.exports = { categories, template, order, request };
