const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const { buildRentalWorkbenchTodos, canIncludeWorkbenchOrderTodos, canIncludeWorkbenchWorkOrders } = require("../apps/api/src/modules/rental-core/rental-workbench-todos");

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
}, {}, [{
  id: "notify_failed_1",
  tenantId: "tenant_1",
  templateId: "template_1",
  templateVersion: "1.1",
  eventCode: "order.confirmed",
  channel: "sms",
  recipient: "138****8888",
  renderedTitle: "订单通知",
  renderedBody: "发送失败",
  variables: {},
  status: "simulation_failed",
  provider: "simulation",
  errorMessage: "缺少通知变量",
  attempts: 1,
  businessObjectType: "order",
  businessObjectId: "fee_1",
  idempotencyKey: "order.confirmed:order:fee_1:sms",
  createdAt: "2026-09-11T11:30:00.000Z"
}], at);

assert.equal(todos.items.length, 8);
assert.equal(todos.counts.pending_payment, 1);
assert.equal(todos.counts.no_show_notice, 1);
assert.equal(todos.counts.no_show_confirmation, 1);
assert.equal(todos.counts.return_overdue, 1);
assert.equal(todos.counts.fee_review, 1);
assert.equal(todos.counts.refund, 1);
assert.equal(todos.counts.work_order, 1);
assert.equal(todos.counts.notification_failure, 1);
assert.equal(todos.items.find((row) => row.type === "notification_failure").href, "/rental/orders/fee_1");
assert.equal(todos.items[0].type, "no_show_confirmation", "高优先级待确认爽约应先展示");
assert.equal(todos.items.find((row) => row.type === "refund").amount, 25);

const withoutFunding = buildRentalWorkbenchTodos([base({ id: "refund_without_funding", status: "settling", serviceSnapshots: [{ refundStatus: "approved_pending_refund" }] })], [], {}, {}, [], at);
assert.equal(withoutFunding.items.some((row) => row.type === "refund"), false, "没有负租金余额时不能凭审核状态虚构退款待办");

assert.equal(canIncludeWorkbenchWorkOrders({ isPlatformAdmin: false, permissions: ["rental-os:report:view"] }), false, "只有报表权限时不能读取养护工单待办");
assert.equal(canIncludeWorkbenchWorkOrders({ isPlatformAdmin: false, permissions: ["rental-core:maintenance:view"] }), true, "维护查看权限可以读取养护工单待办");
assert.equal(canIncludeWorkbenchWorkOrders({ isPlatformAdmin: true, permissions: [] }), true, "平台管理员沿用全局可见能力");
assert.equal(canIncludeWorkbenchOrderTodos({ isPlatformAdmin: false, permissions: ["rental-core:maintenance:view"] }), false, "仅维护查看权限不能读取订单待办");
assert.equal(canIncludeWorkbenchOrderTodos({ isPlatformAdmin: false, permissions: ["rental-os:report:view"] }), true, "报表角色保留既有工作台订单待办口径");
assert.equal(canIncludeWorkbenchOrderTodos({ isPlatformAdmin: false, permissions: ["rental-os:order:view"] }), true, "订单查看角色可以读取订单待办");

// 维护人员必须有工作台的路由/API入口，否则上面的维护待办聚合只能从单元测试里存在，
// 实际账号永远进不去。这里同时钉住前端路由、后端守卫和 OpenAPI 权限契约，避免只改一层。
const navigationSource = fs.readFileSync(path.join(__dirname, "../apps/admin/src/app/navigation.tsx"), "utf8");
const guardSource = fs.readFileSync(path.join(__dirname, "../apps/api/src/common/api-auth.guard.ts"), "utf8");
const openapiSource = fs.readFileSync(path.join(__dirname, "../apps/api/src/contracts/openapi-document.ts"), "utf8");
assert.ok(navigationSource.includes('legacyPermissions: ["rental-os:order:view", "rental-core:maintenance:view"]'), "工作台前端路由必须允许维护查看权限");
assert.ok(guardSource.includes('path === "/rental/v1/workbench/todos") return ["rental-os:report:view", "rental-os:order:view", "rental-core:maintenance:view"]'), "工作台 API 必须允许维护查看权限");
assert.ok(openapiSource.includes('permissions: ["rental-os:report:view", "rental-os:order:view", "rental-core:maintenance:view"]'), "OpenAPI 工作台权限必须与守卫一致");

console.log(`\n工作台统一待办专项：${todos.items.length + 4} 项全部通过`);
