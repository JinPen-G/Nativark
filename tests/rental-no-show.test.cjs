const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

function orderWith(overrides = {}) {
  return {
    id: "order_no_show_1",
    status: "reserved",
    startAt: "2026-09-10T09:00:00.000Z",
    endAt: "2026-09-11T09:00:00.000Z",
    payableAmount: 100,
    finalPayableAmount: 100,
    adjustmentAmount: 0,
    totalAmount: 100,
    taxRate: 0,
    taxAmount: 0,
    ruleVersion: "rule-1",
    ruleSnapshot: {
      cancellation: {
        noShow: { enabled: true, pickupGraceMinutes: 30, finalizationMinutes: 60, feeType: "percentage", feeValue: 25 }
      },
      fulfillment: {}
    },
    reservations: [{ id: "reservation_1", quantity: 1, releasedQuantity: 0, status: "hard" }],
    allocations: [],
    chargeLines: [],
    updatedAt: "2026-09-10T09:00:00.000Z",
    ...overrides
  };
}

function serviceWith(order) {
  const service = Object.create(RentalCoreService.prototype);
  service.state = () => ({});
  service.lockedOrder = async () => order;
  service.orderHookInstances = () => undefined;
  service.runHook = async () => undefined;
  service.factStore = {
    listOrders: async () => [order],
    listExtensions: async () => [],
    cancelExtensions: async () => undefined,
    saveOrderAggregate: async () => { service.saved = true; }
  };
  return service;
}

void (async () => {
  const order = orderWith();
  const service = serviceWith(order);
  assert.deepEqual(await service.listPickupOverdueOrderIds("tenant_1", "2026-09-10T09:29:59.000Z", 20), []);
  assert.deepEqual(await service.listPickupOverdueOrderIds("tenant_1", "2026-09-10T09:30:00.000Z", 20), [order.id]);
  ok("领取宽限未到时不入候选，到时才进入待确认爽约候选");

  const marked = await service.markPickupOverdueOrder("tenant_1", order.id, undefined, "运营员", "2026-09-10T09:31:00.000Z");
  assert.equal(marked.status, "pickup_overdue");
  assert.equal(marked.pickupOverdueAt, "2026-09-10T09:31:00.000Z");
  assert.deepEqual(await service.listPickupOverdueOrderIds("tenant_1", "2026-09-10T10:00:00.000Z", 20), [order.id], "已超时但缺通知的订单必须继续扫描以补通知");
  await service.markPickupOverdueOrder("tenant_1", order.id, undefined, "运营员", "2026-09-10T10:00:00.000Z");
  assert.equal(order.pickupOverdueAt, "2026-09-10T09:31:00.000Z", "补通知不能重置超时事实");
  ok("领取超时只进入待确认爽约，不提前释放资源或进入终态");

  await assert.rejects(
    () => service.confirmNoShowOrder("tenant_1", order.id, "未到店", undefined, "运营员", "2026-09-10T10:31:00.000Z"),
    /必须先记录客户通知/u
  );
  await service.recordNoShowNotice("tenant_1", order.id, "2026-09-10T09:32:00.000Z");
  assert.deepEqual(await service.listNoShowCandidateIds("tenant_1", "2026-09-10T10:31:59.000Z", 20), []);
  assert.deepEqual(await service.listNoShowCandidateIds("tenant_1", "2026-09-10T10:32:00.000Z", 20), [order.id]);
  ok("必须先记录通知，且通知后的最终时限未到不能确认爽约");

  const earlyOrder = orderWith({ id: "order_no_show_early" });
  const earlyService = serviceWith(earlyOrder);
  await earlyService.markPickupOverdueOrder("tenant_1", earlyOrder.id, undefined, "运营员", "2026-09-10T09:31:00.000Z");
  await earlyService.recordNoShowNotice("tenant_1", earlyOrder.id, "2026-09-10T09:32:00.000Z");
  const earlyConfirmed = await earlyService.confirmNoShowOrder("tenant_1", earlyOrder.id, "客户明确放弃领取", undefined, "运营员", "2026-09-10T09:33:00.000Z", true);
  assert.equal(earlyConfirmed.status, "no_show");
  ok("已通知后，具备操作权限的人员可以填写原因提前确认爽约");

  const confirmed = await service.confirmNoShowOrder("tenant_1", order.id, "客户未按约领取", undefined, "运营员", "2026-09-10T10:32:00.000Z");
  assert.equal(confirmed.status, "no_show");
  assert.equal(confirmed.noShowReason, "客户未按约领取");
  assert.equal(confirmed.chargeLines.find((row) => row.code === `cancellation:${order.id}`).amount, 25);
  assert.equal(confirmed.chargeLines.find((row) => row.code === `cancellation_reversal:${order.id}`).amount, -100);
  assert.equal(service.saved, true);
  ok("最终确认爽约按订单规则计算费用，并保留取消核减与爽约原因事实");

  const disabled = orderWith({ id: "order_no_show_disabled", ruleSnapshot: { cancellation: { noShow: { enabled: false, pickupGraceMinutes: 30, finalizationMinutes: 60, feeType: "none", feeValue: 0 } }, fulfillment: {} } });
  const disabledService = serviceWith(disabled);
  await assert.rejects(
    () => disabledService.markPickupOverdueOrder("tenant_1", disabled.id, undefined, "系统", "2026-09-10T10:00:00.000Z"),
    /未启用爽约处理/u
  );
  ok("关闭爽约处理时服务端 fail-closed，不会被自动标记");

  const legacy = orderWith({ id: "order_no_show_legacy", ruleSnapshot: { cancellation: {}, fulfillment: {} } });
  const legacyService = serviceWith(legacy);
  assert.deepEqual(await legacyService.listPickupOverdueOrderIds("tenant_1", "2026-09-10T10:00:00.000Z", 20), []);
  await assert.rejects(
    () => legacyService.markPickupOverdueOrder("tenant_1", legacy.id, undefined, "系统", "2026-09-10T10:00:00.000Z"),
    /未启用爽约处理/u
  );
  ok("没有爽约规则快照的存量订单不会被升级后的新逻辑追溯改写");

  // NOTICE-01：模板存在但模拟发送失败时，后台不能误报成“没有启用模板”。
  const controller = Object.create(RentalCoreController.prototype);
  const failedNoticeOrder = orderWith({ id: "order_no_show_notice_failed", status: "pickup_overdue", customerId: "customer-1", contactPhone: "13800000000" });
  controller.service = { getOrder: async () => failedNoticeOrder };
  controller.context = () => ({ notificationContext: true });
  controller.business = {
    emitNotificationEvent: async () => [],
    listNotificationLogs: () => [{
      eventCode: "order.pickup_overdue",
      businessObjectType: "order",
      businessObjectId: failedNoticeOrder.id,
      status: "simulation_failed"
    }]
  };
  await assert.rejects(
    () => controller.sendNoShowNotice({ user: { tenantId: "tenant_1" } }, failedNoticeOrder.id),
    /通知发送失败，客户通知尚未记录/u
  );
  ok("通知模板发送失败时返回真实失败原因，不误报为未启用模板");

  const business = Object.create(RentalBusinessService.prototype);
  business.state = () => ({
    notificationTemplates: [{ id: "template_retry", status: "enabled", variableSchema: {} }],
    notificationLogs: [{ id: "notice_retry", idempotencyKey: "retry-key", status: "failed" }]
  });
  business.factStore = { findNotificationDelivery: async () => ({ log: { id: "notice_retry", status: "delivered" } }) };
  const refreshed = await business.sendNotification("tenant_1", {}, { templateId: "template_retry", recipient: "13800000000", variables: {} }, undefined, { idempotencyKey: "retry-key" });
  assert.equal(refreshed.status, "delivered", "失败通知重试后必须回放最新投递结果，不再用缓存失败状态挡住通知补录");
  ok("通知幂等回放使用最新持久化投递事实，支持失败后的恢复");

  console.log(`\nRULE-CLOSE-01 领取超时与爽约专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
