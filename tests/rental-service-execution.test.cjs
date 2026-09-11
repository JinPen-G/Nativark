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

  console.log(`\nMKT-02D 服务实际履约专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
