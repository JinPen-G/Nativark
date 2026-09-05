const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { selectDiscountPlans } = require("../apps/api/src/modules/rental-core/rental-discount-selection");

/**
 * MKT-01A 专项：自动优惠方案的资格、互斥取舍与叠加（需求 4.4.10）。
 *
 * 纯函数用例：优惠取舍是可解释性要求最强的一段——「为什么用的是 A 不是 B」必须
 * 逐条回放。端到端报价只能证明"总额对得上"，无法定位是哪条判据算错了。
 */

const ok = (message) => console.log(`  PASS  ${message}`);

const plan = (over = {}) => ({
  id: over.id ?? `plan_${over.code ?? "X"}`,
  tenantId: "t1",
  categoryCode: "camping",
  code: over.code ?? "X",
  name: over.name ?? `方案 ${over.code ?? "X"}`,
  status: "enabled",
  discountType: "percentage",
  discountValue: 10,
  minimumSpend: 0,
  appliesTo: "rental",
  customerScope: "all",
  applicableItemGroupIds: [],
  applicableDayTypes: [],
  priority: 100,
  stackableWithOtherPlans: false,
  stackableWithCoupon: true,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  version: "1.0",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over
});

const ctx = (over = {}) => ({
  bases: { rental: 1000, fulfillment: 0, service: 0, ...(over.bases ?? {}) },
  minimumSpendBase: over.minimumSpendBase ?? (over.bases?.rental ?? 1000),
  customerType: over.customerType ?? "personal",
  hasCustomer: over.hasCustomer ?? true,
  itemGroupIds: over.itemGroupIds ?? ["g1"],
  dayTypes: over.dayTypes ?? new Set(["workday"]),
  rentalStartAt: over.rentalStartAt ?? "2026-06-01T02:00:00.000Z",
  workspaceId: over.workspaceId ?? "ws1",
  requestedPlanId: over.requestedPlanId,
  rentalLines: over.rentalLines
});

const byCode = (evaluations, code) => evaluations.find((row) => row.planCode === code);

// ============ 0. 限定商品优惠只作用于命中行 ============
{
  const scoped = plan({ id: "only-a", code: "ONLY_A", discountValue: 10, applicableItemGroupIds: ["a"] });
  const result = selectDiscountPlans([scoped], ctx({
    bases: { rental: 1000, fulfillment: 0, service: 0 }, itemGroupIds: ["a", "b"],
    rentalLines: [{ id: "a", itemGroupId: "a", amount: 100 }, { id: "b", itemGroupId: "b", amount: 900 }]
  }));
  assert.equal(result.discountByTarget.rental, 10, "只针对 A 的 10% 不得减免 B 的 900 元");
  assert.deepEqual(result.rentalLineDiscounts, { a: 10 }, "优惠必须只保存到实际命中行");
  ok("限定商品优惠只按适用订单行计算并保存分摊");
}

// ============ 1. 互斥组内按实际减免最大择一，而不是按优先级或加载顺序 ============
{
  // 装载顺序刻意让"减免更少但优先级更高"的方案排在前面：早前 sort(priority).slice(0,1)
  // 会选中它，与需求「默认选择对客户实际减免金额最大的一个」相反。
  const plans = [
    plan({ id: "p_small", code: "SMALL", priority: 1, discountValue: 5, exclusiveGroup: "G" }),
    plan({ id: "p_big", code: "BIG", priority: 90, discountValue: 20, exclusiveGroup: "G" })
  ];
  const { applied, evaluations, discountByTarget } = selectDiscountPlans(plans, ctx());
  assert.equal(applied.length, 1, "同一互斥组只能应用一个方案");
  assert.equal(applied[0].code, "BIG", "必须选实际减免最大的方案，而不是优先级最高的");
  assert.equal(discountByTarget.rental, 200);
  const loser = byCode(evaluations, "SMALL");
  assert.equal(loser.applied, false);
  assert.equal(loser.skipReason, "exclusive_group_lost");
  assert.match(loser.skipDetail, /BIG/, "落选原因必须点明输给了谁");
  assert.equal(loser.candidateAmount, 50, "落选方案仍须记录「若应用会减免多少」，否则无法解释取舍");
  ok("互斥组：按实际减免最大择一，落选方案记录竞争对手与候选金额");
}

// ============ 2. 减免相同时按优先级，再按编码——不看加载顺序 ============
{
  const forward = [
    plan({ id: "p_b", code: "BBB", priority: 50, exclusiveGroup: "G" }),
    plan({ id: "p_a", code: "AAA", priority: 10, exclusiveGroup: "G" })
  ];
  const reversed = [...forward].reverse();
  assert.equal(selectDiscountPlans(forward, ctx()).applied[0].code, "AAA");
  assert.equal(selectDiscountPlans(reversed, ctx()).applied[0].code, "AAA", "同额时结果不得随装载顺序变化");
  // 优先级也相同时按编码兜稳定序。
  const tied = [plan({ id: "p_z", code: "ZZZ", priority: 10, exclusiveGroup: "G" }), plan({ id: "p_m", code: "MMM", priority: 10, exclusiveGroup: "G" })];
  assert.equal(selectDiscountPlans(tied, ctx()).applied[0].code, "MMM");
  assert.equal(selectDiscountPlans([...tied].reverse(), ctx()).applied[0].code, "MMM");
  ok("同额取舍：先优先级、再编码，正反装载顺序结果一致");
}

// ============ 3. 跨互斥组叠加需双方都允许 ============
{
  const stackable = [
    plan({ id: "p1", code: "P1", exclusiveGroup: "G1", stackableWithOtherPlans: true, discountValue: 10 }),
    plan({ id: "p2", code: "P2", exclusiveGroup: "G2", stackableWithOtherPlans: true, discountValue: 10 })
  ];
  const both = selectDiscountPlans(stackable, ctx());
  assert.equal(both.applied.length, 2, "两个不同互斥组且都允许叠加时应同时应用");
  // 第二个方案在**已减免后的基数**上计算：1000×10%=100，(1000-100)×10%=90。
  assert.equal(both.discountByTarget.rental, 190, "叠加必须按运行基数依次计算，不是各自按原始金额");
  assert.equal(byCode(both.evaluations, "P2").base, 900, "快照必须记录该方案实际使用的计算基数");

  const oneRefuses = [
    plan({ id: "p1", code: "P1", exclusiveGroup: "G1", stackableWithOtherPlans: true }),
    plan({ id: "p2", code: "P2", exclusiveGroup: "G2", stackableWithOtherPlans: false })
  ];
  const single = selectDiscountPlans(oneRefuses, ctx());
  assert.equal(single.applied.length, 1, "任一方不允许叠加就只应用一个");
  const blocked = single.evaluations.find((row) => !row.applied);
  assert.equal(blocked.skipReason, "not_stackable_with_applied");
  assert.match(blocked.skipDetail, /不可叠加/);

  const bestAcrossGroups = selectDiscountPlans([
    plan({ id: "p_tiny", code: "TINY", exclusiveGroup: "G1", priority: 1, stackableWithOtherPlans: false, discountType: "fixed_amount", discountValue: 5 }),
    plan({ id: "p_large", code: "LARGE", exclusiveGroup: "G2", priority: 100, stackableWithOtherPlans: false, discountType: "fixed_amount", discountValue: 60 })
  ], ctx());
  assert.equal(bestAcrossGroups.applied[0].code, "LARGE", "跨组不可叠加时也必须选实际减免更大的方案，不能按优先级先到先得");
  ok("跨组叠加：双方都允许才叠，基数依次递减，被挡方案记明原因");
}

// ============ 4. 作用费用对象各自独立，押金与预授权不在取值域内 ============
{
  const plans = [
    plan({ id: "pr", code: "RENTAL", appliesTo: "rental", discountValue: 10, exclusiveGroup: "A", stackableWithOtherPlans: true }),
    plan({ id: "pf", code: "FULFIL", appliesTo: "fulfillment", discountType: "fixed_amount", discountValue: 30, exclusiveGroup: "B", stackableWithOtherPlans: true }),
    plan({ id: "ps", code: "SERVICE", appliesTo: "service", discountType: "fixed_amount", discountValue: 20, exclusiveGroup: "C", stackableWithOtherPlans: true })
  ];
  const result = selectDiscountPlans(plans, ctx({ bases: { rental: 1000, fulfillment: 100, service: 50 } }));
  assert.equal(result.discountByTarget.rental, 100);
  assert.equal(result.discountByTarget.fulfillment, 30);
  assert.equal(result.discountByTarget.service, 20);
  assert.equal(byCode(result.evaluations, "FULFIL").grossAmount, 100, "履约费方案的优惠前金额必须是履约费，不是租金");
  // 取值域本身不含押金/预授权/异常费用：契约层面就不可能配出「减免押金」的方案。
  const { RENTAL_DISCOUNT_TARGETS } = require("../packages/shared/dist/index.js");
  assert.deepEqual([...RENTAL_DISCOUNT_TARGETS], ["rental", "fulfillment", "service"], "普通优惠的作用对象不得包含押金、预授权或异常费用");
  ok("作用对象：租金/履约/服务各自独立计算，押金与预授权不在取值域");
}

// ============ 5. 满额固定减免与封顶 ============
{
  const below = selectDiscountPlans(
    [plan({ code: "TH", discountType: "threshold_amount", thresholdAmount: 1500, discountValue: 100 })],
    ctx({ bases: { rental: 1000 }, minimumSpendBase: 1000 })
  );
  assert.equal(below.applied.length, 0, "未达满减门槛不得应用");
  assert.equal(below.evaluations[0].skipReason, "below_threshold");

  const above = selectDiscountPlans(
    [plan({ code: "TH", discountType: "threshold_amount", thresholdAmount: 1500, discountValue: 100 })],
    ctx({ bases: { rental: 2000 }, minimumSpendBase: 2000 })
  );
  assert.equal(above.discountByTarget.rental, 100, "达到门槛后按固定额减免");
  assert.match(above.evaluations[0].formula, /满 1500 减 100/, "公式必须能直接展示给客户");

  const capped = selectDiscountPlans(
    [plan({ code: "CAP", discountValue: 50, maximumDiscount: 120 })],
    ctx({ bases: { rental: 1000 } })
  );
  assert.equal(capped.discountByTarget.rental, 120, "百分比减免必须受最高减免封顶");
  assert.equal(capped.evaluations[0].capped, true);
  ok("满额固定减免：门槛判定与封顶均生效，公式可展示");
}

// ============ 6. 资格判据逐条可解释，且按租期开始时点判有效期 ============
{
  const plans = [
    plan({ code: "PERIOD", effectiveFrom: "2026-07-01T00:00:00.000Z" }),
    plan({ code: "SPEND", minimumSpend: 5000 }),
    plan({ code: "SCOPE", customerScope: "corporate" }),
    plan({ code: "GROUP", applicableItemGroupIds: ["other"] }),
    plan({ code: "DAYTYPE", applicableDayTypes: ["statutory_holiday"] }),
    plan({ code: "DRAFT", status: "draft" })
  ];
  const { applied, evaluations } = selectDiscountPlans(plans, ctx());
  assert.equal(applied.length, 0, "全部候选都不合格时不得应用任何方案");
  assert.equal(byCode(evaluations, "PERIOD").skipReason, "outside_effective_period");
  assert.match(byCode(evaluations, "PERIOD").eligibility.find((row) => row.rule === "effective_period").detail, /2026-06-01/, "有效期必须按租期开始时点判定，并在判据里写明");
  assert.equal(byCode(evaluations, "SPEND").skipReason, "below_minimum_spend");
  assert.equal(byCode(evaluations, "SCOPE").skipReason, "customer_scope_mismatch");
  assert.equal(byCode(evaluations, "GROUP").skipReason, "item_group_mismatch");
  assert.equal(byCode(evaluations, "DAYTYPE").skipReason, "day_type_mismatch");
  assert.equal(byCode(evaluations, "DRAFT").skipReason, "status_not_enabled");
  for (const row of evaluations) {
    assert.ok(row.eligibility.length >= 6, `${row.planCode} 必须逐条记录资格判据`);
    assert.equal(row.workspaceId, "ws1", "评估必须带经营空间，营销权益按空间隔离");
    assert.equal(row.planVersion, "1.0", "评估必须带方案版本，方案改版后历史报价仍可解释");
  }
  ok("资格判据：六类判据逐条记录原因码，有效期按租期开始时点判定");
}

// ============ 7. 最低消费只看优惠前租金，不含履约费与增值服务 ============
{
  // 租金 400、履约 100、服务 200：合计 700 已过 500 门槛，但租金本身没过。
  const result = selectDiscountPlans(
    [plan({ code: "MIN", minimumSpend: 500 })],
    ctx({ bases: { rental: 400, fulfillment: 100, service: 200 }, minimumSpendBase: 400 })
  );
  assert.equal(result.applied.length, 0, "最低消费必须按优惠前租金判定，不得把履约费与服务费算进门槛");
  assert.equal(result.evaluations[0].skipReason, "below_minimum_spend");
  ok("最低消费基数：只含商品租金与使用量，不含履约费、增值服务");
}

// ============ 8. 指定方案不合格时不静默换一个 ============
{
  const plans = [
    plan({ id: "p_req", code: "REQ", minimumSpend: 5000 }),
    plan({ id: "p_other", code: "OTHER", discountValue: 20 })
  ];
  const result = selectDiscountPlans(plans, ctx({ requestedPlanId: "p_req" }));
  assert.equal(result.applied.length, 0, "调用方指名的方案不合格时不得改用别的方案");
  assert.equal(result.evaluations.length, 1, "指定方案时只评估该方案");
  assert.equal(result.evaluations[0].planCode, "REQ");
  ok("指定方案：不合格时不静默替换，仅回报该方案的落选原因");
}

// ============ 9. 基数被前序优惠吃光时如实记 0，不应用 0 元优惠 ============
{
  // 固定减免 1500 大于基数 1000：必须削到基数，否则应付会被优惠成负数。
  const plans = [
    plan({ id: "p_all", code: "ALL", discountType: "fixed_amount", discountValue: 1500, exclusiveGroup: "G1", stackableWithOtherPlans: true }),
    plan({ id: "p_rest", code: "REST", discountType: "fixed_amount", discountValue: 50, exclusiveGroup: "G2", stackableWithOtherPlans: true, priority: 200 })
  ];
  const result = selectDiscountPlans(plans, ctx({ bases: { rental: 1000 } }));
  assert.equal(result.discountByTarget.rental, 1000, "减免不得超过基数，任何费用项不得被优惠成负数");
  assert.equal(byCode(result.evaluations, "ALL").discountAmount, 1000, "超过基数的固定减免必须被削到基数");
  assert.equal(result.applied.length, 1);
  assert.equal(byCode(result.evaluations, "REST").skipReason, "zero_discount");
  assert.equal(byCode(result.evaluations, "REST").discountAmount, 0);
  ok("不得优惠成负数：减免削到基数，基数耗尽后不应用 0 元优惠并记明原因");
}

console.log("\nMKT-01A 优惠方案资格与互斥专项：全部通过");
