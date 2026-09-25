const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const {
  buildRentalWorkbenchTodos,
  canIncludeWorkbenchOrderTodos,
  canIncludeWorkbenchWorkOrders,
  canManageWorkspaceWideNotifications,
  canResolveNotificationOrderScope,
  filterNotificationLogsByVisibleOrders
} = require("../apps/api/src/modules/rental-core/rental-workbench-todos");

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
}, {
  id: "notify_failed_other_location",
  tenantId: "tenant_1",
  templateId: "template_1",
  templateVersion: "1.1",
  eventCode: "order.confirmed",
  channel: "sms",
  recipient: "139****0000",
  renderedTitle: "其他地点订单通知",
  renderedBody: "其他地点消息正文",
  variables: {},
  status: "simulation_failed",
  provider: "simulation",
  errorMessage: "其他地点错误详情",
  attempts: 1,
  businessObjectType: "order",
  businessObjectId: "outside_location_order",
  idempotencyKey: "order.confirmed:order:outside_location_order:sms",
  createdAt: "2026-09-11T11:31:00.000Z"
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
assert.equal(todos.items.some((row) => row.orderId === "outside_location_order" || row.description.includes("其他地点错误详情")), false, "当前可见订单之外的通知日志不能进入工作台待办");
assert.equal(todos.items[0].type, "no_show_confirmation", "高优先级待确认爽约应先展示");
assert.equal(todos.items.find((row) => row.type === "refund").amount, 25);

const visibleLogs = filterNotificationLogsByVisibleOrders([
  { businessObjectType: "order", businessObjectId: "order_visible" },
  { businessObjectType: "order", businessObjectId: "order_hidden" },
  { businessObjectType: "manual", businessObjectId: undefined }
], [base({ id: "order_visible" })]);
assert.deepEqual(visibleLogs.map((row) => row.businessObjectId), ["order_visible"], "受限日志列表只保留可见订单关联记录，不暴露其他地点或无业务对象的手工记录");
assert.equal(canManageWorkspaceWideNotifications("all", undefined), true, "完整空间范围可以管理全空间通知配置");
assert.equal(canManageWorkspaceWideNotifications("store", undefined), true, "当前空间范围可以管理本空间通知配置");
assert.equal(canManageWorkspaceWideNotifications("store", ["location_1"]), false, "进一步缩窄到部分地点后不能管理空间级通知配置");
assert.equal(canManageWorkspaceWideNotifications("own", undefined), false, "本人范围不能管理全空间通知");
assert.equal(canManageWorkspaceWideNotifications(undefined, undefined), false, "会话数据范围缺失时必须拒绝全空间通知管理");
assert.equal(canResolveNotificationOrderScope("store", undefined), true, "当前空间范围由会话 workspaceId 限定，不依赖组织地点映射");
assert.equal(canResolveNotificationOrderScope("store", ["location_1"]), true, "门店范围被地点缩限后仍可按可见订单过滤");
assert.equal(canResolveNotificationOrderScope("organization", ["location_1"]), true, "组织范围解析到授权地点后可按可见订单读取通知");
assert.equal(canResolveNotificationOrderScope(undefined, undefined), false, "会话数据范围缺失时不能退化为全空间通知可见");

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
const businessControllerSource = fs.readFileSync(path.join(__dirname, "../apps/api/src/modules/rental-core/rental-business.controller.ts"), "utf8");
assert.ok(navigationSource.includes('legacyPermissions: ["rental-os:order:view", "rental-core:maintenance:view"]'), "工作台前端路由必须允许维护查看权限");
assert.ok(guardSource.includes('path === "/rental/v1/workbench/todos") return ["rental-os:report:view", "rental-os:order:view", "rental-core:maintenance:view"]'), "工作台 API 必须允许维护查看权限");
assert.ok(openapiSource.includes('permissions: ["rental-os:report:view", "rental-os:order:view", "rental-core:maintenance:view"]'), "OpenAPI 工作台权限必须与守卫一致");

function routeSection(startMarker, endMarker) {
  const start = businessControllerSource.indexOf(startMarker);
  assert.notEqual(start, -1, `控制器缺少路由标记 ${startMarker}`);
  const end = businessControllerSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `控制器缺少路由结束标记 ${endMarker}`);
  return businessControllerSource.slice(start, end);
}
assert.match(routeSection('@Get("notification-logs")', '@Post("notification-logs/retry-due")'), /filterNotificationLogsByVisibleOrders\(logs, await this\.core\.listOrders\(tenantId\)\)/u, "通知日志列表必须按会话可见订单过滤");
assert.match(routeSection('@Post("notification-templates")', '@Put("notification-templates/:id")'), /this\.assertWorkspaceWideNotificationScope\(\)/u, "通知模板写入必须要求完整运营数据范围");
assert.match(routeSection('@Put("notification-templates/:id")', '@Get("notification-logs")'), /this\.assertWorkspaceWideNotificationScope\(\)/u, "通知模板更新必须要求完整运营数据范围");
assert.match(routeSection('@Post("notification-logs/retry-due")', '@Post("notification-logs/:id/query-delivery")'), /this\.assertWorkspaceWideNotificationScope\(\)/u, "批量通知重试必须要求完整运营数据范围");
assert.match(routeSection('@Post("notification-logs/:id/query-delivery")', '@Post("notification-logs/:id/retry")'), /this\.assertNotificationLogScope\(req\.user\.tenantId, id\)/u, "单条通知查询必须校验关联订单的数据范围");
assert.match(routeSection('@Post("notification-logs/:id/retry")', '@Post("notifications/send")'), /this\.assertNotificationLogScope\(req\.user\.tenantId, id\)/u, "单条通知重试必须校验关联订单的数据范围");
assert.match(routeSection('@Post("notifications/send")', '@Post("quotes")'), /this\.assertWorkspaceWideNotificationScope\(\)/u, "手工通知发送必须要求完整运营数据范围");

console.log(`\n工作台统一待办专项：${todos.items.length + visibleLogs.length + 20} 项全部通过`);
