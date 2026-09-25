const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// Codex review #9：归还计费与续租生效之间有一段时间窗。
//
// 修复前逾期费与提前归还退款全部在控制器**事务外**按 `getOrder` 的快照算好，再传进
// createInspection；而订单行的锁要到服务内部的 lockedOrder 才加上。期间一笔续租生效，
// 归还就按旧的约定归还时间判逾期——刚续上的单被多收一笔，退款也按错的租金基数算。
//
// 修复后计费搬进事务内、锁单之后重取（returnCharges）。这里用「事务外快照与锁内订单
// 不一致」的入参确定性地验证：计费必须采信锁内的值，不能采信快照。
const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

const STALE_END = "2026-09-02T00:00:00.000Z";
const EXTENDED_END = "2026-09-05T00:00:00.000Z";

const orderAt = (effectiveEndAt, allocations) => ({
  id: "order_1", quoteId: "quote_1", endAt: STALE_END, effectiveEndAt,
  fulfillmentLocationId: "loc_1", fulfillmentMode: "self_pickup",
  lines: [{ id: "line_1", itemGroupId: "group_q" }],
  allocations,
  chargeLines: [{ type: "extension", amount: 300 }]
});

/** 事务外快照仍是旧租期与旧未归还数量；锁内订单已经被并发动作改过。 */
const STALE = () => orderAt(STALE_END, [{ orderLineId: "line_1", itemGroupId: "group_q", quantity: 2, status: "picked_up" }]);
const LOCKED = () => orderAt(EXTENDED_END, [
  { id: "alloc_1", orderLineId: "line_1", itemGroupId: "group_q", quantity: 1, status: "picked_up" },
  { id: "alloc_2", orderLineId: "line_1", itemGroupId: "group_q", quantity: 1, status: "returned" }
]);

const TEMPLATE = { id: "tpl_return", stage: "return" };

function controller({ locked = LOCKED, extensions = [] } = {}) {
  const seen = { overdue: [], earlyReturn: [], lockedFor: [] };
  const instance = Object.create(RentalCoreController.prototype);
  instance.context = () => ({ profile: {}, category: {}, settings: {} });
  instance.committed = (_tenantId, value) => value;
  instance.emitOrderEvent = async () => {};
  instance.serviceCapacities = { settleReturnForOrder: async () => {} };
  instance.funding = { assertReadyForPickup: async () => {} };
  instance.service = {
    getOrder: async () => STALE(),
    listInspectionTemplates: () => [TEMPLATE],
    resolveWorkspaceId: () => "ws_1",
    listInspections: async () => [],
    listOrderExtensions: async (_tenantId, orderId) => { seen.lockedFor.push(`extensions:${orderId}`); return extensions; },
    lockOrderForUpdate: async (_tenantId, orderId) => { seen.lockedFor.push(`lock:${orderId}`); return locked(); },
    createInspection: async (_tenantId, _orderId, _body, _user, charges) => {
      seen.charges = charges;
      return { inspection: { stage: "return" }, order: locked() };
    },
    completeHandoverWithoutInspection: async (_tenantId, _orderId, _stage, overdueCharge, _tx, _user, earlyReturn) => {
      seen.handover = { overdueCharge, earlyReturn };
      return locked();
    }
  };
  instance.business = {
    getQuote: () => ({ id: "quote_1" }),
    calculateOverdueCharge: (_tenantId, _context, _quote, returnedAt, dueAt, outstanding) => {
      seen.overdue.push({ returnedAt, dueAt, outstanding });
      return dueAt === EXTENDED_END ? 0 : 20;
    },
    calculateEarlyReturnRefund: (_tenantId, _context, _quote, dueAt, returnedAt, extensionRental, extensionPricing) => {
      seen.earlyReturn.push({ dueAt, returnedAt, extensionRental, extensionPricing });
      return { amount: 0, requiresReview: false, basis: [] };
    },
    assertPickupOpenAt: async () => {},
    refreshFromDatabase: async () => {}
  };
  instance.idempotent = {
    executeWithReplayFlag: async (args) => ({ result: await args.run({}), replayed: false })
  };
  return { instance, seen };
}

const req = () => ({ user: { tenantId: "tenant_1", displayName: "运营" }, headers: { "idempotency-key": "key-1" } });

void (async () => {

/* ---------- 逾期基准必须取锁内订单 ---------- */

{
  const { instance, seen } = controller();
  await instance.createInspection(req(), "order_1", { templateId: TEMPLATE.id, results: {} });
  assert.equal(seen.overdue.length, 1, "整单归还必须算一次逾期费");
  assert.equal(seen.overdue[0].dueAt, EXTENDED_END,
    "逾期基准必须是锁内订单的 effectiveEndAt——用事务外快照就会把刚续上的单判成逾期");
  assert.equal(seen.charges.overdue.amount, 0, "按新租期算出来不逾期，就不能落一笔逾期费");
  ok("逾期费按锁内的约定归还时间算——修复前取事务外快照，续租刚生效的单会被多收");
}

/* ---------- 未归还数量也取锁内订单 ---------- */

{
  const { instance, seen } = controller();
  await instance.createInspection(req(), "order_1", { templateId: TEMPLATE.id, results: {} });
  assert.deepEqual(seen.overdue[0].outstanding, { group_q: 1 },
    "并发分批归还已经交回一件，逾期费只能按仍在占用的一件算");
  ok("未归还数量取锁内订单，已被并发归还的部分不再收逾期费");
}

/* ---------- 已生效续租的报价快照在锁内重查 ---------- */

{
  const snapshot = { rentalAmount: 300 };
  const { instance, seen } = controller({ extensions: [{ status: "effective", pricingSnapshot: snapshot }] });
  await instance.createInspection(req(), "order_1", { templateId: TEMPLATE.id, results: {} });
  assert.equal(seen.earlyReturn[0].extensionPricing, snapshot, "提前归还退款要按锁内重查到的续租报价算");
  assert.equal(seen.earlyReturn[0].dueAt, EXTENDED_END, "退款基准同样是锁内的约定归还时间");
  assert.ok(seen.lockedFor.indexOf("lock:order_1") < seen.lockedFor.indexOf("extensions:order_1"),
    "必须先锁订单行再查续租，否则查到的仍可能是半路的状态");
  ok("续租报价快照在锁内重查，且查询发生在锁之后");
}

/* ---------- 分批归还按本批数量计算逾时，领取阶段不算归还费用 ---------- */

{
  const { instance, seen } = controller();
  await instance.createInspection(req(), "order_1", {
    templateId: TEMPLATE.id, results: {}, returnItems: [{ allocationId: "alloc_1", quantity: 1 }], returnBatchNo: "key-1"
  });
  assert.equal(seen.overdue.length, 1, "逐批归还必须按本批实际归还数量计算逾期");
  assert.deepEqual(seen.overdue[0].outstanding, { group_q: 1 }, "逾时计费范围必须只包含本批归还数量");
  assert.equal(seen.charges.overdue.amount, 0, "按新租期算出来不逾期，就不能落一笔逾期费");
  assert.ok(seen.lockedFor.indexOf("lock:order_1") >= 0, "逐批归还计费必须使用锁内订单事实");
  ok("分批归还按本批数量锁内计算逾时，不把费用拖到最后一批");
}

/* ---------- 无检查直接交接的归还走同一条重算路径 ---------- */

{
  // handover 是第二个归还入口，形状与归还检查完全一样，此前也是事务外算好再进事务。
  const { instance, seen } = controller();
  await instance.handover(req(), "order_1", "return");
  assert.equal(seen.overdue.length, 1, "无检查归还同样要算逾期费");
  assert.equal(seen.overdue[0].dueAt, EXTENDED_END, "基准同样必须取锁内订单");
  assert.deepEqual(seen.overdue[0].outstanding, { group_q: 1 }, "未归还数量同样取锁内订单");
  assert.equal(seen.handover.overdueCharge, 0, "按新租期不逾期，传给服务的逾期费必须是 0");
  ok("无检查直接交接的归还入口走同一条锁内重算路径，不是只修了归还检查那一条");
}

/* ---------- 领取阶段不做归还计费 ---------- */

{
  const { instance, seen } = controller();
  await instance.handover(req(), "order_1", "pickup");
  assert.equal(seen.overdue.length, 0, "领取阶段没有归还费用可算");
  assert.equal(seen.lockedFor.length, 0, "领取阶段不该为归还计费额外锁一次订单");
  ok("领取阶段不触发归还计费，也不做多余的锁");
}

console.log(`\n归还计费并发时间窗专项：${passed} 项全部通过`);

})();
