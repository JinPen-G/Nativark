const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalServiceCapacityService } = require("../apps/api/src/modules/rental-core/rental-service-capacity.service");
const { stampOccurrences } = require("../apps/api/src/modules/rental-core/rental-service-occurrence");
const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");
const { RentalIdempotencyRepository } = require("../apps/api/src/modules/rental-core/rental-idempotency.repository");
const { RentalIdempotentActionService } = require("../apps/api/src/modules/rental-core/rental-idempotent-action.service");
const { runWithRequestIdentity, getRequestIdentity } = require("../apps/api/src/common/request-identity");

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
  service.factStore = { saveOrderAggregate: async () => { calls.saved += 1; }, listInspections: async () => [] };
  service.serviceCapacities = {
    markUsedForOccurrence: async (...args) => calls.used.push(args),
    releaseForOccurrence: async (...args) => calls.released.push(args),
    markPartiallyUsedForOccurrence: async (...args) => (calls.partialUsed ??= []).push(args)
  };
  return service;
}

function receiptFixture() {
  const occurrence = stampOccurrences([snapshot({ quantity: 3, amount: 300, capacityQuantity: 3 })],
    { origin: "order", ownerId: "order_service_1", requestKey: "receipt-key" })[0];
  let order = orderWith(occurrence), records = [], transactions = 0, dropRead = false, failPersistence = false;
  const calls = { saved: 0, used: [], released: [] };
  const service = serviceFor(order, calls);
  service.lockedOrder = async () => order;
  service.requireOrder = async () => {
    const identity = getRequestIdentity();
    if (identity?.tenantId !== "tenant_1" || identity.workspaceId !== "ws_1" || identity.userId !== "operator") {
      const { ForbiddenException } = require("@nestjs/common"); throw new ForbiddenException("scope denied");
    }
    return order;
  };
  service.state = () => ({});
  service.persist = async () => { if (failPersistence) { failPersistence = false; throw Error("post-commit projection failed"); } };
  const rows = {
    businessWorkspace: { findFirst: async ({ where }) => where.tenantId === "tenant_1" && where.id === "ws_1" ? { id: "ws_1" } : null },
    rentalOrderIdempotencyRecord: {
      findFirst: async ({ where }) => {
        if (dropRead) { dropRead = false; return null; }
        return records.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
      },
      create: async ({ data }) => { records.push(structuredClone(data)); return data; }
    }
  };
  const prisma = { ...rows, $transaction: async (work, options) => {
    assert.equal(options.isolationLevel, "ReadCommitted"); transactions++;
    const before = structuredClone(order), beforeRecords = structuredClone(records), beforeCalls = structuredClone(calls);
    try { return await work(rows); } catch (error) {
      order = before; records = beforeRecords; Object.assign(calls, beforeCalls); throw error;
    }
  } };
  const controller = Object.create(RentalCoreController.prototype);
  controller.service = service;
  controller.business = { persist: async () => undefined };
  controller.idempotent = new RentalIdempotentActionService(prisma, new RentalIdempotencyRepository(prisma));
  const req = key => ({ user: { tenantId: "tenant_1", id: "operator", displayName: "Operator" }, headers: { "idempotency-key": key } });
  return { controller, calls, occurrenceId: occurrence.occurrenceId, req, order: () => order, records: () => records,
    transactions: () => transactions, dropRead: () => { dropRead = true; }, failPersistence: () => { failPersistence = true; } };
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
    const occurrence = stampOccurrences([snapshot({ quantity: 3, amount: 300, unitPrice: 100, discountAllocatedAmount: 0, couponAllocatedAmount: 0, formula: "100 × 3 × 1", capacityQuantity: 3 })], { origin: "order", ownerId: "order_service_1", requestKey: "order-key-partial" })[0];
    const order = orderWith(occurrence);
    const service = serviceFor(order, calls);
    await service.updateServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, { action: "start", actualAt: at() }, "操作员", {});
    const partial = await service.updateServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, {
      action: "complete", actualAt: at(), executedQuantity: 1, result: "先完成 1 份", customerConfirmed: true
    }, "操作员", {});
    assert.equal(partial.occurrence.executionStatus, "in_progress", "部分完成后服务仍应保留待处理状态");
    assert.equal(partial.occurrence.executedQuantity, 1);
    assert.equal(partial.occurrence.executionSegments.length, 1);
    assert.equal(calls.used.length, 0, "部分完成不能把整项容量误标成已完成");
    await assert.rejects(
      () => service.updateServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, {
        action: "complete", actualAt: at(), executedQuantity: 3, result: "越过剩余数量", customerConfirmed: true
      }, "操作员", {}),
      /本次执行数量必须在 1 到 2 之间/u,
      "本次执行数量不能超过剩余数量"
    );
    const completed = await service.updateServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, {
      action: "complete", actualAt: at(), executedQuantity: 2, result: "剩余 2 份完成", customerConfirmed: true
    }, "操作员", {});
    assert.equal(completed.occurrence.executionStatus, "completed");
    assert.equal(completed.occurrence.executedQuantity, 3);
    assert.equal(completed.occurrence.executionSegments.length, 2);
    assert.equal(calls.used.length, 1, "全部执行后才转换当前服务容量");
    ok("数量服务支持分次完成，保留每段事实并只在全部完成后收口");
  }

  {
    const calls = { saved: 0, used: [], released: [] };
    const occurrence = stampOccurrences([snapshot({ quantity: 3, amount: 300, unitPrice: 100, discountAllocatedAmount: 0, couponAllocatedAmount: 0, formula: "100 × 3 × 1", capacityQuantity: 3 })], { origin: "order", ownerId: "order_service_1", requestKey: "order-key-partial-fail" })[0];
    const order = orderWith(occurrence);
    const service = serviceFor(order, calls);
    await service.updateServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, { action: "start", actualAt: at() }, "操作员", {});
    await service.updateServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, {
      action: "complete", actualAt: at(), executedQuantity: 1, result: "完成 1 份", customerConfirmed: true
    }, "操作员", {});
    const failed = await service.updateServiceOccurrence("tenant_1", order.id, occurrence.occurrenceId, {
      action: "fail", actualAt: at(), reason: "剩余资源无法继续提供"
    }, "操作员", {});
    assert.equal(failed.occurrence.executionStatus, "failed");
    assert.equal(failed.occurrence.executedQuantity, 1);
    assert.equal(failed.occurrence.refundAmount, 200, "失败退款只能覆盖未执行的 2 份");
    assert.equal(failed.occurrence.refundStatus, "pending_review");
    assert.equal(calls.partialUsed.length, 1, "部分失败必须拆分已用与未用容量");
    assert.equal(calls.partialUsed[0][3], 1, "只保留实际执行的 1 份容量");
    assert.equal(calls.used.length, 0, "不能把原来 3 份全部标为已使用");
    assert.equal(order.feeReviews[0].decidedAmount, undefined);
    assert.ok(order.feeReviews[0].basis.includes("未执行净额：200"), "退款审核依据必须说明未执行净额");
    ok("部分执行后失败只为未执行数量生成退款审核，不冲销已执行事实");
  }

  {
    const capacity = new RentalServiceCapacityService({});
    capacity.lockOrderReservations = async () => [{
      id: "res_partial", tenantId: "tenant_1", workspaceId: "ws_1", orderId: "order_service_1",
      serviceId: "svc_cleaning", capacityId: "cap_1", quantity: 3, status: "confirmed",
      idempotencyKey: "key_partial", reservedAt: new Date(), confirmedAt: new Date()
    }];
    const changes = [];
    const tx = {
      businessWorkspace: { findFirst: async () => ({ id: "ws_1" }) },
      rentalServiceCapacity: { updateMany: async (input) => { changes.push(["capacity", input]); return { count: 1 }; } },
      rentalServiceReservation: {
        updateMany: async (input) => { changes.push(["used", input]); return { count: 1 }; },
        create: async (input) => { changes.push(["released", input]); return input.data; }
      }
    };
    await capacity.markPartiallyUsedForOccurrence("tenant_1", "order_service_1", "key_partial", 1, "剩余服务失败", at(), tx);
    assert.equal(changes[0][1].data.usedQuantity.decrement, 2, "未执行的两份要回到可用容量");
    assert.equal(changes[1][1].data.quantity, 1, "已用流水只保留一份");
    assert.equal(changes[2][1].data.quantity, 2, "另存未执行的两份释放流水");
    assert.equal(changes[2][1].data.status, "released");
    ok("部分服务容量按实际执行与未执行份数拆账，保留两条流水");
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

  await runWithRequestIdentity({ tenantId: "tenant_1", workspaceId: "ws_1", userId: "operator" }, async () => {
    const fixture = receiptFixture(), { controller, occurrenceId, req, calls } = fixture;
    const complete = quantity => ({ action: "complete", executedQuantity: quantity, actualAt: at(), result: `completed ${quantity}`, customerConfirmed: true });
    const first = complete(1);
    await assert.rejects(controller.updateServiceOccurrence(req(undefined), "order_service_1", occurrenceId, first), error => error.status === 400);
    assert.equal(fixture.transactions(), 0);
    await assert.rejects(controller.updateServiceOccurrence(req("invalid-zero"), "order_service_1", occurrenceId, { ...first, executedQuantity: 0 }),
      error => error.status === 400 && error.getResponse().serviceExecutionNotCommitted === true);
    assert.equal(fixture.transactions(), 0, "pre-executor refusal has a precise no-dispatch marker");
    await assert.rejects(controller.updateServiceOccurrence(req("invalid-quantity"), "order_service_1", occurrenceId, { ...first, executedQuantity: 4 }),
      error => error.status === 400 && error.getResponse().serviceExecutionNotCommitted !== true);
    assert.equal(fixture.order().serviceSnapshots[0].executedQuantity, 0);
    assert.equal(fixture.records().length, 0);
    fixture.failPersistence();
    await assert.rejects(controller.updateServiceOccurrence(req("segment-1"), "order_service_1", occurrenceId, first), /post-commit projection failed/);
    assert.equal(fixture.order().serviceSnapshots[0].executedQuantity, 1);
    assert.equal(fixture.records().length, 1, "domain and original receipt committed before response failure");
    const recovered = await controller.updateServiceOccurrence(req("segment-1"), "order_service_1", occurrenceId, first);
    assert.equal(recovered.occurrence.executedQuantity, 1); assert.equal(fixture.transactions(), 2);
    const second = complete(1);
    await controller.updateServiceOccurrence(req("segment-2"), "order_service_1", occurrenceId, second);
    const later = await controller.updateServiceOccurrence(req("segment-1"), "order_service_1", occurrenceId, first);
    assert.equal(later.occurrence.executedQuantity, 1, "original receipt is not latest occurrence");
    assert.equal(later.order.serviceSnapshots[0].executedQuantity, 2);
    const third = complete(1);
    await controller.updateServiceOccurrence(req("segment-3"), "order_service_1", occurrenceId, third);
    fixture.order().status = "completed";
    const terminal = await controller.updateServiceOccurrence(req("segment-1"), "order_service_1", occurrenceId, first);
    assert.equal(terminal.order.status, "completed"); assert.equal(terminal.occurrence.executionStatus, "in_progress");
    assert.equal(calls.saved, 3); assert.equal(calls.used.length, 1);
    await assert.rejects(controller.updateServiceOccurrence(req("segment-1"), "order_service_1", occurrenceId, { ...first, executedQuantity: 2 }), error => error.status === 409);
    const read = await controller.getServiceExecutionReceipt(req("segment-1"), "order_service_1", occurrenceId);
    assert.equal(read.status, "committed"); assert.equal(read.occurrence.executedQuantity, 1);
    assert.deepEqual(await controller.getServiceExecutionReceipt(req("unknown"), "order_service_1", occurrenceId), { status: "unknown" });
    assert.equal(fixture.transactions(), 4, "receipt observation never executes the command");
    await assert.rejects(controller.getServiceExecutionReceipt(req("segment-1"), "different-order", occurrenceId), error => error.status === 409);
    await assert.rejects(runWithRequestIdentity({ tenantId: "tenant_1", workspaceId: "other", userId: "operator" },
      () => controller.getServiceExecutionReceipt(req("segment-1"), "order_service_1", occurrenceId)), error => error.status === 403);
    fixture.order().serviceSnapshots[0].executionSegments[0].result = "tampered";
    const transactionsBefore = fixture.transactions();
    await assert.rejects(controller.getServiceExecutionReceipt(req("segment-1"), "order_service_1", occurrenceId), error => error.status === 409);
    await assert.rejects(controller.updateServiceOccurrence(req("segment-1"), "order_service_1", occurrenceId, first), error => error.status === 409);
    assert.equal(fixture.transactions(), transactionsBefore, "unsafe original receipt must not re-enter business execution");
    ok("分次完成原键在丢响应、后续完成及关单后读回原段；未知和篡改不执行，当前范围仍校验");

    const race = receiptFixture();
    const input = complete(1);
    await race.controller.updateServiceOccurrence(race.req("race-key"), "order_service_1", race.occurrenceId, input);
    race.dropRead();
    const raced = await race.controller.updateServiceOccurrence(race.req("race-key"), "order_service_1", race.occurrenceId, input);
    assert.equal(raced.occurrence.executedQuantity, 1);
    assert.equal(race.order().serviceSnapshots[0].executedQuantity, 1, "in-transaction duplicate discovery rolls back tentative second segment");
    assert.equal(race.calls.saved, 1); assert.equal(race.records().length, 1);
    await race.controller.updateServiceOccurrence(race.req("cancel-rest"), "order_service_1", race.occurrenceId,
      { action: "cancel", actualAt: at(), reason: "remaining service cancelled" });
    const cancelled = await race.controller.getServiceExecutionReceipt(race.req("race-key"), "order_service_1", race.occurrenceId);
    assert.equal(cancelled.occurrence.executionStatus, "in_progress");
    assert.equal(cancelled.order.serviceSnapshots[0].executionStatus, "cancelled");
    ok("同键事务窗口回滚第二段，取消剩余服务不抹掉已执行段原收据");
  });

  {
    const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
    const helpers = {}, journal = {};
    new Function("exports", ts.transpileModule(fs.readFileSync(path.join(__dirname, "../apps/admin/src/features/ai-native/settings-operation-reference.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(helpers);
    new Function("exports", "require", ts.transpileModule(fs.readFileSync(path.join(__dirname, "../apps/admin/src/features/rental-core/service-execution-reference.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(journal, name => {
        assert.match(name, /settings-operation-reference$/); return helpers;
      });
    const rows = new Map(), storage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) };
    const reference = { version: 1, scope: "tenant/workspace/user", orderId: "order", occurrenceId: "occurrence", key: "original-key", action: "complete" };
    journal.retainServiceExecutionReference(storage, reference);
    assert.deepEqual(journal.readServiceExecutionReference(storage, reference.scope, reference.orderId).pending, reference);
    assert.equal(journal.readServiceExecutionReference(storage, "other-scope", "order").pending, null);
    assert.throws(() => journal.retainServiceExecutionReference(storage, { ...reference, key: "new-key" }));
    assert.throws(() => journal.clearServiceExecutionReference(storage, { ...reference, key: "new-key" }));
    assert.equal(journal.readServiceExecutionReference(undefined, reference.scope, reference.orderId).blocked, true);
    const storedKey = journal.serviceExecutionStorageKey(reference.scope, reference.orderId);
    rows.set(storedKey, "{corrupt");
    assert.equal(journal.readServiceExecutionReference(storage, reference.scope, reference.orderId).blocked, true);
    rows.set(storedKey, JSON.stringify(reference));
    journal.clearServiceExecutionReference(storage, reference); assert.equal(rows.size, 0);
    const returnJournal = {};
    new Function("exports", "require", ts.transpileModule(fs.readFileSync(path.join(__dirname, "../apps/admin/src/features/rental-core/return-operation-reference.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(returnJournal, name => {
        assert.match(name, /settings-operation-reference$/); return helpers;
      });
    const payload = { items: [{ allocationId: "actual-allocation", quantity: 1 }] };
    for (const kind of ["partial", "inspection"]) {
      const original = await returnJournal.retainReturnOperation(storage, reference.scope, "order", kind, payload);
      const retry = await returnJournal.retainReturnOperation(storage, reference.scope, "order", kind, structuredClone(payload));
      assert.equal(retry.key, original.key, "lost responses and reloads retain the original batch");
      await assert.rejects(returnJournal.retainReturnOperation(storage, reference.scope, "order",
        kind === "partial" ? "inspection" : "partial", payload), /不能切换归还入口/);
      await assert.rejects(returnJournal.retainReturnOperation(storage, reference.scope, "order", kind,
        { items: [{ allocationId: "actual-allocation", quantity: 2 }] }), /原归还批次/);
      returnJournal.clearReturnOperation(storage, original);
      const next = await returnJournal.retainReturnOperation(storage, reference.scope, "order", kind, payload);
      assert.notEqual(next.key, original.key, "only a confirmed receipt permits the next real batch");
      returnJournal.clearReturnOperation(storage, next);
    }
    await assert.rejects(returnJournal.retainReturnOperation(undefined, reference.scope, "order", "partial", payload));
    assert.equal(rows.size, 0);
    const source = fs.readFileSync(path.join(__dirname, "../apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx"), "utf8");
    assert.match(source, /retainServiceExecutionReference\(serviceReferenceStorage\(\), command.reference\)/);
    assert.match(source, /command.reference.orderId, command.reference.occurrenceId, command.data, command.reference.key/);
    assert.match(source, /currentSessionEpoch\(\) === epoch/);
    assert.match(source, /receipt.status === "unknown"/);
    assert.match(source, /!command.uncertain && failure.response\?\.status === 400/);
    assert.match(source, /return \(\) => \{ serviceOwner.current = \{ id: "", scope: "", epoch: -1 \}/);
    const { requiredPermissions } = require("../apps/api/src/common/api-auth.guard");
    assert.deepEqual(requiredPermissions("GET", "/rental/v1/orders/order/services/occurrence/execution-receipt"), ["rental-os:order:view"]);
    const { API_CONTRACT_OPERATIONS, OPENAPI_DOCUMENT } = require("../apps/api/src/contracts/openapi-document");
    const route = "/api/rental/v1/orders/{id}/services/{occurrenceId}/execution-receipt";
    const operation = API_CONTRACT_OPERATIONS.find(row => row.path === route && row.method === "get");
    assert.deepEqual(operation.permissions, ["rental-os:order:view"]);
    assert.equal(OPENAPI_DOCUMENT.paths[route].get.parameters.find(row => row.name === "Idempotency-Key").required, true);
    ok("后台只持久化原操作定位，刷新保留引用；新键覆盖、损坏存储与跨会话回包均不得推进新操作");
  }

  console.log(`\nMKT-02D 服务实际履约专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
