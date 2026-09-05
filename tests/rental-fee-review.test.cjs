const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// Codex review #5：选择「人工审核计费/退款」时必须形成可追踪的待审事项。
//
// 修复前：逾期的 manual_review 由计算侧直接返回 0，提前归还的 requiresReview 在落账
// 侧被直接 return——两条都是静默免除，运营侧连一条待办都没有，订单还能照常结清。
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalCoreOrderStatus } = require("@store-rental/shared");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

/** 只跑费用审核相关方法的服务实例：其余依赖用最小桩。 */
function service() {
  const instance = Object.create(RentalCoreService.prototype);
  const saved = [];
  instance.factStore = {
    saveOrderAggregate: async (order) => { saved.push(structuredClone(order)); },
    listExtensions: async () => []
  };
  instance.lockedOrder = async () => instance.__order;
  instance.runHook = async () => {};
  instance.orderHookInstances = () => [];
  return { instance, saved };
}

function order(overrides = {}) {
  return {
    id: "order_1", tenantId: "tenant_1", ruleVersion: "v1",
    status: RentalCoreOrderStatus.Settling,
    payableAmount: 1000, finalPayableAmount: 1000, adjustmentAmount: 0, totalAmount: 1000,
    taxRate: 0, taxAmount: 0,
    chargeLines: [{ code: "rental", name: "租金", type: "rental", amount: 1000 }],
    allocations: [], reservations: [], lines: [],
    ruleSnapshot: { overdue: { graceMinutes: 30, feeMode: "manual_review", feeMultiplier: 1 } },
    ...overrides
  };
}

void (async () => {

/* ---------- 逾期 manual_review：挂待审单而不是静默免除 ---------- */

{
  const { instance } = service();
  const row = order();
  instance.applyOverdueTo(row, 120, "2026-09-05T10:00:00.000Z");
  assert.equal(row.feeReviews?.length, 1, "必须留下一条待审记录");
  const review = row.feeReviews[0];
  assert.equal(review.type, "overdue");
  assert.equal(review.status, "pending");
  assert.equal(review.suggestedAmount, 120, "建议金额必须是规则算出来的那个数");
  assert.ok(review.basis.some((line) => line.includes("manual_review")), "依据里要写清是哪种规则模式");
  assert.equal(row.finalPayableAmount, 1000, "未裁定前不得改动应付");
  assert.equal(row.chargeLines.length, 1, "未裁定前不得产生费用明细");
  ok("逾期 manual_review 挂出待审单，金额与依据都在，但不动账");
}

/* ---------- 非 manual_review 仍直接落账 ---------- */

{
  const { instance } = service();
  const row = order({ ruleSnapshot: { overdue: { graceMinutes: 30, feeMode: "hourly", feeMultiplier: 1 } } });
  instance.applyOverdueTo(row, 120, "2026-09-05T10:00:00.000Z");
  assert.equal(row.feeReviews, undefined, "自动计费不该产生待审单");
  assert.equal(row.finalPayableAmount, 1120);
  ok("feeMode=hourly 时仍直接落账，行为不变");
}

/* ---------- 提前归还 requiresReview：挂待审单而不是丢弃 ---------- */

{
  const { instance } = service();
  const row = order();
  instance.applyEarlyReturnRefundTo(row, { amount: 300, requiresReview: true, basis: ["提前 48 小时归还"] });
  assert.equal(row.feeReviews.length, 1);
  assert.equal(row.feeReviews[0].type, "early_return_refund");
  assert.equal(row.feeReviews[0].suggestedAmount, 300);
  assert.equal(row.finalPayableAmount, 1000, "退款未裁定前不得冲减应收");
  ok("提前归还需审核时挂出待审单，修复前这里直接 return、退款连记录都不留");
}

/* ---------- 同类只保留一张待审单 ---------- */

{
  const { instance } = service();
  const row = order();
  instance.applyOverdueTo(row, 120, "2026-09-05T10:00:00.000Z");
  instance.applyOverdueTo(row, 150, "2026-09-05T12:00:00.000Z");
  assert.equal(row.feeReviews.length, 1, "重复提交不该堆出多条待办");
  assert.equal(row.feeReviews[0].suggestedAmount, 150, "后一次的金额覆盖前一次");
  ok("同类型只保留一张待审单，重复归还提交不堆待办");
}

/* ---------- 裁定：批准落账、驳回不落账、认定额不得超过建议额 ---------- */

{
  const { instance } = service();
  const row = order();
  instance.applyOverdueTo(row, 120, "2026-09-05T10:00:00.000Z");
  instance.__order = row;
  const reviewId = row.feeReviews[0].id;

  await assert.rejects(
    () => instance.reviewOrderFeeReview("tenant_1", "order_1", reviewId, { decision: "approved", reason: "催收结果", amount: 200 }, "结算员", {}),
    /不能超过规则建议的 120/u,
    "认定金额高于建议额必须拒绝"
  );
  await assert.rejects(
    () => instance.reviewOrderFeeReview("tenant_1", "order_1", reviewId, { decision: "approved", reason: "  " }, "结算员", {}),
    /请填写审核原因/u
  );
  ok("认定金额不得超过建议额，原因必填");

  const after = await instance.reviewOrderFeeReview("tenant_1", "order_1", reviewId, { decision: "approved", reason: "客户已承诺支付", amount: 80 }, "结算员", {});
  assert.equal(after.feeReviews[0].status, "approved");
  assert.equal(after.feeReviews[0].decidedAmount, 80);
  assert.equal(after.feeReviews[0].reviewedBy, "结算员");
  assert.equal(after.finalPayableAmount, 1080, "按认定额落账，不是建议额");
  assert.ok(after.chargeLines.some((line) => line.type === "overdue" && line.amount === 80));
  ok("批准后按认定额落账，审核人与结论一并留痕");

  await assert.rejects(
    () => instance.reviewOrderFeeReview("tenant_1", "order_1", reviewId, { decision: "approved", reason: "重复" }, "结算员", {}),
    /不存在或已处理/u,
    "同一张单不能裁定两次"
  );
  ok("已裁定的单不能重复处理");
}

{
  const { instance } = service();
  const row = order();
  instance.applyEarlyReturnRefundTo(row, { amount: 300, requiresReview: true, basis: ["提前归还"] });
  instance.__order = row;
  const rejected = await instance.reviewOrderFeeReview("tenant_1", "order_1", row.feeReviews[0].id, { decision: "rejected", reason: "不符合退款条件" }, "结算员", {});
  assert.equal(rejected.feeReviews[0].status, "rejected");
  assert.equal(rejected.finalPayableAmount, 1000, "驳回不产生任何金额");
  assert.equal(rejected.chargeLines.length, 1);
  ok("驳回只记录结论，不产生金额");
}

/* ---------- 未裁定不许结清 ---------- */

{
  const { instance } = service();
  const row = order();
  instance.applyOverdueTo(row, 120, "2026-09-05T10:00:00.000Z");
  instance.__order = row;
  await assert.rejects(
    () => instance.settleOrder("tenant_1", "order_1", {}, "结算员"),
    /还有费用审核单待处理/u,
    "有待审单时必须拒绝关单——这是「人工审核」唯一能兑现的地方"
  );
  ok("待审单未处理时拒绝结清");

  await instance.reviewOrderFeeReview("tenant_1", "order_1", row.feeReviews[0].id, { decision: "rejected", reason: "减免" }, "结算员", {});
  const closed = await instance.settleOrder("tenant_1", "order_1", {}, "结算员");
  assert.equal(closed.status, RentalCoreOrderStatus.Completed);
  ok("裁定完成后可以正常结清");
}

console.log(`\n费用审核单专项：${passed} 项全部通过`);

})().catch((error) => { console.error(error); process.exitCode = 1; });
