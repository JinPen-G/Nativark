const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// 需求 4.6.8：提前归还退款的折算口径。三条不可动摇的语义在这里逐条钉住：
// 缺省不退、不足提前门槛不退、阶梯档不重算（按未使用占比折算）、基数是净租金。
const { computeEarlyReturnRefund } = require("../apps/api/src/modules/rental-core/rental-early-return");
const { effectiveEarlyReturnRule, effectiveExtensionRule } = require("../apps/api/src/modules/rental-core/rental-rule-defaults");

let passed = 0;
const ok = (message) => {
  passed += 1;
  console.log(`  PASS  ${message}`);
};

const rule = (overrides = {}) => ({
  mode: "auto",
  minAdvanceHours: 24,
  refundPercent: 70,
  refundUndeliveredServices: false,
  ...overrides
});

// 租 7 天命中 80/天档 = 560；第 4 天归还，未使用 3 天。
const ctx = (overrides = {}) => ({
  scheduledEndAt: "2026-09-08T10:00:00.000Z",
  returnedAt: "2026-09-05T10:00:00.000Z",
  totalUnits: 7,
  unusedUnits: 3,
  rentalAmount: 560,
  rentalDiscountAmount: 0,
  rentalCouponAmount: 0,
  ...overrides
});

/* ---------- 缺省行为：规则整组缺省或 none 时一分不退 ---------- */

assert.equal(computeEarlyReturnRefund(undefined, ctx()).amount, 0);
ok("规则整组缺省时不退租金（需求 4.6.8「第一阶段默认不自动退租金」）");

assert.equal(computeEarlyReturnRefund(rule({ mode: "none" }), ctx()).amount, 0);
ok("mode=none 时不退租金，与今天的行为一致");

assert.deepEqual(effectiveEarlyReturnRule({}).mode, "none");
ok("默认规则解析出的 mode 是 none，新增字段不会让存量空间开始退钱");

assert.equal(effectiveExtensionRule({}).enabled, true);
assert.equal(effectiveExtensionRule({}).forceImmediateWhenOverdue, true);
ok("续租规则缺省为「允许续租、逾期强制先付」");

/* ---------- 提前时长门槛 ---------- */

const tooLate = computeEarlyReturnRefund(rule(), ctx({ returnedAt: "2026-09-07T20:00:00.000Z" }));
assert.equal(tooLate.amount, 0);
assert.match(tooLate.basis.join(""), /未达规则要求的 24 小时/);
ok("提前不足 24 小时不退，且说明里写清差多少（汽车门市「提前一天内不退」）");

assert.equal(computeEarlyReturnRefund(rule(), ctx({ returnedAt: "2026-09-08T10:00:00.000Z" })).amount, 0);
ok("按时归还不是提前归还，不产生退款");

assert.equal(computeEarlyReturnRefund(rule(), ctx({ returnedAt: "2026-09-09T10:00:00.000Z" })).amount, 0);
ok("逾期归还不进这条路径，逾期费用有自己的规则");

/* ---------- 折算口径：阶梯不重算 ---------- */

const proportional = computeEarlyReturnRefund(rule(), ctx());
assert.equal(proportional.rentalRefund, 168);
assert.equal(proportional.amount, 168);
ok("按未使用占比折算：560 × 3/7 × 70% = 168，不因只用 3 天掉回高价档");

// 若按实际 3 天用原费率重算，会命中 100/天档得 300，差额 260 × 70% = 182 ≠ 168。
assert.notEqual(proportional.rentalRefund, 182);
ok("退款不等于「按实际租期重算的差额」——阶梯档不重算是刻意的");

/* ---------- 基数是净租金，不是毛租金 ---------- */

const discounted = computeEarlyReturnRefund(rule(), ctx({ rentalDiscountAmount: 60, rentalCouponAmount: 40 }));
assert.equal(discounted.rentalRefund, 138);
ok("净租金 460（560 − 60 − 40）× 3/7 × 70% = 138，不退客户没付过的钱");

const overDiscounted = computeEarlyReturnRefund(rule(), ctx({ rentalDiscountAmount: 600 }));
assert.equal(overDiscounted.rentalRefund, 0);
ok("优惠大于租金时净租金夹到 0，不会算出负退款");

/* ---------- 占比夹取与封顶 ---------- */

assert.equal(computeEarlyReturnRefund(rule(), ctx({ unusedUnits: 99 })).rentalRefund, 392);
ok("未使用单位数异常大时占比夹到 1（560 × 70% = 392），不会超额退款");

assert.equal(computeEarlyReturnRefund(rule(), ctx({ totalUnits: 0 })).rentalRefund, 0);
ok("总单位数为 0 时占比按 0 处理，不做除零");

assert.equal(computeEarlyReturnRefund(rule({ maxRefundAmount: 100 }), ctx()).amount, 100);
ok("退款上限封顶生效");

/* ---------- 未发生的服务费 ---------- */

const services = [
  { occurrenceId: "delivery", serviceName: "送车上门", amount: 80, quantity: 1, executionStatus: "not_started", scheduledStartAt: "2026-09-07T09:00:00.000Z" },
  { occurrenceId: "cleaning", serviceName: "取车清洗", amount: 50, quantity: 1, executionStatus: "completed", executedQuantity: 1, scheduledStartAt: "2026-09-03T09:00:00.000Z" }
];
const withServices = computeEarlyReturnRefund(rule({ refundUndeliveredServices: true }), ctx({ services }));
assert.equal(withServices.serviceRefund, 80);
assert.equal(withServices.amount, 248);
ok("按原实际服务状态只退未执行净额（80），已执行的 50 不退");

assert.equal(computeEarlyReturnRefund(rule(), ctx({ services })).serviceRefund, 0);
ok("未打开「退未发生的服务费」时服务费一律不退");

// 早于 scheduledStartAt 引入的历史快照缺这个字段：`NaN < returnedMs` 是 false，
// 只判前者会把「时间读不出来」当成「未发生」而退钱。说不清是否履行过的服务不退。
const undated = computeEarlyReturnRefund(
  rule({ refundUndeliveredServices: true }),
  ctx({ services: [{ serviceName: "历史快照服务", amount: 80 }] })
);
assert.equal(undated.serviceRefund, null);
assert.equal(undated.amount, null);
assert.equal(undated.requiresReview, true);
assert.equal(undated.maximumAmount, 248);
ok("历史服务缺少实际履约依据进入未知审核，不把计划时间或缺失当成未发生");

/* ---------- 人工审批 ---------- */

const review = computeEarlyReturnRefund(rule({ mode: "manual_review" }), ctx());
assert.equal(review.amount, 168);
assert.equal(review.requiresReview, true);
ok("manual_review 仍算出金额但标记待审批，落账由服务层拦住");

for (const status of ["completed", "cancelled", "failed", "no_show"]) {
  const row = { ...services[0], executionStatus: status, executedQuantity: status === "completed" ? 1 : 0,
    refundStatus: status === "completed" ? "none" : "included_in_order_change" };
  assert.equal(computeEarlyReturnRefund(rule({ refundUndeliveredServices: true }), ctx({ services: [row] })).serviceRefund, 0);
}
const actuallyDoneEarly = computeEarlyReturnRefund(rule({ refundUndeliveredServices: true }), ctx({ services: [{ ...services[0],
  executionStatus: "completed", executedQuantity: 1 }] }));
assert.equal(actuallyDoneEarly.serviceRefund, 0, "future plan does not override actual completion");
const unstartedPastPlan = computeEarlyReturnRefund(rule({ refundUndeliveredServices: true }), ctx({ services: [{ ...services[0],
  scheduledStartAt: "2026-09-01T00:00:00Z" }] }));
assert.equal(unstartedPastPlan.serviceRefund, 80, "past plan does not prove actual service performed");
ok("已执行或已有原核减的服务不重复退款，计划时点不能代替实际履约");

console.log(`\n提前归还退款专项：${passed} 项全部通过`);
