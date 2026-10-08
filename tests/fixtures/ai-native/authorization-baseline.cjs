"use strict";
// Synthetic inputs only; no authorization decisions or permission matching here.
function user(overrides = {}) {
  return { id: "operator-a", tenantId: "tenant-a", displayName: "Synthetic operator",
    isActive: true, isSaasAdmin: false, isPlatformAdmin: false, mustChangePassword: false,
    dataScope: "all", locationScope: { mode: "all", locationIds: [] },
    permissions: ["rental-os:order:view", "rental-os:order:operate"], ...overrides };
}
function request(path = "/rental/v1/orders/order-a", overrides = {}) {
  return { url: `/api${path}`, originalUrl: `/api${path}`, method: "GET", headers: {}, query: {}, ...overrides };
}
function identity(overrides = {}) {
  return { tenantId: "tenant-a", userId: "operator-a", workspaceId: "workspace-a",
    dataScope: "all", locationScope: { mode: "all", locationIds: [] }, isSaasAdmin: false, ...overrides };
}
function order(overrides = {}) {
  return { id: "order-a", tenantId: "tenant-a", orderNo: "S03-ORDER", status: "reserved",
    customerName: "Synthetic customer", startAt: "2026-01-01T00:00:00Z", endAt: "2026-01-02T00:00:00Z",
    createdAt: "2025-12-31T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", currency: "CNY",
    fulfillmentLocationName: "Synthetic store", returnLocationName: "Synthetic store",
    rentalAmount: 100, finalPayableAmount: 100, payableAmount: 100, serviceAmount: 0,
    discountAmount: 0, couponAmount: 0, depositAmount: 20, preAuthAmount: 0, adjustmentAmount: 0,
    lines: [{ id: "line-a", itemGroupId: "item-a", itemGroupName: "Synthetic item", quantity: 1, amount: 100 }],
    reservations: [], allocations: [], chargeLines: [], ...overrides };
}
function historicalDocument(overrides = {}) {
  return { id: "snapshot-a", tenantId: "tenant-a", workspaceId: "workspace-a", orderId: "order-a",
    documentType: "settlement", templateCode: "settlement-v1", documentNo: "S03-DOC",
    sourceOrderUpdatedAt: new Date("2026-01-01T00:00:00Z"), snapshotAt: new Date("2026-01-01T00:01:00Z"),
    contentHash: "synthetic-hash", snapshot: { financial: { visible: true, finalPayableAmount: 100 } },
    html: "<p>Synthetic historical document</p>", ...overrides };
}
function createOrderInput() {
  return { quoteId: "quote-a", customerName: "Synthetic customer", customerType: "personal",
    capabilityExceptions: [{ capabilityCode: "synthetic", reason: "Synthetic risk acceptance",
      confirmedBy: "FORGED", confirmedWithPermission: "FORGED", confirmedAt: "2000-01-01T00:00:00Z" }] };
}
module.exports = { user, request, identity, order, historicalDocument, createOrderInput };
