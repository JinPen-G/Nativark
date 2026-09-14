const assert = require("node:assert/strict");
const { renderRentalDocument } = require("../apps/api/dist/modules/rental-core/rental-document-renderer.js");

function order(overrides = {}) {
  return {
    id: "order-1",
    tenantId: "tenant-1",
    orderNo: "RO-0001",
    categoryCode: "camera",
    status: "renting",
    customerType: "personal",
    customerId: "customer-1",
    customerName: "<客户>",
    contactPhone: "13800000000",
    fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: "loc-1",
    fulfillmentLocationName: "摄影门店",
    returnLocationName: "摄影门店",
    startAt: "2026-09-15T01:00:00.000Z",
    endAt: "2026-09-16T01:00:00.000Z",
    quoteId: "quote-1",
    quoteNo: "Q-0001",
    pricingPlanVersion: "v1",
    ruleVersion: "r1",
    ruleSnapshot: { payment: {}, fulfillment: {}, overdue: {}, cancellation: {}, qualification: {}, damage: {} },
    chargeLines: [{ code: "rental", name: "租金", type: "rental", amount: 100 }],
    rentalAmount: 100,
    discountAmount: 0,
    couponAmount: 0,
    serviceAmount: 0,
    fulfillmentAmount: 0,
    depositAmount: 200,
    preAuthAmount: 0,
    payableAmount: 100,
    adjustmentAmount: 0,
    finalPayableAmount: 100,
    totalAmount: 100,
    lines: [{ id: "line-1", itemGroupId: "item-1", itemGroupCode: "CAM", itemGroupName: "<相机>", inventoryMode: "serialized", quantity: 2, cancelledQuantity: 1, unitPrice: 50, amount: 100 }],
    reservations: [],
    allocations: [{ id: "allocation-1", orderId: "order-1", orderLineId: "line-1", itemGroupId: "item-1", assetNo: "CAM-001", quantity: 1, status: "picked_up", metadata: { source: "manual", protected: true, assignedAt: "2026-09-15T00:00:00.000Z" } }],
    createdBy: "operator",
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-15T02:00:00.000Z",
    ...overrides
  };
}

const templates = [{ code: "camera-return", fields: [{ code: "condition", label: "成色" }] }];
const inspections = [{
  id: "inspection-1",
  tenantId: "tenant-1",
  orderId: "order-1",
  stage: "return",
  templateId: "template-1",
  templateCode: "camera-return",
  templateVersion: "v1",
  results: { condition: "<良好>" },
  exceptions: [{ code: "damage", description: "划痕", evidenceAttachments: ["private-evidence-id"], reviewStatus: "pending" }],
  attachments: ["private-attachment-id"],
  operator: "operator",
  createdAt: "2026-09-16T02:00:00.000Z"
}];

const baseInput = {
  documentType: "quote",
  order: order(),
  inspections,
  templates,
  snapshotAt: "2026-09-15T03:00:00.000Z"
};

const quote = renderRentalDocument(baseInput);
assert.equal(quote.templateCode, "quote-v1");
assert.equal(quote.snapshot.rows[0].quantity, 1, "客户凭证应展示取消后的有效数量");
assert.equal(quote.snapshot.rows[0].cancelledQuantity, 1);
assert.equal(quote.snapshot.rows[0].amount, 50, "部分取消后凭证行金额应按有效数量展示");
assert.match(quote.html, /&lt;相机&gt;/);
assert.doesNotMatch(quote.html, /ruleSnapshot|private-evidence-id|private-attachment-id/);

const sameQuote = renderRentalDocument(baseInput);
assert.equal(sameQuote.contentHash, quote.contentHash, "相同订单快照必须得到相同内容哈希");
assert.equal(sameQuote.html, quote.html, "相同快照时间下重生成 HTML 必须一致");

const changedQuote = renderRentalDocument({ ...baseInput, order: order({ finalPayableAmount: 101 }) });
assert.notEqual(changedQuote.contentHash, quote.contentHash, "订单事实变化必须改变内容哈希");

const returnDocument = renderRentalDocument({ ...baseInput, documentType: "return" });
assert.equal(returnDocument.snapshot.rows[0].checks, "成色：<良好>");
assert.match(returnDocument.snapshot.rows[0].exceptions, /划痕/);
assert.doesNotMatch(returnDocument.html, /private-evidence-id|private-attachment-id/);

const settlement = renderRentalDocument({ ...baseInput, documentType: "settlement" });
assert.equal(settlement.snapshot.financial.visible, false);
assert.match(settlement.html, /当前账号无资金明细查看权限/);

const settlementWithFunding = renderRentalDocument({
  ...baseInput,
  documentType: "settlement",
  funding: {
    orderId: "order-1",
    rental: { payable: 100, collected: 100, refunded: 0, securityCaptured: 0, balance: 0, pendingExtensionAmount: 0 },
    deposit: { collected: 200, captured: 0, refunded: 200, balance: 0, requiredAmount: 200, pendingExtensionAmount: 0 },
    preauthorization: { frozen: 0, captured: 0, released: 0, balance: 0, requiredAmount: 0, pendingExtensionAmount: 0 },
    events: []
  }
});
assert.equal(settlementWithFunding.snapshot.financial.visible, true);
assert.match(settlementWithFunding.html, /已收租金及费用/);

console.log("Rental document renderer test passed: scoped customer snapshots, redaction, deterministic hashes and finance permission projection are covered.");
