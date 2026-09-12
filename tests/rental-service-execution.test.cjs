const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalServiceCapacityService } = require("../apps/api/src/modules/rental-core/rental-service-capacity.service");
const { stampOccurrences } = require("../apps/api/src/modules/rental-core/rental-service-occurrence");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };
const at = () => new Date(Date.now() - 1_000).toISOString();

function snapshot(overrides = {}) {
  return {
    serviceId: "svc_cleaning",
    serviceCode: "CLEAN",
    serviceName: "清洁服务",
    serviceType: "cleaning",
    serviceVersion: "1.0",
    termsVersion: "1.0",
    workspaceId: "ws_1",
    billingUnit: "per_order",
    selectionMode: "optional",
    requiredByRule: false,
    unitPrice: 120,
    quantity: 1,
    billingUnits: 1,
    amount: 120,
    discountAllocatedAmount: 20,
    couponAllocatedAmount: 10,
    formula: "120 × 1 × 1",
    terms: "清洁服务条款",
    eligibility: [],
    insuredDisplayable: false,
    requiresCapacity: true,
    scheduledStartAt: "2040-01-01T09:00:00.000Z",
    scheduledEndAt: "2040-01-01T10:00:00.000Z",
    serviceLocationId: "loc_1",
    capacityQuantity: 1,
    ...overrides
  };
}

function orderWith(occurrence) {
  return {
    id: "order_service_1",
    tenantId: "tenant_1",
    status: "renting",
    payableAmount: 500,
    finalPayableAmount: 500,
    adjustmentAmount: 0,
    totalAmount: 500,
    taxRate: 0,
    taxAmount: 0,
    ruleVersion: "rule-1",
    chargeLines: [],
    serviceSnapshots: [occurrence]
  };
}

function serviceFor(order, calls) {
  const service = Object.create(RentalCoreService.prototype);
  service.lockedOrder = async () => order;
  service.factStore = { saveOrderAggregate: async () => { calls.saved += 1; } };
  service.serviceCapacities = {
    markUsedForOccurrence: async (...args) => calls.used.push(args),
    releaseForOccurrence: async (...args) => calls.released.push(args)
  };
  return service;
}

void (async () => {
  const stamped = stampOccurrences([snapshot()], { origin: "order", ownerId: "order_service_1", requestKey: "order-key" })[0];
  assert.equal(stamped.executionStatus, "not_started", "新发生项默认必须是未开始");
  ok("下单发生项默认带未开始状态，不靠计划时间推断履约");

  {
    const calls = { saved: 0, used: [], released: [] };
    const order = orderWith({ ...stamped });
    const service = serviceFor(order, calls);
    const started = await service.updateServiceOccurrence("tenant_1", order.id, stamped.occurrenceId, {
      action: "start", actualAt: at()
    }, "操作员", {});
    assert.equal(started.occurrence.executionStatus, "in_progress");
    assert.equal(calls.used.length, 0);
    const completed = await service.updateServiceOccurrence("tenant_1", order.id, stamped.occurrenceId, {
      action: "complete", actualAt: at(), result: "已清洁并交付", customerConfirmed: true,
      evidenceAttachments: ["photo:service-1"]
    }, "操作员", {});
    assert.equal(completed.occurrence.executionStatus, "completed");
    assert.equal(completed.occurrence.customerConfirmedAt !== undefined, true);
    assert.equal(calls.used.length, 1, "完成只转换当前发生项的容量");
    assert.equal(order.feeReviews?.length ?? 0, 0);
    ok("开始/完成记录实际时间、结果、客户确认与证据，并只转换本次容量");
  }

  {
    const calls = { saved: 0, used: [], released: [] };
    const occurrence = stampOccurrences([snapshot()], { origin: "order", ownerId: "order_service_1", requestKey: "order-key-2" })[0];
    const order = orderWith(occurrence);
    const service = serviceFor(order, calls);
    const failed = await service.updateServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, {
      action: "fail", actualAt: at(), reason: "服务方未能到场"
    }, "操作员", {});
    assert.equal(failed.occurrence.executionStatus, "failed");
    assert.equal(failed.occurrence.refundAmount, 90, "退款建议按原价扣除优惠与券后的净额");
    assert.equal(failed.occurrence.refundStatus, "pending_review");
    assert.equal(order.feeReviews?.[0].type, "service_refund");
    assert.equal(order.feeReviews?.[0].sourceId, occurrence.occurrenceId);
    assert.equal(calls.released.length, 1, "未开始失败释放当前发生项容量");
    ok("未开始服务失败生成净额退款审核，并释放对应容量");

    const reviewId = order.feeReviews[0].id;
    service.lockedOrder = async () => order;
    const reviewed = await service.reviewOrderFeeReview("tenant_1", order.id, reviewId, {
      decision: "approved", reason: "服务方责任，批准净额退款"
    }, "审核员", {});
    assert.equal(reviewed.serviceSnapshots[0].refundStatus, "approved_pending_refund");
    assert.equal(reviewed.chargeLines[0].amount, -90);
    ok("服务退款审核批准只核减应收，状态明确为待实际退款");

    await assert.rejects(
      () => service.refundServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, 80, "结算员", {}),
      /必须等于已批准金额/u,
      "实际退款金额不能绕过审核结论"
    );
    const refunded = await service.refundServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, 90, "结算员", {});
    assert.equal(refunded.occurrence.refundStatus, "refunded");
    assert.ok(refunded.occurrence.refundedAt);
    assert.equal(refunded.occurrence.refundedBy, "结算员");
    await assert.rejects(
      () => service.refundServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, 90, "结算员", {}),
      /尚未批准，或已经办理过/u,
      "同一服务不能重复办理实际退款"
    );
    ok("实际退款金额必须匹配已批准金额，成功后记录退款人和时间并拒绝重复办理");
  }

  {
    const calls = { saved: 0, used: [], released: [] };
    const occurrence = stampOccurrences([snapshot()], { origin: "order", ownerId: "order_service_1", requestKey: "order-key-3" })[0];
    const service = serviceFor(orderWith(occurrence), calls);
    await assert.rejects(
      () => service.updateServiceOccurrence("tenant_1", "order_service_1", occurrence.occurrenceId, { action: "complete", actualAt: at() }, "操作员", {}),
      /执行结果/u
    );
    ok("完成动作没有结果或客户确认时拒绝落库");
  }

  {
    const capacity = new RentalServiceCapacityService({});
    const calls = [];
    capacity.lockOrderReservations = async () => [{ id: "res_1", serviceId: "svc_cleaning", capacityId: "cap_1", quantity: 1, status: "confirmed", idempotencyKey: "key_1" }];
    const tx = {
      businessWorkspace: { findFirst: async () => ({ id: "ws_1" }) },
      rentalServiceReservation: { updateMany: async (input) => { calls.push(input); return { count: 1 }; } },
      rentalServiceCapacity: { updateMany: async (input) => { calls.push(input); return { count: 1 }; } }
    };
    await assert.rejects(
      () => capacity.settleReturnForOrder("tenant_1", { id: "order_service_1", serviceSnapshots: [snapshot({ reservationKey: "key_1", executionStatus: "in_progress" })] }, at(), tx),
      /先完成、取消或记录失败/u
    );
    assert.equal(calls.length, 0, "执行中的服务不能被归还动作偷偷结算");
    ok("归还不会按计划时间自动完成执行中的服务");
  }

  {
    // MKT-02D：未收口服务（执行中）不能静默关单——变异（删掉 settleOrder 的闸门）必须报红。
    const calls = { saved: 0, voided: 0, extensions: [], used: [], released: [] };
    const occurrence = stampOccurrences([snapshot()], { origin: "order", ownerId: "order_service_1", requestKey: "order-key-4" })[0];
    const settlingOrder = { ...orderWith({ ...occurrence, executionStatus: "in_progress", actualStartAt: at() }), status: "settling" };
    const service = serviceFor(settlingOrder, calls);
    service.factStore.listExtensions = async () => calls.extensions;
    service.factStore.voidPendingExtensions = async () => { calls.voided += 1; };
    await assert.rejects(
      () => service.settleOrder("tenant_1", settlingOrder.id, {}),
      /未收口/u,
      "执行中的服务必须阻断关单"
    );
    assert.equal(calls.saved, 0, "被阻断的关单不得保存订单聚合");
    // 对照：完成同一服务后关单走通——证明阻断来自服务状态而非测试桩。
    await service.updateServiceOccurrence("tenant_1", settlingOrder.id, occurrence.occurrenceId, {
      action: "complete", actualAt: at(), result: "已清洁并交付", customerConfirmed: true
    }, "操作员", {});
    const settled = await service.settleOrder("tenant_1", settlingOrder.id, {});
    assert.equal(settled.status, "completed", "完成服务后关单走通");
    ok("未收口服务阻断关单且不保存聚合；完成后关单走通");
  }

  {
    // MKT-02D：未到场与取消的净额退款进待办；重复回调不重复退款建议。
    const calls = { saved: 0, used: [], released: [] };
    const occurrence = stampOccurrences([snapshot()], { origin: "order", ownerId: "order_service_1", requestKey: "order-key-5" })[0];
    const order = orderWith({ ...stamped });
    const service = serviceFor(order, calls);
    const noShow = await service.updateServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, {
      action: "no_show", actualAt: at(), reason: "客户未到场"
    }, "操作员", {});
    assert.equal(noShow.occurrence.executionStatus, "no_show");
    assert.equal(noShow.occurrence.refundAmount, 90, "未到场退款建议按净额（120-20-10=90）");
    assert.equal(noShow.occurrence.refundStatus, "pending_review");
    assert.equal(calls.released.length, 1, "未到场释放对应容量");
    // 同一发生项重复 no_show：状态已是终态，必须拒绝——不会重复产生退款建议。
    await assert.rejects(
      () => service.updateServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, { action: "no_show", actualAt: at(), reason: "重复" }, "操作员", {}),
      /不能/u,
      "重复回调必须被状态机拒绝"
    );
    assert.equal((order.feeReviews ?? []).length, 1, "不重复堆退款待办");
    ok("未到场按净额退款进待办并释放容量；重复回调被状态机拒绝");
  }

  {
    // 兼容存量订单：没有 occurrenceId 的旧服务快照不属于新履约状态机，不能被缺省的
    // not_started 永久卡在结算入口；新链路发生项仍由上面的闸门严格控制。
    const calls = { saved: 0, voided: 0, extensions: [], used: [], released: [] };
    const legacyOrder = { ...orderWith({ ...snapshot(), occurrenceId: undefined, executionStatus: undefined }), status: "settling" };
    const service = serviceFor(legacyOrder, calls);
    service.factStore.listExtensions = async () => calls.extensions;
    service.factStore.voidPendingExtensions = async () => { calls.voided += 1; };
    const settled = await service.settleOrder("tenant_1", legacyOrder.id, {});
    assert.equal(settled.status, "completed", "旧服务快照不能因缺少履约字段而阻断结算");
    ok("存量订单的旧服务快照不误触发新履约关单闸门");
  }

  {
    const calls = { saved: 0, used: [], released: [] };
    const occurrence = stampOccurrences([snapshot()], { origin: "order", ownerId: "order_service_1", requestKey: "order-key-time" })[0];
    const actualStartAt = new Date(Date.now() - 500).toISOString();
    const earlierActualAt = new Date(Date.now() - 1_000).toISOString();
    const order = orderWith({ ...occurrence, executionStatus: "in_progress", actualStartAt });
    const service = serviceFor(order, calls);
    await assert.rejects(
      () => service.updateServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, { action: "fail", actualAt: earlierActualAt, reason: "服务失败" }, "操作员", {}),
      /结束时间不能早于开始时间/u,
      "执行中服务的失败时间不能早于开始时间"
    );
    assert.equal(calls.saved, 0, "无效的失败时间不得保存订单聚合");
    ok("执行中服务的失败动作校验实际结束时间不早于开始时间");
  }

  console.log(`\nMKT-02D 服务实际履约专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
