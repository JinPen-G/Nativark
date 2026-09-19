const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

function orderWith(overrides = {}) {
  return {
    id: "order_resume_1",
    status: "pickup_overdue",
    startAt: "2026-09-10T09:00:00.000Z",
    endAt: "2026-09-11T09:00:00.000Z",
    createdAt: "2026-09-10T08:00:00.000Z",
    payableAmount: 100,
    finalPayableAmount: 100,
    adjustmentAmount: 0,
    totalAmount: 100,
    depositAmount: 200,
    preAuthAmount: 0,
    pickupOverdueAt: "2026-09-10T09:31:00.000Z",
    noShowNoticeAt: "2026-09-10T09:32:00.000Z",
    ruleVersion: "rule-1",
    ruleSnapshot: { cancellation: { noShow: { enabled: true, pickupGraceMinutes: 30, finalizationMinutes: 60 } }, fulfillment: {}, payment: { unpaidHoldMinutes: 15 } },
    reservations: [{ id: "reservation_1", orderLineId: "line-1", itemGroupId: "grp-1", locationId: "loc-1", quantity: 1, releasedQuantity: 0, status: "fulfilled" }],
    allocations: [{ id: "alloc-1", orderLineId: "line-1", itemGroupId: "grp-1", assetId: "asset-1", quantity: 1, status: "allocated" }],
    chargeLines: [],
    updatedAt: "2026-09-10T09:31:00.000Z",
    ...overrides
  };
}

function serviceWith(order) {
  const service = Object.create(RentalCoreService.prototype);
  service.state = () => ({});
  service.lockedOrder = async () => order;
  service.resolveWorkspaceId = () => "ws-1";
  // 领取复核：以桩替身表示资产/库存仍可交付。
  service.assertAllocatedPickupReady = async () => undefined;
  service.__changes = [];
  service.factStore = {
    saveOrderAggregate: async () => { service.saved = true; },
    listOrderChanges: async () => service.__changes,
    insertOrderChange: async (change) => { service.__changes.push(change); }
  };
  return service;
}

void (async () => {
  /* ---------- 恢复领取：PickupOverdue → ReadyForPickup ---------- */
  {
    const order = orderWith();
    const service = serviceWith(order);
    const resumed = await service.resumePickupOverdueOrder("tenant_1", order.id, {}, "运营员", true);
    assert.equal(resumed.status, "ready_for_pickup");
    assert.equal(resumed.pickupOverdueAt, undefined, "恢复领取必须清空领取逾期时间");
    assert.equal(resumed.noShowNoticeAt, undefined, "恢复领取必须清空爽约通知时间");
    assert.equal(service.saved, true);
    assert.equal(service.__changes.length, 1, "必须追加一条订单变更历史");
    assert.equal(service.__changes[0].type, "resume_pickup");
    assert.equal(service.__changes[0].status, "applied");
    assert.equal(service.__changes[0].request.type, "resume_pickup");
    assert.equal(service.__changes[0].request.customerConfirmed, true);
    assert.equal(service.__changes[0].refundAmount, 0);
    assert.equal(service.__changes[0].additionalAmount, 0);
    ok("待确认爽约订单恢复为待领取，清空逾期/通知时间戳并留痕，不动金额");
  }

  /* ---------- 只有 PickupOverdue 可恢复；其他状态一律 409 ---------- */
  for (const status of ["reserved", "ready_for_pickup", "renting", "draft", "cancelled", "no_show"]) {
    const order = orderWith({ status });
    const service = serviceWith(order);
    await assert.rejects(
      () => service.resumePickupOverdueOrder("tenant_1", order.id, {}, "运营员", true),
      /只有待确认爽约订单才能恢复领取/u,
      `状态 ${status} 不应允许恢复领取`
    );
  }
  ok("非待确认爽约状态恢复领取一律被拒");

  /* ---------- 未确认客户仍要领取时拒绝 ---------- */
  {
    const order = orderWith();
    const service = serviceWith(order);
    await assert.rejects(
      () => service.resumePickupOverdueOrder("tenant_1", order.id, {}, "运营员", false),
      /必须确认客户仍要领取/u
    );
    ok("未确认客户意愿时拒绝恢复领取");
  }

  /* ---------- 领取复核失败则整体回滚，状态留在 PickupOverdue ---------- */
  {
    const order = orderWith();
    const service = serviceWith(order);
    service.assertAllocatedPickupReady = async () => { throw new Error("锁定资产尚未回库"); };
    await assert.rejects(() => service.resumePickupOverdueOrder("tenant_1", order.id, {}, "运营员", true), /锁定资产尚未回库/u);
    assert.equal(order.status, "pickup_overdue", "复核失败不得改写订单状态");
    ok("资产/库存复核失败时恢复领取被拒，状态不变");
  }

  /* ---------- applySecurityDeltaTo：roundMoney + 0 处封底 ---------- */
  {
    const instance = Object.create(RentalCoreService.prototype);
    const order = { depositAmount: 50, preAuthAmount: 30 };
    instance.applySecurityDeltaTo(order, { deposit: -100, preAuth: -10 });
    assert.equal(order.depositAmount, 0, "押金负 delta 叠加后必须封底到 0，不得为负");
    assert.equal(order.preAuthAmount, 20);
    instance.applySecurityDeltaTo(order, { deposit: 10.005 });
    assert.equal(order.depositAmount, 10.01, "增额走 roundMoney，含 Number.EPSILON 修正舍入边界");
    instance.applySecurityDeltaTo(order, {});
    assert.equal(order.depositAmount, 10.01, "空 delta 不改动任何字段");
    ok("applySecurityDeltaTo 统一取整并在 0 处封底");
  }

  /* ---------- 无预占草稿单按 createdAt + 待支付保留时长判到期 ---------- */
  {
    const order = orderWith({ id: "order_draft_hold", status: "draft", reservations: [], allocations: [] });
    const service = serviceWith(order);
    let cancelledWith;
    service.cancelOrder = async (tenantId, orderId, reason) => { cancelledWith = { tenantId, orderId, reason }; return order; };
    // createdAt 08:00 + 15 分钟保留 = 08:15；此前拒绝。
    await assert.rejects(
      () => service.expirePendingOrder("tenant_1", order.id, {}, "system", "2026-09-10T08:14:00.000Z"),
      /待支付占用尚未全部到期/u
    );
    // 到 08:15 之后可过期，回落到 cancelOrder。
    await service.expirePendingOrder("tenant_1", order.id, {}, "system", "2026-09-10T08:16:00.000Z");
    assert.ok(cancelledWith, "无预占草稿单到期后应走取消路径终结");
    ok("无库存预占草稿单按 createdAt + 待支付保留时长判到期，不再因缺软预占永远卡住");
  }

  console.log(`\n恢复领取 / 保证金增量 / 无预占草稿到期专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
