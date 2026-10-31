const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { buildRentalWorkbenchTodos } = require("../apps/api/src/modules/rental-core/rental-workbench-todos");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

function orderWith(overrides = {}) {
  return {
    id: "order_refund_due_1",
    status: "reserved",
    startAt: "2026-09-10T09:00:00.000Z",
    endAt: "2026-09-11T09:00:00.000Z",
    createdAt: "2026-09-10T08:00:00.000Z",
    payableAmount: 100,
    finalPayableAmount: 100,
    adjustmentAmount: 0,
    totalAmount: 100,
    taxRate: 0,
    taxAmount: 0,
    depositAmount: 200,
    preAuthAmount: 0,
    ruleVersion: "rule-1",
    ruleSnapshot: { cancellation: { freeBeforeHours: 0, lateFeeType: "none", lateFeeValue: 0 }, fulfillment: {} },
    reservations: [{ id: "reservation_1", quantity: 1, releasedQuantity: 0, status: "confirmed" }],
    allocations: [],
    chargeLines: [],
    updatedAt: "2026-09-10T08:30:00.000Z",
    ...overrides
  };
}

function serviceWith(order, held) {
  const service = Object.create(RentalCoreService.prototype);
  service.state = () => ({});
  service.lockedOrder = async () => order;
  service.runHook = async () => undefined;
  service.orderHookInstances = () => [];
  service.resolveWorkspaceId = () => "ws-1";
  service.funding = { computeHeldFunds: async () => held };
  service.factStore = {
    listExtensions: async () => [],
    cancelExtensions: async () => undefined,
    saveOrderAggregate: async () => { service.saved = true; }
  };
  return service;
}

void (async () => {
  /* ---------- 取消仍持押金 → 挂 refund_due 审核，不产生费用明细 ---------- */
  {
    const order = orderWith();
    const service = serviceWith(order, { depositBalance: 200, preauthBalance: 0, rentalOverpaid: 0 });
    await service.cancelOrder("tenant_1", order.id, "客户主动取消", 0, {}, "运营员");
    assert.equal(order.status, "cancelled");
    const refundDue = (order.feeReviews ?? []).filter((row) => row.type === "refund_due");
    assert.equal(refundDue.length, 1, "取消后仍持有押金必须挂一张 refund_due 审核单");
    assert.equal(refundDue[0].suggestedAmount, 200, "建议金额 = 押金余额 + 预授权余额 + 多收租金");
    assert.equal(refundDue[0].status, "pending");
    assert.equal(refundDue[0].sourceId, "cancel");
    // refund_due 不进费用明细：只应有取消核减，没有 refund_due 费用行。
    assert.ok(order.chargeLines.some((row) => row.code === `cancellation_reversal:${order.id}`));
    assert.ok(!order.chargeLines.some((row) => row.type === "refund_due"), "refund_due 不得落成费用明细");
    ok("取消仍持押金时挂 refund_due 审核单，金额=押金+预授权+多收，不动费用明细");
  }

  /* ---------- 多收租金也计入 refund_due（负 balance 取正） ---------- */
  {
    const order = orderWith({ id: "order_refund_due_over" });
    const service = serviceWith(order, { depositBalance: 100, preauthBalance: 50, rentalOverpaid: -40 });
    await service.cancelOrder("tenant_1", order.id, "取消", 0, {}, "运营员");
    const refundDue = (order.feeReviews ?? []).find((row) => row.type === "refund_due");
    assert.equal(refundDue.suggestedAmount, 190, "100 押金 + 50 预授权 + 40 多收 = 190");
    ok("押金、预授权与多收租金一并计入 refund_due 建议金额");
  }

  /* ---------- 无遗留资金时不挂 refund_due ---------- */
  {
    const order = orderWith({ id: "order_refund_due_none" });
    const service = serviceWith(order, { depositBalance: 0, preauthBalance: 0, rentalOverpaid: 0 });
    await service.cancelOrder("tenant_1", order.id, "取消", 0, {}, "运营员");
    assert.ok(!(order.feeReviews ?? []).some((row) => row.type === "refund_due"), "没有遗留资金时不应挂 refund_due");
    ok("无押金/预授权/多收时取消不产生 refund_due 审核单");
  }

  /* ---------- 无 funding 注入的旧路径不受影响 ---------- */
  {
    const order = orderWith({ id: "order_refund_due_nofund" });
    const service = serviceWith(order, { depositBalance: 200, preauthBalance: 0, rentalOverpaid: 0 });
    service.funding = undefined;
    await service.cancelOrder("tenant_1", order.id, "取消", 0, {}, "运营员");
    assert.ok(!(order.feeReviews ?? []).some((row) => row.type === "refund_due"), "未注入资金服务时跳过 refund_due，保持旧行为");
    ok("未注入 RentalFundingService 的内存路径行为不变");
  }

  /* ---------- 裁定批准 refund_due：不产生任何费用明细（金额中性） ---------- */
  {
    const order = orderWith({ id: "order_refund_due_review" });
    const service = serviceWith(order, { depositBalance: 200, preauthBalance: 0, rentalOverpaid: 0 });
    await service.cancelOrder("tenant_1", order.id, "取消", 0, {}, "运营员");
    const review = order.feeReviews.find((row) => row.type === "refund_due");
    const chargeLinesBefore = order.chargeLines.length;
    // 订单已是 cancelled 终态，refund_due 仍可裁定（其余类型此时会被拒）。
    const after = await service.reviewOrderFeeReview("tenant_1", order.id, review.id, { decision: "approved", reason: "已核准退款，转资金区办理" }, "结算员", {});
    const reviewed = after.feeReviews.find((row) => row.id === review.id);
    assert.equal(reviewed.status, "approved");
    assert.equal(after.chargeLines.length, chargeLinesBefore, "批准 refund_due 不得新增任何费用明细");
    assert.equal(after.finalPayableAmount, 0, "批准 refund_due 不改动应付");
    ok("批准 refund_due 金额中性：不落费用明细、不改应付，实际退款仍由资金区办理");
  }

  /* ---------- 工作台：取消/爽约后的 refund_due 生成 cancelled_refund_due 待办 ---------- */
  {
    const cancelledOrder = orderWith({
      id: "order_todo_refund_due",
      status: "cancelled",
      orderNo: "R-0001",
      feeReviews: [{ id: "rev-1", type: "refund_due", suggestedAmount: 200, basis: ["取消遗留押金 200"], status: "pending", createdAt: "2026-09-10T09:00:00.000Z" }]
    });
    const todos = buildRentalWorkbenchTodos([cancelledOrder], [], {}, {}, [], "2026-09-10T10:00:00.000Z");
    const refundTodo = todos.items.find((row) => row.type === "cancelled_refund_due");
    assert.ok(refundTodo, "取消后仍持资金的订单必须生成 cancelled_refund_due 待办");
    assert.equal(refundTodo.priority, "high", "退款/释放待办为高优先级");
    assert.equal(refundTodo.orderId, cancelledOrder.id);
    assert.equal(refundTodo.amount, 200);
    assert.equal(todos.counts.cancelled_refund_due, 1);
    // 同一张 refund_due 不应再重复生成通用 fee_review 待办。
    assert.ok(!todos.items.some((row) => row.type === "fee_review" && row.orderId === cancelledOrder.id), "refund_due 不应再落成通用 fee_review 待办");
    ok("取消/爽约遗留资金聚合为高优先级 cancelled_refund_due 待办，不与 fee_review 重复");
  }

  {
    const serviceRow = (overrides = {}) => ({ occurrenceId: "original-service", serviceId: "service", serviceName: "已履约服务",
      quantity: 3, amount: 120, discountAllocatedAmount: 20, couponAllocatedAmount: 10,
      capacityQuantity: 3, requiresCapacity: false, executionStatus: "completed", executedQuantity: 3,
      executionSegments: [{ quantity: 3, actualEndAt: "2026-09-10T08:00:00Z", result: "completed" }], ...overrides });
    for (const [executedQuantity, expected] of [[3, 90], [1, 30], [0, 0]]) {
      const status = executedQuantity === 3 ? "completed" : executedQuantity ? "in_progress" : "not_started";
      const occurrence = serviceRow({ executionStatus: status, executedQuantity,
        executionSegments: executedQuantity ? [{ quantity: executedQuantity, actualEndAt: "2026-09-10T08:00:00Z", result: "completed" }] : [] });
      const order = orderWith({ payableAmount: 190, finalPayableAmount: 190, totalAmount: 190, status: "ready_for_pickup", serviceSnapshots: [occurrence] });
      const service = serviceWith(order, { depositBalance: 0, preauthBalance: 0, rentalOverpaid: 0 });
      const returned = await service.cancelOrder("tenant_1", order.id, "客户取消", 10, {}, "Operator");
      assert.equal(returned.finalPayableAmount, expected + 10);
      assert.equal(returned.chargeLines.find(row => row.code.startsWith("cancellation_reversal:")).amount, -(190 - expected));
      assert.equal(returned.serviceSnapshots[0].executionSegments.length, executedQuantity ? 1 : 0);
      assert.equal(returned.serviceSnapshots[0].executionStatus, executedQuantity === 3 ? "completed" : "cancelled");
      await assert.rejects(service.cancelOrder("tenant_1", order.id, "重复取消", 10, {}, "Operator"), /当前订单状态不能取消/);
    }
    const occurrence = serviceRow({ requiresCapacity: true, reservationKey: "original-capacity", executionStatus: "in_progress", executedQuantity: 1,
      executionSegments: [{ quantity: 1, actualEndAt: "2026-09-10T08:00:00Z", result: "one completed" }] });
    const order = orderWith({ payableAmount: 190, finalPayableAmount: 190, totalAmount: 190, serviceSnapshots: [occurrence] });
    const service = serviceWith(order, { depositBalance: 0, preauthBalance: 0, rentalOverpaid: 0 });
    const capacityCalls = [];
    service.serviceCapacities = { markPartiallyUsedForOccurrence: async (...args) => capacityCalls.push(args),
      releaseForOccurrence: async () => { throw Error("must preserve used capacity"); } };
    await service.cancelOrder("tenant_1", order.id, "取消未执行部分", 0, {}, "Operator");
    assert.equal(order.finalPayableAmount, 30); assert.equal(capacityCalls.length, 1);
    assert.equal(capacityCalls[0][2], "original-capacity"); assert.equal(capacityCalls[0][3], 1);
    const { RentalServiceCapacityService } = require("../apps/api/src/modules/rental-core/rental-service-capacity.service");
    const capacity = new RentalServiceCapacityService({});
    const reservations = [{ id: "capacity-used", idempotencyKey: "used-key", status: "confirmed", quantity: 1,
      capacityId: "cap", serviceId: "service", tenantId: "tenant_1", workspaceId: "ws-1" }];
    capacity.lockOrderReservations = async () => reservations;
    let released = 0;
    const tx = { businessWorkspace: { findFirst: async () => ({ id: "ws-1" }) },
      rentalServiceCapacity: { updateMany: async () => { released++; return { count: 1 }; } },
      rentalServiceReservation: { updateMany: async ({ where, data }) => {
        const row = reservations.find(row => row.id === where.id && row.status === where.status);
        if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 };
      } } };
    const completedOrder = orderWith({ payableAmount: 190, finalPayableAmount: 190, serviceSnapshots: [serviceRow({ quantity: 1,
      executedQuantity: 1, executionSegments: [{ quantity: 1 }], requiresCapacity: true, capacityQuantity: 1, reservationKey: "used-key" })] });
    const completedService = serviceWith(completedOrder, {}); completedService.serviceCapacities = capacity;
    await completedService.cancelOrder("tenant_1", completedOrder.id, "取消不释放已用容量", 0, tx, "Operator");
    await capacity.releaseForOrder("tenant_1", completedOrder.id, "order_cancelled", new Date().toISOString(), tx);
    assert.equal(reservations[0].status, "used"); assert.equal(released, 0);
    assert.equal(completedOrder.finalPayableAmount, 90);
    ok("订单取消保留已履约服务净额、原执行段与已用容量，只冲销未履行部分并保留原取消费");

    for (const row of [serviceRow({ executionStatus: undefined }), serviceRow({ executionStatus: "in_progress", executedQuantity: 0 }),
      serviceRow({ executedQuantity: 2 }), serviceRow({ executionSegments: [{ quantity: 2 }] }), serviceRow({ amount: NaN })]) {
      const order = orderWith({ serviceSnapshots: [row] });
      const service = serviceWith(order, {});
      await assert.rejects(service.cancelOrder("tenant_1", order.id, "未知不自动全冲", 0, {}, "Operator"));
      assert.equal(service.saved, undefined); assert.equal(order.status, "reserved");
      assert.equal(order.chargeLines.length, 0); assert.equal(order.reservations[0].status, "confirmed");
    }
    const reducedOrder = orderWith({ payableAmount: 190, finalPayableAmount: 70, adjustmentAmount: -120, totalAmount: 70,
      serviceSnapshots: [serviceRow()], feeReviews: [{ id: "original-refund", type: "service_refund", sourceId: "original-service", status: "approved", decidedAmount: 90 }] });
    const reduced = serviceWith(reducedOrder, {});
    await reduced.cancelOrder("tenant_1", reducedOrder.id, "原服务已另行全额核减", 0, {}, "Operator");
    assert.equal(reducedOrder.finalPayableAmount, 0, "approved service deduction is not re-added as earned income");
    ok("履约状态/数量/金额不明时取消不写；已经批准的服务核减不被重新加回收入");
  }

  console.log(`\n取消遗留资金 refund_due 专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
