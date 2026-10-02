"use strict";

// Inputs only. Business decisions, arithmetic and transitions belong to production code.
// The existing memory initializer only supplies demo catalogs for this tenant ID.
// This never denotes access to the real tenant: all repositories are absorbing substitutes.
const TENANT_ID = "tenant_001";
function workspace(categoryCode) {
  return { id: `ws_ain_fact_${categoryCode}`, tenantId: TENANT_ID, categoryCode, isDefault: true };
}
function emptyConfiguration(categoryCode) {
  return { tenantId: TENANT_ID, workspaceId: workspace(categoryCode).id, categoryCode,
    hasPersistedConfig: true, pricingPlans: [], discountPlans: [], services: [],
    calendars: [], ruleVersions: [], notificationTemplates: [] };
}
function quoteInput(context) {
  const start = Date.now() + 48 * 3_600_000;
  return { customerType: "personal", fulfillmentMode: context.settings.fulfillment.enabledModes[0],
    fulfillmentLocationId: context.locations[0].id,
    startAt: new Date(start).toISOString(), endAt: new Date(start + 24 * 3_600_000).toISOString(),
    lines: [{ itemGroupId: context.groups[0].id, quantity: 1 }] };
}
function extensionInput(quote) {
  return { order: { id: "order_ain_history", quoteId: quote.id,
      startAt: quote.request.startAt, endAt: quote.request.endAt,
      depositAmount: quote.depositAmount, preAuthAmount: quote.preAuthAmount },
    lines: quote.request.lines.map(row => ({ itemGroupId: row.itemGroupId,
      pricingGroupId: row.pricingGroupId, quantity: row.quantity })),
    newEndAt: new Date(Date.parse(quote.request.endAt) + 24 * 3_600_000).toISOString(),
    appliedAt: new Date(Date.parse(quote.request.startAt) + 3_600_000).toISOString(),
    settlementMode: "immediate", fulfillmentMode: quote.request.fulfillmentMode,
    locationIds: [quote.request.fulfillmentLocationId], customerType: "personal" };
}
function refundRow(overrides = {}) {
  return { id: "refund_ain", tenantId: TENANT_ID, workspaceId: "ws_ain_fact_camera",
    orderId: "order_ain", paymentIntentId: "intent_ain", provider: "alipay", method: "alipay",
    amount: 10, currency: "CNY", merchantRefundNo: "RR-AIN", reason: "synthetic",
    status: "pending", externalRefundId: null, externalStatus: null, responseJson: null,
    failureReason: null, acceptedAt: null, succeededAt: null, fundedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"), ...overrides };
}
function inventoryRows() {
  return { assets: [{ status: "AVAILABLE", _count: { _all: 3 } },
    { status: "RENTED", _count: { _all: 1 } }, { status: "DISABLED", _count: { _all: 2 } }],
  stock: { _sum: { onHandQuantity: 10, reservedQuantity: 3, maintenanceQuantity: 2 } } };
}
module.exports = { TENANT_ID, workspace, emptyConfiguration, quoteInput, extensionInput, refundRow, inventoryRows };
