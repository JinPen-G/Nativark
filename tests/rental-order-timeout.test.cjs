const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  RENTAL_PENDING_PAYMENT_TIMEOUT_REASON,
  RentalCoreService
} = require("../apps/api/src/modules/rental-core/rental-core.service");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };
const expiredAt = "2026-09-10T10:00:00.000Z";
const cutoff = "2026-09-11T10:00:00.000Z";

function draftOrder(overrides = {}) {
  return {
    id: "order_timeout_1",
    status: "draft",
    reservations: [{ id: "reservation_1", status: "soft", expiresAt: expiredAt }],
    allocations: [],
    chargeLines: [],
    payableAmount: 100,
    finalPayableAmount: 100,
    adjustmentAmount: 0,
    totalAmount: 100,
    taxRate: 0,
    taxAmount: 0,
    ruleVersion: "rule-1",
    updatedAt: expiredAt,
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
    listExpiredDraftOrderIds: async () => ["order_timeout_1"],
    listExtensions: async () => [],
    saveOrderAggregate: async () => { service.saved = true; }
  };
  return service;
}

void (async () => {
  const order = draftOrder();
  const service = serviceWith(order);
  const ids = await service.listExpiredPendingOrderIds("tenant_1", cutoff, 20);
  assert.deepEqual(ids, ["order_timeout_1"]);
  ok("候选查询只按当前空间的过期待确认订单入口返回 id");

  const expired = await service.expirePendingOrder("tenant_1", order.id, undefined, "系统任务", cutoff);
  assert.equal(expired.status, "cancelled");
  assert.equal(expired.cancellationReason, RENTAL_PENDING_PAYMENT_TIMEOUT_REASON);
  assert.equal(expired.chargeLines.find((row) => row.code === `cancellation_reversal:${order.id}`).amount, -100);
  assert.equal(service.saved, true);
  ok("到期订单在服务端状态机内取消、保留取消核减事实且可重复写回");

  const notYetExpired = draftOrder();
  const notYetExpiredService = serviceWith(notYetExpired);
  await assert.rejects(
    () => notYetExpiredService.expirePendingOrder("tenant_1", notYetExpired.id, undefined, "系统任务", "2026-09-09T10:00:00.000Z"),
    /尚未全部到期/u
  );
  ok("软预占未全部到期时拒绝自动取消");

  const confirmed = draftOrder({ status: "reserved" });
  const confirmedService = serviceWith(confirmed);
  await assert.rejects(
    () => confirmedService.expirePendingOrder("tenant_1", confirmed.id, undefined, "系统任务", cutoff),
    /只有待确认订单/u
  );
  ok("已确认订单不能被误判为待支付超时订单");

  const missingExpiry = draftOrder({ reservations: [{ id: "reservation_1", status: "soft" }] });
  const missingExpiryService = serviceWith(missingExpiry);
  await assert.rejects(
    () => missingExpiryService.expirePendingOrder("tenant_1", missingExpiry.id, undefined, "系统任务", cutoff),
    /尚未全部到期/u
  );
  ok("缺少到期时点的软预占按 fail-closed 处理");

  console.log(`\nRULE-CLOSE-01 待支付超时专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
