const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const { buildRentalWorkbenchTodos, canIncludeWorkbenchWorkOrders } = require("../apps/api/src/modules/rental-core/rental-workbench-todos");

const at = "2026-09-11T12:00:00.000Z";
const base = (overrides = {}) => ({
  id: "order_1",
  orderNo: "R-001",
  status: "settling",
  startAt: "2026-09-10T09:00:00.000Z",
  endAt: "2026-09-10T18:00:00.000Z",
  effectiveEndAt: "2026-09-10T18:00:00.000Z",
  createdAt: "2026-09-10T08:00:00.000Z",
  updatedAt: "2026-09-11T11:00:00.000Z",
  payableAmount: 100,
  finalPayableAmount: 100,
  reservations: [],
  allocations: [],
  feeReviews: [],
  serviceSnapshots: [],
  chargeLines: [],
  ...overrides
});

const todos = buildRentalWorkbenchTodos([
  base({ id: "draft_1", orderNo: "R-DRAFT", status: "draft", reservations: [{ status: "soft", expiresAt: "2026-09-11T11:00:00.000Z" }] }),
  base({ id: "notice_1", orderNo: "R-NOTICE", status: "pickup_overdue", pickupOverdueAt: "2026-09-11T09:00:00.000Z" }),
  base({ id: "confirm_1", orderNo: "R-CONFIRM", status: "pickup_overdue", pickupOverdueAt: "2026-09-11T08:00:00.000Z", noShowNoticeAt: "2026-09-11T08:30:00.000Z" }),
  base({ id: "overdue_1", orderNo: "R-OVERDUE", status: "renting", allocations: [{ status: "picked_up" }] }),
  base({ id: "fee_1", orderNo: "R-FEE", feeReviews: [{ id: "fee", type: "overdue", suggestedAmount: 30, status: "pending", createdAt: "2026-09-11T10:00:00.000Z" }] }),
  base({ id: "refund_1", orderNo: "R-REFUND", serviceSnapshots: [{ refundStatus: "approved_pending_refund" }] }),
  base({ id: "done_1", orderNo: "R-DONE" })
], [{
  id: "work_1", workNo: "W-001", status: "pending_review", type: "repair", reason: "归还异常", createdAt: "2026-09-11T10:30:00.000Z"
}], {
  refund_1: { rental: { balance: -25 } }
}, {}, at);

assert.equal(todos.items.length, 7);
assert.equal(todos.counts.pending_payment, 1);
assert.equal(todos.counts.no_show_notice, 1);
assert.equal(todos.counts.no_show_confirmation, 1);
assert.equal(todos.counts.return_overdue, 1);
assert.equal(todos.counts.fee_review, 1);
assert.equal(todos.counts.refund, 1);
assert.equal(todos.counts.work_order, 1);
assert.equal(todos.items[0].type, "no_show_confirmation", "高优先级待确认爽约应先展示");
assert.equal(todos.items.find((row) => row.type === "refund").amount, 25);

const withoutFunding = buildRentalWorkbenchTodos([base({ id: "refund_without_funding", status: "settling", serviceSnapshots: [{ refundStatus: "approved_pending_refund" }] })], [], {}, {}, at);
assert.equal(withoutFunding.items.some((row) => row.type === "refund"), false, "没有负租金余额时不能凭审核状态虚构退款待办");

assert.equal(canIncludeWorkbenchWorkOrders({ isPlatformAdmin: false, permissions: ["store-rental:report:view"] }), false, "只有报表权限时不能读取养护工单待办");
assert.equal(canIncludeWorkbenchWorkOrders({ isPlatformAdmin: false, permissions: ["rental-core:maintenance:view"] }), true, "维护查看权限可以读取养护工单待办");
assert.equal(canIncludeWorkbenchWorkOrders({ isPlatformAdmin: true, permissions: [] }), true, "平台管理员沿用全局可见能力");

console.log(`\n工作台统一待办专项：${todos.items.length + 4} 项全部通过`);
