const assert = require("node:assert/strict");

const { RentalDocumentService } = require("../apps/api/dist/modules/rental-core/rental-document.service.js");

const order = (overrides = {}) => ({
  id: "order-doc-1",
  orderNo: "RO-DOC-001",
  status: "RESERVED",
  customerName: "测试客户",
  contactPhone: "13800138000",
  startAt: "2026-09-15T09:00:00.000Z",
  endAt: "2026-09-16T09:00:00.000Z",
  effectiveEndAt: undefined,
  fulfillmentLocationName: "中心仓",
  returnLocationName: "中心仓",
  currency: "CNY",
  updatedAt: "2026-09-15T01:00:00.000Z",
  rentalAmount: 100,
  serviceAmount: 0,
  discountAmount: 0,
  couponAmount: 0,
  finalPayableAmount: 100,
  payableAmount: 100,
  depositAmount: 0,
  preAuthAmount: 0,
  adjustmentAmount: 0,
  lines: [{ id: "line-1", itemGroupId: "item-1", itemGroupName: "测试器材", quantity: 1, amount: 100, cancelledQuantity: 0 }],
  allocations: [],
  reservations: [{ itemGroupId: "item-1", quantity: 1, releasedQuantity: 0, status: "confirmed" }],
  inspections: [],
  chargeLines: [],
  ...overrides
});

const rows = new Map();
let creates = 0;
const keyOf = (where) => [where.tenantId, where.workspaceId, where.orderId, where.documentType, where.contentHash].join("|");
const prisma = {
  rentalOrderDocumentSnapshot: {
    async findUnique({ where }) { return rows.get(keyOf(where.tenantId_workspaceId_orderId_documentType_contentHash)); },
    async create({ data }) {
      const row = { id: `snapshot-${++creates}`, ...data };
      rows.set(keyOf(data), row);
      return row;
    }
  }
};

let currentOrder = order();
const core = {
  async getOrder() { return currentOrder; },
  async listInspections() { return []; },
  listInspectionTemplates() { return []; },
  getBusinessSettings() { return { calendar: { timeZone: "Asia/Shanghai" } }; },
  resolveWorkspaceId() { return "workspace-doc-1"; }
};
const funding = { async listEvents() { return undefined; } };

void (async () => {
  const service = new RentalDocumentService(core, funding, prisma);
  const first = await service.render("tenant-doc", "order-doc-1", "quote", { includeFinancial: false });
  const second = await service.render("tenant-doc", "order-doc-1", "quote", { includeFinancial: false });
  assert.equal(first.snapshotId, "snapshot-1");
  assert.equal(second.snapshotId, first.snapshotId, "同一内容重复读取必须复用同一不可变快照");
  assert.equal(second.snapshotAt, first.snapshotAt);
  assert.equal(creates, 1);

  currentOrder = order({ finalPayableAmount: 120, payableAmount: 120, updatedAt: "2026-09-15T02:00:00.000Z" });
  const changed = await service.render("tenant-doc", "order-doc-1", "quote", { includeFinancial: false });
  assert.equal(changed.snapshotId, "snapshot-2", "订单事实变化后必须追加新版本，不能覆盖旧快照");
  assert.notEqual(changed.contentHash, first.contentHash);
  assert.equal(rows.size, 2);

  core.resolveWorkspaceId = () => "workspace-doc-2";
  currentOrder = order();
  const otherWorkspace = await service.render("tenant-doc", "order-doc-1", "quote", { includeFinancial: false });
  assert.equal(otherWorkspace.snapshotId, "snapshot-3", "同租户不同经营空间不能复用另一空间的凭证快照");
  assert.equal(rows.size, 3);

  console.log("DOC-PRINT-01 快照专项通过：同内容幂等复用、订单变化追加版本、旧凭证不被覆盖");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
