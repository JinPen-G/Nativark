const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

function instance() {
  const svc = Object.create(RentalBusinessService.prototype);
  // Object.create 不跑构造器字段初始化，这两处是 withOrderChargeSnapshot 依赖的实例态。
  svc.warnedMissingOrderSnapshot = new Set();
  svc.logger = { warn() {} };
  return svc;
}

// 固定报价夹具：规则/费率/请求都齐备，供两条路径复算。
function quote() {
  return {
    id: "quote_1",
    request: { startAt: "2026-09-10T09:00:00.000Z", endAt: "2026-09-11T09:00:00.000Z", lines: [] },
    payableAmount: 100,
    rentalAmount: 100,
    chargeLines: [],
    rateSnapshot: [{ unit: "usage", itemGroupId: "grp-1", minimumUnits: 1 }],
    ruleSnapshot: {
      cancellation: { freeBeforeHours: 24, lateFeeType: "percentage", lateFeeValue: 20 },
      overdue: { graceMinutes: 30, feeMode: "multiplier", feeMultiplier: 1 }
    },
    discountEvaluations: [],
    membershipBenefitEvaluations: [],
    serviceSnapshots: []
  };
}

const context = { settings: { calendar: { timeZone: "Asia/Shanghai" } }, groups: [], pricingGroups: [] };

void (async () => {
  /* ---------- 取消费：订单快照路径 == 旧报价路径 ---------- */
  {
    const svc = instance();
    const nowAt = "2026-09-10T09:00:00.000Z"; // 起租前 0 小时 < freeBeforeHours=24 → 计费
    const viaQuote = svc.calculateCancellationCharge("t1", context, quote(), nowAt, false);
    const viaOrder = svc.calculateCancellationCharge("t1", context, quote(), nowAt, false, { ruleSnapshot: quote().ruleSnapshot });
    assert.equal(viaQuote, 20, "20% × 100 = 20");
    assert.equal(viaOrder, viaQuote, "订单快照路径与报价路径结果一致");
    ok("取消费：传入订单规则快照与旧报价路径逐分一致");
  }

  /* ---------- 取消费：订单规则快照真正生效（不同于报价则以订单为准） ---------- */
  {
    const svc = instance();
    const nowAt = "2026-09-10T09:00:00.000Z";
    const orderRule = { cancellation: { freeBeforeHours: 24, lateFeeType: "percentage", lateFeeValue: 50 } };
    const viaOrder = svc.calculateCancellationCharge("t1", context, quote(), nowAt, false, { ruleSnapshot: orderRule });
    assert.equal(viaOrder, 50, "以订单冻结规则的 50% 计费，而非报价的 20%");
    ok("订单规则快照覆盖报价规则：复算权威口径是订单快照");
  }

  /* ---------- 逾期费：订单快照路径 == 旧报价路径 ---------- */
  {
    const svc = instance();
    const returnedAt = "2026-09-11T11:00:00.000Z"; // 超过 dueAt + 30 分钟宽限
    const dueAt = "2026-09-11T09:00:00.000Z";
    const viaQuote = svc.calculateOverdueCharge("t1", context, quote(), returnedAt, dueAt);
    const viaOrder = svc.calculateOverdueCharge("t1", context, quote(), returnedAt, dueAt, undefined, { ruleSnapshot: quote().ruleSnapshot });
    assert.equal(viaQuote, 100, "multiplier 模式：rentalAmount 100 × 1 = 100");
    assert.equal(viaOrder, viaQuote, "订单快照路径与报价路径逾期费一致");
    ok("逾期费：传入订单规则快照与旧报价路径逐分一致");
  }

  /* ---------- 提前归还退款：订单快照路径 == 旧报价路径（纯使用量计价不退） ---------- */
  {
    const svc = instance();
    const scheduledEndAt = "2026-09-11T09:00:00.000Z";
    const returnedAt = "2026-09-10T21:00:00.000Z";
    const viaQuote = svc.calculateEarlyReturnRefund("t1", context, quote(), scheduledEndAt, returnedAt);
    const viaOrder = svc.calculateEarlyReturnRefund("t1", context, quote(), scheduledEndAt, returnedAt, 0, undefined, { ruleSnapshot: quote().ruleSnapshot });
    assert.deepEqual(viaOrder, viaQuote, "订单快照路径与报价路径退款结果一致");
    assert.equal(viaOrder.amount, 0, "整单按使用量计价不做时间折算退款");
    ok("提前归还退款：订单快照路径与旧报价路径结果一致");
  }

  console.log(`\n归还/取消计费订单快照口径一致性专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
