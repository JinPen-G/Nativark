const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  deriveFundingLedgers,
  nextBalanceAfter,
  assertActionApplies,
  rentalPaymentBalance,
  aggregatePendingExtensionFunding
} = require("../apps/api/src/modules/rental-core/rental-funding-events");

/**
 * RULE-01B 专项：模拟资金事件的余额推导与动作合法性（需求 4.4.7 line 527、4.6.3）。
 *
 * 纯函数用例：押金/预授权余额算错、或允许了不该允许的动作（把已释放的预授权又转扣一次、
 * 退款超过持有额）都直接造成资金差错，必须能脱库逐条回放。
 */

const ok = (message) => console.log(`  PASS  ${message}`);
const ev = (instrument, action, amount) => ({ instrument, action, amount });
const rejects = (fn, pattern, label) =>
  assert.throws(fn, (e) => { assert.match(e.message, pattern, `${label}: ${e.message}`); return true; }, label);

// ============ 1. 押金余额 = 收取 − 抵扣 − 退款 ============
{
  const ledgers = deriveFundingLedgers([
    ev("deposit", "initiate", 500),
    ev("deposit", "append", 100),
    ev("deposit", "capture", 200),
    ev("deposit", "refund", 150),
    ev("deposit", "fail", 999) // 失败不进余额
  ]);
  assert.equal(ledgers.deposit.collected, 600, "收取 = initiate + append");
  assert.equal(ledgers.deposit.captured, 200);
  assert.equal(ledgers.deposit.refunded, 150);
  assert.equal(ledgers.deposit.balance, 250, "押金余额 = 600 − 200 − 150");
  ok("押金余额 = 收取 − 抵扣 − 退款，失败事件不改变余额");
}

// ============ 2. 预授权余额 = 冻结 − 转扣 − 释放 ============
{
  const ledgers = deriveFundingLedgers([
    ev("preauthorization", "initiate", 2000),
    ev("preauthorization", "append", 500),
    ev("preauthorization", "capture", 300),
    ev("preauthorization", "release", 700)
  ]);
  assert.equal(ledgers.preauthorization.frozen, 2500);
  assert.equal(ledgers.preauthorization.captured, 300);
  assert.equal(ledgers.preauthorization.released, 700);
  assert.equal(ledgers.preauthorization.balance, 1500, "预授权余额 = 2500 − 300 − 700");
  // 押金与预授权互不串账。
  assert.equal(ledgers.deposit.balance, 0, "两条账独立，预授权事件不进押金账");
  ok("预授权余额 = 冻结 − 转扣 − 释放，与押金账独立");
}

// ============ 3. 动作适用矩阵：押金不能释放，预授权不能退款 ============
{
  rejects(() => assertActionApplies("deposit", "release"), /押金不支持 release/u, "押金不能释放");
  rejects(() => assertActionApplies("preauthorization", "refund"), /预授权不支持 refund/u, "预授权不能退款");
  assert.doesNotThrow(() => assertActionApplies("deposit", "refund"), "押金可退款");
  assert.doesNotThrow(() => assertActionApplies("preauthorization", "release"), "预授权可释放");
  ok("押金只能收取/抵扣/退款/失败，预授权只能冻结/追加/转扣/释放/失败");
}

// ============ 4. 不能重复发起；追加需先发起 ============
{
  const empty = deriveFundingLedgers([]);
  assert.equal(nextBalanceAfter("deposit", "initiate", 500, empty), 500, "首次发起");
  rejects(() => nextBalanceAfter("deposit", "append", 100, empty), /尚未发起/u, "未发起不能追加");
  const initiated = deriveFundingLedgers([ev("deposit", "initiate", 500)]);
  rejects(() => nextBalanceAfter("deposit", "initiate", 100, initiated), /已发起/u, "不能重复发起");
  assert.equal(nextBalanceAfter("deposit", "append", 100, initiated), 600, "追加叠加到余额");
  ok("同订单同 instrument 不能重复发起，追加必须先发起");
}

// ============ 5. 抵扣/退款/释放不得超过当前余额 ============
{
  const dep = deriveFundingLedgers([ev("deposit", "initiate", 300)]);
  rejects(() => nextBalanceAfter("deposit", "capture", 400, dep), /超过当前押金余额/u, "抵扣不能超额");
  rejects(() => nextBalanceAfter("deposit", "refund", 400, dep), /超过当前押金余额/u, "退款不能超额");
  assert.equal(nextBalanceAfter("deposit", "capture", 300, dep), 0, "抵扣全部余额到 0");
  const pre = deriveFundingLedgers([ev("preauthorization", "initiate", 1000)]);
  rejects(() => nextBalanceAfter("preauthorization", "release", 1200, pre), /超过当前预授权余额/u, "释放不能超额");
  assert.equal(nextBalanceAfter("preauthorization", "release", 1000, pre), 0, "释放全部冻结");
  ok("抵扣/退款/释放金额不得超过当前余额，绝不产出负余额");
}

// ============ 6. 金额必须为正；失败不校验金额、不动余额 ============
{
  const dep = deriveFundingLedgers([ev("deposit", "initiate", 300)]);
  rejects(() => nextBalanceAfter("deposit", "capture", 0, dep), /必须为正/u, "金额必须为正");
  rejects(() => nextBalanceAfter("deposit", "capture", -5, dep), /必须为正/u, "金额不能为负");
  assert.equal(nextBalanceAfter("deposit", "fail", 0, dep), 300, "失败不动余额");
  ok("非失败动作金额必须为正；失败事件金额不校验且不改变余额");
}

// ============ 7. 租金应收、退款与保证金抵扣是独立结算事实 ============
{
  const events = [
    ev("rental", "append", 800),
    ev("rental", "refund", 50),
    ev("deposit", "initiate", 300),
    ev("deposit", "capture", 200)
  ];
  const payment = rentalPaymentBalance(1000, events);
  assert.equal(payment.collected, 800);
  assert.equal(payment.refunded, 50);
  assert.equal(payment.securityCaptured, 200);
  assert.equal(payment.balance, 50, "应收 1000 - 已收 800 + 已退 50 - 已抵扣 200 = 待收 50");
  assert.doesNotThrow(() => assertActionApplies("rental", "append"));
  rejects(() => assertActionApplies("rental", "capture"), /租金与费用不支持 capture/u, "租金不能伪装成保证金抵扣");
  ok("租金收付款与保证金独立结算，退款不会被当作已结清");
}

// ============ 8. 待补款续租的三类资金要求分别汇总 ============
{
  const pending = aggregatePendingExtensionFunding([
    { payableAmount: 120, depositDelta: 80, preAuthDelta: 0 },
    { payableAmount: 30, depositDelta: 0, preAuthDelta: 200 }
  ]);
  assert.deepEqual(pending, { payableAmount: 150, depositAmount: 80, preauthorizationAmount: 200 });
  assert.deepEqual(aggregatePendingExtensionFunding([]), { payableAmount: 0, depositAmount: 0, preauthorizationAmount: 0 });
  ok("待补款续租分别汇总租金、押金和预授权增量，空集合为零");
}

console.log("\nAll funding-events assertions passed.");
