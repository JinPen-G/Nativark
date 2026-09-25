const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  computeSecurityAmounts,
  applySecurityReduction,
  validateSecurityRules,
  validateSecurityRateCoverage,
  applyPricingGroupSecurityRateOverrides
} = require("../apps/api/src/modules/rental-core/rental-security-deposit");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");

/**
 * RULE-01B 专项：押金与预授权独立计算（需求 4.4.7）。
 *
 * 纯函数用例：押金进实收、预授权是冻结额度，两者算错都直接影响客户资金，
 * 端到端报价只能证明总额，无法定位是「先逐行求和再封顶」还是「每单固定被逐行放大」这类判据错了。
 */

const ok = (message) => console.log(`  PASS  ${message}`);

// ============ 0. 资金费率覆盖：各计价单位齐全、只改本分组且不改基本租金 ============
{
  const rates = [
    { id: "g1-day", pricingGroupId: "group-1", itemGroupId: "group-1", itemGroupName: "标准组", unit: "calendar_day", baseAmount: 100, depositAmount: 0, preAuthAmount: 0 },
    { id: "g1-hour", pricingGroupId: "group-1", itemGroupId: "group-1", itemGroupName: "标准组", unit: "hour", baseAmount: 20, depositAmount: 0, preAuthAmount: 0 },
    { id: "g2-day", pricingGroupId: "group-2", itemGroupId: "group-2", itemGroupName: "其他组", unit: "calendar_day", baseAmount: 300, depositAmount: 7, preAuthAmount: 9 }
  ];
  const updated = applyPricingGroupSecurityRateOverrides(rates, "group-1", [
    { unit: "calendar_day", depositAmount: 50, preAuthAmount: 800 },
    { unit: "hour", depositAmount: 20, preAuthAmount: 300 }
  ]);
  assert.equal(updated[0].baseAmount, 100, "资金费率修改不改变租金基本价");
  assert.equal(updated[0].depositAmount, 50);
  assert.equal(updated[0].preAuthAmount, 800, "实收押金与预授权额度分开修改");
  assert.deepEqual(updated[2], rates[2], "其他定价组完整保留");
  assert.throws(() => applyPricingGroupSecurityRateOverrides(rates, "group-1", [{ unit: "calendar_day", depositAmount: 50 }]), /完全一致/u, "不能漏交当前计价单位");
  assert.throws(() => applyPricingGroupSecurityRateOverrides(rates, "group-1", [{ unit: "calendar_day" }, { unit: "calendar_day" }]), /重复/u, "不能重复提交同一计价单位");
  assert.throws(() => applyPricingGroupSecurityRateOverrides(rates, "group-1", [{ unit: "calendar_day", depositAmount: -1 }, { unit: "hour" }]), /有限数字/u, "不能写入负金额");
  ok("资金费率仅覆盖目标组现有计价单位，基本价、其他组费率不变，漏项/重复/非法金额拒绝");
}

// ============ 0.1 业务规则要求的资金费率必须有正数配置 ============
{
  const rates = [
    { itemGroupName: "标准组", unit: "calendar_day", depositAmount: 0, depositMultiple: 0, preAuthAmount: 0, preAuthMultiple: 0 }
  ];
  assert.equal(validateSecurityRateCoverage(rates, { mode: "fixed" }, { mode: "none" }).length, 1, "固定押金为 0 不允许发布/报价");
  assert.equal(validateSecurityRateCoverage(rates, { mode: "price_multiple" }, { mode: "none" }).length, 1, "押金租金倍数为 0 不允许发布/报价");
  assert.equal(validateSecurityRateCoverage(rates, { mode: "none" }, { mode: "fixed" }).length, 1, "固定预授权为 0 不允许发布/报价");
  assert.equal(validateSecurityRateCoverage(rates, { mode: "none" }, { mode: "price_multiple" }).length, 1, "预授权租金倍数为 0 不允许发布/报价");
  assert.deepEqual(validateSecurityRateCoverage(rates, { mode: "order_fixed", fixedAmount: 500 }, { mode: "none" }), [], "每单固定由规则本身给金额，不要求费率行");
  const complete = [{ ...rates[0], depositAmount: 50, depositMultiple: 0.5, preAuthAmount: 800, preAuthMultiple: 1 }];
  assert.deepEqual(validateSecurityRateCoverage(complete, { mode: "fixed" }, { mode: "price_multiple" }), [], "完整正额费率可通过");
  ok("固定金额/租金倍数押金与预授权为 0 时失败；每单固定规则独立取规则金额");
}

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

// ============ 9. 规则跨字段校验：不能保存会被静默忽略的参数 ============
{
  assert.deepEqual(
    validateSecurityRules(
      { mode: "order_fixed", fixedAmount: 500 },
      { mode: "risk_surcharge", riskSurchargeAmount: 250 }
    ),
    [],
    "每单固定与风险附加的必需参数齐全"
  );
  assert.deepEqual(
    validateSecurityRules({ mode: "fixed" }, { mode: "order_fixed" }),
    ["预授权选择每单固定时必须填写 fixedAmount"],
    "每单固定缺金额必须拒绝"
  );
  assert.ok(
    validateSecurityRules({ mode: "price_multiple", fixedAmount: 100 }).some((message) => message.includes("仅能用于 order_fixed")),
    "押金不适用字段不能被静默忽略"
  );
  assert.ok(
    validateSecurityRules({ mode: "none" }, { mode: "fixed", riskSurchargeAmount: 20 }).some((message) => message.includes("仅能用于 risk_surcharge")),
    "预授权不适用风险附加额不能被静默忽略"
  );
  assert.ok(
    validateSecurityRules({ mode: "fixed", maxAmount: Number.NaN }).some((message) => message.includes("押金上限")),
    "有限数字校验不能被 NaN 绕过"
  );
  assert.ok(
    validateSecurityRules({ mode: "legacy_unknown" }).some((message) => message.includes("mode 无效")),
    "未知模式不能落入默认的逐件计算分支"
  );
  ok("押金/预授权规则校验模式与参数的跨字段约束，避免配置保存后静默失效");
}

// ============ 10. 会员保证金减免只触及明确放行的商品风险基数 ============
{
  const classified = [
    { ...lines[0], securityRiskLevel: "low" },
    { ...lines[1], securityRiskLevel: "high" }
  ];
  const result = computeSecurityAmounts(
    classified,
    { mode: "fixed", maxAmount: 100 },
    { mode: "none" },
    { deposit: ["low"] }
  );
  assert.equal(result.deposit.amount, 100, "原押金先整体封顶");
  assert.equal(result.deposit.membershipReductionEligibleAmount, 76.92, "只有低风险行参与，并按订单封顶比例缩减可减免基数");
  const unclassified = computeSecurityAmounts(
    [{ ...lines[0], securityRiskLevel: undefined }],
    { mode: "fixed" }, { mode: "none" }, { deposit: ["low", "standard", "high"] }
  );
  assert.equal(unclassified.deposit.membershipReductionEligibleAmount, 0, "未分级商品永不默认参与减免");
  ok("仅空间明确允许的商品风险等级进入会员押金减免基数，未分级商品 fail-closed");
}

// ============ 11. 每单固定押金只在整单商品全部获准时可减免 ============
{
  const allLow = lines.map((line) => ({ ...line, securityRiskLevel: "low" }));
  const mixed = [{ ...allLow[0] }, { ...allLow[1], securityRiskLevel: "high" }];
  assert.equal(
    computeSecurityAmounts(allLow, { mode: "order_fixed", fixedAmount: 500 }, { mode: "none" }, { deposit: ["low"] }).deposit.membershipReductionEligibleAmount,
    500,
    "全部商品均获准时整笔每单固定押金才可减免"
  );
  assert.equal(
    computeSecurityAmounts(mixed, { mode: "order_fixed", fixedAmount: 500 }, { mode: "none" }, { deposit: ["low"] }).deposit.membershipReductionEligibleAmount,
    0,
    "混合风险订单不能把无法拆分的每单固定押金错误归因给低风险商品"
  );
  ok("不可按商品拆分的每单固定押金采用整单全有或全无判定");
}

// ============ 12. 价格有效期覆盖未来规则切换，停用组不阻塞发布 ============
{
  const service = Object.create(RentalBusinessService.prototype);
  const futureRule = {
    version: "v2",
    status: "pending",
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    config: {
      payment: { depositMode: "fixed" },
      deposit: { mode: "fixed" },
      preauthorization: { mode: "none" }
    }
  };
  service.state = () => ({ ruleVersions: [futureRule] });
  service.effectiveRuleAt = (_tenantId, _context, at) =>
    new Date(at).getTime() >= Date.parse(futureRule.effectiveFrom) ? futureRule : undefined;
  const incompleteRate = {
    itemGroupId: "group-active", pricingGroupId: "group-active", itemGroupName: "当前组",
    unit: "calendar_day", baseAmount: 100, depositAmount: 0
  };
  assert.throws(
    () => service.assertSecurityRateCoverageTimeline("tenant-a", {}, [incompleteRate], "2026-09-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"),
    /v2/u,
    "覆盖未来规则生效点的价格版本不能漏掉未来固定押金要求"
  );
  assert.doesNotThrow(
    () => service.assertSecurityRateCoverageTimeline("tenant-a", {}, [incompleteRate], "2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
    "价格计划在规则切换前结束时不套用尚未生效的规则"
  );
  assert.deepEqual(
    service.securityRatesForEnabledTargets(
      { pricingGroups: [{ id: "group-active", status: "enabled" }, { id: "group-disabled", status: "disabled" }], groups: [] },
      [incompleteRate, { ...incompleteRate, itemGroupId: "group-disabled", pricingGroupId: "group-disabled" }]
    ).map((rate) => rate.pricingGroupId),
    ["group-active"],
    "停用定价组的历史费率不应阻塞当前规则/价格发布"
  );
  ok("价格发布校验覆盖有效区间内未来规则边界，并忽略不可报价的停用组");
}

// ============ 13. 预授权风险附加额不可被会员降掉 ============
{
  const result = computeSecurityAmounts(
    [{ ...lines[0], securityRiskLevel: "low" }, { ...lines[1], securityRiskLevel: "high" }],
    { mode: "none" },
    { mode: "risk_surcharge", riskSurchargeAmount: 250 },
    { preauthorization: ["low"] }
  );
  assert.equal(result.preauthorization.amount, 650, "预授权仍包括租金倍数与风险附加");
  assert.equal(result.preauthorization.membershipReductionEligibleAmount, 300, "只有获准低风险行的倍数基数可参与，风险附加不计入");
  ok("会员预授权减免不覆盖风险附加额或未获准商品");
}

console.log("\nAll security-deposit assertions passed.");
