const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  computeSecurityAmounts,
  applySecurityReduction
} = require("../apps/api/src/modules/rental-core/rental-security-deposit");

/**
 * RULE-01B 专项：押金与预授权独立计算（需求 4.4.7）。
 *
 * 纯函数用例：押金进实收、预授权是冻结额度，两者算错都直接影响客户资金，
 * 端到端报价只能证明总额，无法定位是「先逐行求和再封顶」还是「每单固定被逐行放大」这类判据错了。
 */

const ok = (message) => console.log(`  PASS  ${message}`);

// 两行商品：A 租金 300 × 2 件，B 租金 100 × 1 件。费率押金/预授权字段刻意不同以便区分取数。
const lines = [
  { groupName: "A", quantity: 2, lineRental: 300, depositUnit: 50, depositMultiple: 0.5, preAuthUnit: 80, preAuthMultiple: 1 },
  { groupName: "B", quantity: 1, lineRental: 100, depositUnit: 30, depositMultiple: 0.5, preAuthUnit: 40, preAuthMultiple: 1 }
];
const rejects = (fn, pattern, label) =>
  assert.throws(fn, (e) => { assert.match(e.message, pattern, `${label}: ${e.message}`); return true; }, label);

// ============ 1. 每件固定：Σ(单价 × 数量)，两笔独立 ============
{
  const r = computeSecurityAmounts(lines, { mode: "fixed" }, { mode: "fixed" });
  // 押金 = 50×2 + 30×1 = 130；预授权 = 80×2 + 40×1 = 200。各自取各自字段。
  assert.equal(r.deposit.amount, 130, "每件固定押金逐行求和");
  assert.equal(r.preauthorization.amount, 200, "每件固定预授权取预授权字段，不串用押金字段");
  ok("每件固定：押金与预授权各按自己的费率字段逐行求和，互不串用");
}

// ============ 2. 行租金倍数：以该行租金为基数 ============
{
  const r = computeSecurityAmounts(lines, { mode: "price_multiple" }, { mode: "price_multiple" });
  // 押金 = 300×0.5 + 100×0.5 = 200；预授权 = 300×1 + 100×1 = 400。以行租金乘，不乘数量再摊。
  assert.equal(r.deposit.amount, 200, "押金倍数以行租金为基数");
  assert.equal(r.preauthorization.amount, 400, "预授权倍数以行租金为基数");
  ok("行租金倍数：以该行日期价格与封顶后的租金为基数");
}

// ============ 3. 每单固定：整单一笔，绝不随行数/数量放大 ============
{
  const r = computeSecurityAmounts(
    lines,
    { mode: "order_fixed", fixedAmount: 500 },
    { mode: "order_fixed", fixedAmount: 800 }
  );
  assert.equal(r.deposit.amount, 500, "每单固定押金 = 规则金额，不乘行数");
  assert.equal(r.preauthorization.amount, 800, "每单固定预授权 = 规则金额，不乘行数");
  // 依据里必须体现「每单固定」而不是逐行，方便回放。
  assert.ok(r.deposit.basis.some((b) => b.includes("每单固定")), "依据说明每单固定");
  ok("每单固定：整单一笔，与行数、数量无关");
}

// ============ 4. 风险附加：按行租金倍数求和后再加订单级风险缓冲 ============
{
  const r = computeSecurityAmounts(
    lines,
    { mode: "none" },
    { mode: "risk_surcharge", riskSurchargeAmount: 250 }
  );
  // 预授权 = (300×1 + 100×1) + 250 = 650。风险附加是加在倍数求和之上的一笔。
  assert.equal(r.preauthorization.amount, 650, "风险附加 = 行倍数求和 + 风险缓冲");
  assert.equal(r.deposit.amount, 0, "押金 none 时为 0，不受预授权影响");
  assert.ok(r.preauthorization.basis.some((b) => b.includes("风险附加 250")), "依据体现风险附加额");
  ok("风险附加：按行租金倍数求和后再加订单级风险缓冲");
}

// ============ 5. 订单上限在逐行求和之后应用（需求 4.4.7） ============
{
  // 每件固定押金本应 130，封顶 100 → 100。封顶必须发生在求和之后，不是逐行封顶。
  const r = computeSecurityAmounts(lines, { mode: "fixed", maxAmount: 100 }, { mode: "fixed", maxAmount: 150 });
  assert.equal(r.deposit.amount, 100, "押金订单上限封顶");
  assert.equal(r.preauthorization.amount, 150, "预授权订单上限封顶");
  assert.ok(r.deposit.basis.some((b) => b.includes("订单上限封顶")), "依据体现封顶");
  // 上限高于求和时不改变金额。
  const loose = computeSecurityAmounts(lines, { mode: "fixed", maxAmount: 999 }, { mode: "none" });
  assert.equal(loose.deposit.amount, 130, "上限高于求和时不生效");
  ok("订单上限在逐行求和之后应用，高于求和时不生效");
}

// ============ 6. 押金与预授权同时存在，各自独立 ============
{
  const r = computeSecurityAmounts(
    lines,
    { mode: "fixed" },
    { mode: "price_multiple" }
  );
  assert.equal(r.deposit.amount, 130, "押金按每件固定");
  assert.equal(r.preauthorization.amount, 400, "预授权按行倍数");
  ok("押金与预授权可同时非零且各按自己的模式独立计算");
}

// ============ 7. none 一律为 0 且无依据 ============
{
  const r = computeSecurityAmounts(lines, { mode: "none" }, { mode: "none" });
  assert.equal(r.deposit.amount, 0);
  assert.equal(r.preauthorization.amount, 0);
  assert.equal(r.deposit.basis.length, 0, "none 不产生依据");
  ok("免押/不需要预授权时金额为 0 且无依据");
}

// ============ 8. 减免：只接受服务端算好的目标额，不能升高、不能为负 ============
{
  assert.equal(
    applySecurityReduction(500, { instrument: "deposit", type: "member_benefit", factReference: "vip", reducedTo: 200, reason: "金卡会员免半" }),
    200,
    "减免到合法目标额"
  );
  rejects(
    () => applySecurityReduction(500, { instrument: "deposit", type: "manual_approval", factReference: "APR-1", reducedTo: 600, reason: "x" }),
    /只能调低/u,
    "减免不能高于原额"
  );
  rejects(
    () => applySecurityReduction(500, { instrument: "deposit", type: "manual_approval", factReference: "APR-1", reducedTo: -1, reason: "x" }),
    /不能为负/u,
    "减免不能为负"
  );
  ok("减免只能调低到服务端算出的目标额，不能升高或为负");
}

console.log("\nAll security-deposit assertions passed.");
