import {
  type RentalDiscountPlan,
  type RentalDiscountTarget,
  type RentalQuoteDiscountEvaluation
} from "@store-rental/shared";

/**
 * MKT-01A：自动优惠方案的资格判定、互斥取舍与逐项计算（需求 4.4.10）。
 *
 * 独立成纯函数模块的理由：优惠取舍是**可解释性**要求最强的一段逻辑——
 * 「为什么用的是 A 不是 B」必须能逐条回放。放在 createQuote 里就只能靠端到端报价
 * 反推，任一判据改错都很难定位；抽出来之后每条规则都能单独断言。
 *
 * 这里刻意**不**处理客户优惠券：需求把「系统自动计算的营销规则」与「客户持有的
 * 凭证」定为两个对象，两者的资格、生命周期与审计都不同。券的锁定与预算属 MKT-01B。
 */

/** 每个作用对象的优惠前金额。押金、预授权与异常费用不在其中——它们不可被普通优惠减免。 */
export interface RentalDiscountBases {
  rental: number;
  fulfillment: number;
  service: number;
}

export interface RentalDiscountContext {
  /** 各作用对象的优惠前金额。 */
  bases: RentalDiscountBases;
  /**
   * 最低消费的判定基数（需求 4.4.10：租金优惠的最低消费按「商品租金 + 使用量费用」
   * 的**优惠前**金额计算，不含履约费、增值服务、押金、预授权与异常费用）。
   */
  minimumSpendBase: number;
  customerType: "personal" | "corporate";
  /** 有客户 id 即视为会员场景（member scope 的判据）。 */
  hasCustomer: boolean;
  itemGroupIds: string[];
  pricingGroupIds?: string[];
  /** 报价租期覆盖的日期类型集合，与逐单位取价同一日界口径。 */
  dayTypes: Set<string>;
  /** 租期开始时点，用于有效期判定——不是报价创建时刻。 */
  rentalStartAt: string;
  workspaceId: string;
  /** 调用方显式指定的方案。给定时只评估它，落选即报错由调用方处理。 */
  requestedPlanId?: string;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** 该方案在给定基数上的减免额。上限依次是「最大优惠金额」与「基数本身」（不得优惠成负数）。 */
function amountFor(plan: RentalDiscountPlan, base: number) {
  if (base <= 0) return 0;
  const raw =
    plan.discountType === "percentage"
      ? (base * plan.discountValue) / 100
      : plan.discountValue;
  const capped = plan.maximumDiscount === undefined ? raw : Math.min(raw, plan.maximumDiscount);
  return money(Math.max(0, Math.min(base, capped)));
}

function formulaFor(plan: RentalDiscountPlan, base: number, amount: number) {
  const head =
    plan.discountType === "percentage"
      ? `${base} × ${plan.discountValue}%`
      : plan.discountType === "threshold_amount"
        ? `满 ${plan.thresholdAmount ?? 0} 减 ${plan.discountValue}`
        : `固定减免 ${plan.discountValue}`;
  const cap =
    plan.maximumDiscount !== undefined && amount >= plan.maximumDiscount
      ? `；封顶 ${plan.maximumDiscount}`
      : "";
  return `${head} = ${amount}${cap}`;
}

/**
 * 稳定排序键：先按优先级（数字小者优先），再按编码。
 *
 * 存在的全部理由是**不依赖加载顺序**（需求 4.4.10 点名禁止「按数据库装载顺序或
 * 配置创建顺序随机择一」）。任何比较都要以此收尾，否则同分时结果随重启漂移。
 */
function comparePlans(left: RentalDiscountPlan, right: RentalDiscountPlan) {
  if (left.priority !== right.priority) return left.priority - right.priority;
  return left.code.localeCompare(right.code);
}

/** 资格判定。返回逐条判据，便于报价直接展示「哪一项没过」。 */
function evaluateEligibility(plan: RentalDiscountPlan, ctx: RentalDiscountContext) {
  const eligibility: RentalQuoteDiscountEvaluation["eligibility"] = [];
  let skipReason: RentalQuoteDiscountEvaluation["skipReason"];

  const record = (rule: string, passed: boolean, detail?: string) => {
    eligibility.push({ rule, passed, detail });
    return passed;
  };

  if (!record("status", plan.status === "enabled", `状态 ${plan.status}`)) {
    skipReason = "status_not_enabled";
  }
  const at = new Date(ctx.rentalStartAt).getTime();
  const inPeriod =
    at >= new Date(plan.effectiveFrom).getTime() &&
    (plan.effectiveTo === undefined || at <= new Date(plan.effectiveTo).getTime());
  if (!record("effective_period", inPeriod, `按租期开始时点 ${ctx.rentalStartAt} 判定`) && !skipReason) {
    skipReason = "outside_effective_period";
  }
  if (!record("minimum_spend", ctx.minimumSpendBase >= plan.minimumSpend, `优惠前租金 ${ctx.minimumSpendBase} / 门槛 ${plan.minimumSpend}`) && !skipReason) {
    skipReason = "below_minimum_spend";
  }
  // 满额固定减免的门槛与最低消费是两个判据：前者决定「减多少」的适用性，
  // 后者是活动准入。合并成一个会让「满 500 减 50」在 minimumSpend=0 时对 100 元单也生效。
  if (plan.discountType === "threshold_amount") {
    const threshold = plan.thresholdAmount ?? 0;
    if (!record("threshold", ctx.minimumSpendBase >= threshold, `优惠前租金 ${ctx.minimumSpendBase} / 满减门槛 ${threshold}`) && !skipReason) {
      skipReason = "below_threshold";
    }
  }
  const scopeOk =
    plan.customerScope === "all" ||
    plan.customerScope === ctx.customerType ||
    (plan.customerScope === "member" && ctx.hasCustomer);
  if (!record("customer_scope", scopeOk, `方案范围 ${plan.customerScope}`) && !skipReason) {
    skipReason = "customer_scope_mismatch";
  }
  const pricingScope = plan.applicablePricingGroupIds ?? [];
  const groupOk = pricingScope.length
    ? (ctx.pricingGroupIds ?? []).some((id) => pricingScope.includes(id))
    : !plan.applicableItemGroupIds.length || ctx.itemGroupIds.some((id) => plan.applicableItemGroupIds.includes(id));
  if (!record("pricing_group", groupOk) && !skipReason) skipReason = "item_group_mismatch";
  const dayTypeOk =
    !plan.applicableDayTypes.length || plan.applicableDayTypes.some((dayType) => ctx.dayTypes.has(dayType));
  if (!record("day_type", dayTypeOk) && !skipReason) skipReason = "day_type_mismatch";
  const gross = ctx.bases[plan.appliesTo];
  if (!record("target_amount", gross > 0, `${plan.appliesTo} 优惠前金额 ${gross}`) && !skipReason) {
    skipReason = "no_chargeable_target";
  }

  return { eligibility, skipReason, eligible: !skipReason };
}

/**
 * 选出本次报价实际应用的优惠方案，并给出每个候选的完整评估。
 *
 * 算法（需求 4.4.10）：
 *   1. 逐个判定资格，记录逐条判据；
 *   2. 对合格方案按各自作用对象的**优惠前**金额算出候选减免额；
 *   3. 同一互斥组内取**实际减免最大**者；同额再按优先级、编码——绝不按加载顺序；
 *   4. 跨互斥组按稳定顺序依次尝试叠加，双方都允许叠加才同时应用；
 *   5. 已应用方案按作用对象各自累减，重算实际减免（第 2 步的候选额只用于比大小）。
 */
export function selectDiscountPlans(
  plans: RentalDiscountPlan[],
  ctx: RentalDiscountContext
): { applied: RentalDiscountPlan[]; evaluations: RentalQuoteDiscountEvaluation[]; discountByTarget: RentalDiscountBases } {
  const scoped = ctx.requestedPlanId ? plans.filter((plan) => plan.id === ctx.requestedPlanId) : plans;
  const judged = scoped.map((plan) => {
    const { eligibility, skipReason, eligible } = evaluateEligibility(plan, ctx);
    const gross = ctx.bases[plan.appliesTo];
    const candidateAmount = eligible ? amountFor(plan, gross) : 0;
    return { plan, eligibility, skipReason, eligible, gross, candidateAmount };
  });

  // 互斥组内择优。留空的 exclusiveGroup 自成一组，用 plan.id 作组键——
  // 用空串会把所有未配互斥组的方案挤成一组，等于默认全互斥。
  const groups = new Map<string, typeof judged>();
  for (const row of judged) {
    if (!row.eligible) continue;
    const key = row.plan.exclusiveGroup?.trim() || `__self:${row.plan.id}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  const winners = new Set<string>();
  const lostTo = new Map<string, { code: string; amount: number }>();
  for (const bucket of groups.values()) {
    const ranked = [...bucket].sort((left, right) => {
      // 实际减免大者优先；同额再按优先级与编码，保证可复算。
      if (right.candidateAmount !== left.candidateAmount) return right.candidateAmount - left.candidateAmount;
      return comparePlans(left.plan, right.plan);
    });
    const winner = ranked[0];
    winners.add(winner.plan.id);
    for (const loser of ranked.slice(1)) {
      lostTo.set(loser.plan.id, { code: winner.plan.code, amount: winner.candidateAmount });
    }
  }

  // 跨组不允许叠加时也必须按客户实际减免择优，不能又退回按优先级先到先得。
  // 可叠加方案组成一个候选组合；每个不允许叠加的方案各自是单独候选，选择总减免最大者。
  // 这样「优先级 1 减 5 元」不会挡掉「优先级 100 减 60 元」。
  const orderedWinners = judged
    .filter((row) => winners.has(row.plan.id))
    .sort((left, right) => comparePlans(left.plan, right.plan));
  const calculate = (rows: typeof orderedWinners) => {
    const running: RentalDiscountBases = { ...ctx.bases };
    const discountByTarget: RentalDiscountBases = { rental: 0, fulfillment: 0, service: 0 };
    const actual = new Map<string, { amount: number; base: number }>();
    const applied: RentalDiscountPlan[] = [];
    for (const row of rows) {
      const target: RentalDiscountTarget = row.plan.appliesTo;
      const base = running[target];
      const amount = amountFor(row.plan, base);
      actual.set(row.plan.id, { amount, base });
      if (amount <= 0) continue;
      running[target] = money(base - amount);
      discountByTarget[target] = money(discountByTarget[target] + amount);
      applied.push(row.plan);
    }
    const total = money(discountByTarget.rental + discountByTarget.fulfillment + discountByTarget.service);
    return { rows, applied, actual, discountByTarget, total };
  };
  const stackable = orderedWinners.filter((row) => row.plan.stackableWithOtherPlans);
  const options = [
    ...(stackable.length ? [calculate(stackable)] : []),
    ...orderedWinners.filter((row) => !row.plan.stackableWithOtherPlans).map((row) => calculate([row]))
  ].sort((left, right) => {
    if (right.total !== left.total) return right.total - left.total;
    const leftPlan = left.applied[0] ?? left.rows[0]?.plan;
    const rightPlan = right.applied[0] ?? right.rows[0]?.plan;
    if (!leftPlan) return 1;
    if (!rightPlan) return -1;
    return comparePlans(leftPlan, rightPlan);
  });
  const selected = options[0] ?? calculate([]);
  const { applied, actual, discountByTarget } = selected;
  const selectedIds = new Set(selected.rows.map((row) => row.plan.id));
  const blockingCode = applied[0]?.code ?? selected.rows[0]?.plan.code;
  const blocked = new Map<string, string>();
  for (const row of orderedWinners) {
    if (!selectedIds.has(row.plan.id) && blockingCode) blocked.set(row.plan.id, blockingCode);
  }

  const evaluations: RentalQuoteDiscountEvaluation[] = judged
    .sort((left, right) => comparePlans(left.plan, right.plan))
    .map((row) => {
      const hit = actual.get(row.plan.id);
      const isApplied = applied.some((plan) => plan.id === row.plan.id);
      const base = hit?.base ?? row.gross;
      const amount = hit?.amount ?? 0;
      let skipReason = row.skipReason;
      let skipDetail: string | undefined;
      if (!isApplied && !skipReason) {
        const lost = lostTo.get(row.plan.id);
        const blockedBy = blocked.get(row.plan.id);
        if (lost) {
          skipReason = "exclusive_group_lost";
          skipDetail = `同一互斥组内 ${lost.code} 减免 ${lost.amount} 更多（本方案 ${row.candidateAmount}）`;
        } else if (blockedBy) {
          skipReason = "not_stackable_with_applied";
          skipDetail = `与已应用方案 ${blockedBy} 不可叠加`;
        } else {
          skipReason = "zero_discount";
          skipDetail = `在基数 ${base} 上算不出减免`;
        }
      }
      return {
        planId: row.plan.id,
        planCode: row.plan.code,
        planName: row.plan.name,
        planVersion: row.plan.version,
        workspaceId: ctx.workspaceId,
        appliesTo: row.plan.appliesTo,
        discountType: row.plan.discountType,
        priority: row.plan.priority,
        exclusiveGroup: row.plan.exclusiveGroup,
        stackableWithOtherPlans: row.plan.stackableWithOtherPlans,
        stackableWithCoupon: row.plan.stackableWithCoupon,
        applied: isApplied,
        skipReason,
        skipDetail,
        eligibility: row.eligibility,
        grossAmount: row.gross,
        base,
        formula: formulaFor(row.plan, base, amount),
        candidateAmount: row.candidateAmount,
        discountAmount: amount,
        maximumDiscount: row.plan.maximumDiscount,
        capped: row.plan.maximumDiscount !== undefined && amount >= row.plan.maximumDiscount
      };
    });

  return { applied, evaluations, discountByTarget };
}
