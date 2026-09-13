import type { RentalEarlyReturnRule, RentalQuoteServiceSnapshot } from "@rental-os/shared";
import { roundMoney } from "./rental-money";

/**
 * 提前归还退款的计算（需求 4.6.8）。
 *
 * 抽成纯函数的理由与优惠取舍、押金计算相同：「凭什么退这么多」必须逐条回放。
 * 四个品类共用同一套算法，因此这里不出现任何品类编码分支——车辆租赁"提前不足一天不退"
 * 与摄影器材"提前就退"的差别，全部由经营空间规则里的 `minAdvanceHours` 表达。
 *
 * 需求要求「允许租金退款时必须明确计费单位、长租阶梯是否重新计算、优惠如何重新分摊」。
 * 本实现的口径固定为三条，且**不给配置选项**：
 *
 * 1. **按未使用计费单位占比折算**，不按小时按比例——计费单位才是客户付钱的粒度。
 * 2. **阶梯档不重算**。租 7 天命中 80 元/天档、第 4 天归还，若按实际 3 天重跑定价引擎会
 *    掉回 100 元/天档，算出来客户反而要补钱。折算保证"少用几天退几天的钱"。
 * 3. **优惠按同一比例同步折减**：基数是**净租金**（租金 − 分摊到租金的方案优惠与券优惠），
 *    不是毛租金。否则会退给客户他从没付过的钱。
 *
 * 押金与预授权不在此处：押金本就要退，走资金台账的 refund，不是"提前归还退款"。
 */

export interface EarlyReturnContext {
  /** 当前约定归还时间：订单的 `effectiveEndAt`（续租过就是新时间），不是原始 `endAt`。 */
  scheduledEndAt: string;
  /** 实际归还时刻。 */
  returnedAt: string;
  /** 报价快照里的总计费单位数。 */
  totalUnits: number;
  /** 未使用的计费单位数，由调用方按订单计价单位算出。 */
  unusedUnits: number;
  /** 优惠前租金。 */
  rentalAmount: number;
  /** 分摊到租金的自动优惠金额。 */
  rentalDiscountAmount: number;
  /** 分摊到租金的券优惠金额。 */
  rentalCouponAmount: number;
  /** 增值服务快照，用于退「未发生且可取消」的服务费。 */
  services?: RentalQuoteServiceSnapshot[];
}

export interface EarlyReturnRefund {
  /** 退款总额，**正数**。落到订单时取负值进费用明细。 */
  amount: number;
  rentalRefund: number;
  serviceRefund: number;
  /** 规则要求人工审批时为 true：金额已算好，但不得直接落账。 */
  requiresReview: boolean;
  /** 逐条依据，进订单费用明细的 detail，客服据此向客户解释。 */
  basis: string[];
}

const EMPTY: EarlyReturnRefund = { amount: 0, rentalRefund: 0, serviceRefund: 0, requiresReview: false, basis: [] };

export function computeEarlyReturnRefund(
  rule: RentalEarlyReturnRule | undefined,
  ctx: EarlyReturnContext
): EarlyReturnRefund {
  // 规则整组缺省或明确不退：保持需求 4.6.8「第一阶段默认不自动退租金」的行为。
  if (!rule || rule.mode === "none") return EMPTY;

  const advanceHours = (new Date(ctx.scheduledEndAt).getTime() - new Date(ctx.returnedAt).getTime()) / 3_600_000;
  // 按时或逾期归还不是提前归还。逾期费用有自己的规则，不在这里抵扣。
  if (!Number.isFinite(advanceHours) || advanceHours <= 0) return EMPTY;
  if (advanceHours < rule.minAdvanceHours) {
    return { ...EMPTY, basis: [`提前 ${advanceHours.toFixed(1)} 小时，未达规则要求的 ${rule.minAdvanceHours} 小时，不退租金`] };
  }

  const basis: string[] = [`提前 ${advanceHours.toFixed(1)} 小时归还，达到 ${rule.minAdvanceHours} 小时门槛`];

  // 未使用占比夹在 [0, 1]：调用方给出的单位数来自快照，异常数据不应放大成负退款或超额退款。
  const unusedRatio = ctx.totalUnits > 0 ? Math.min(1, Math.max(0, ctx.unusedUnits / ctx.totalUnits)) : 0;
  const netRental = Math.max(0, roundMoney(ctx.rentalAmount - ctx.rentalDiscountAmount - ctx.rentalCouponAmount));
  const rentalRefund = roundMoney((netRental * unusedRatio * rule.refundPercent) / 100);
  basis.push(
    `净租金 ${netRental}（租金 ${ctx.rentalAmount} − 优惠 ${ctx.rentalDiscountAmount} − 券 ${ctx.rentalCouponAmount}）` +
      ` × 未使用 ${ctx.unusedUnits}/${ctx.totalUnits} × ${rule.refundPercent}% = ${rentalRefund}`
  );

  // 未发生的服务：计划开始时刻不早于实际归还时刻，说明这份服务还没执行，可退。
  let serviceRefund = 0;
  if (rule.refundUndeliveredServices) {
    const returnedMs = new Date(ctx.returnedAt).getTime();
    for (const service of ctx.services ?? []) {
      const startMs = new Date(service.scheduledStartAt).getTime();
      // 时间读不出来（早于该字段的历史快照）就**不退**：说不清有没有履行过的服务，
      // 宁可不退也不能退。`NaN < returnedMs` 是 false，只判前者会把它当成未发生。
      if (!Number.isFinite(startMs) || startMs < returnedMs) continue;
      serviceRefund = roundMoney(serviceRefund + service.amount);
      basis.push(`未发生服务「${service.serviceName}」退 ${service.amount}`);
    }
  }

  let amount = roundMoney(rentalRefund + serviceRefund);
  if (rule.maxRefundAmount !== undefined && amount > rule.maxRefundAmount) {
    basis.push(`退款上限封顶 ${rule.maxRefundAmount}（原 ${amount}）`);
    amount = roundMoney(rule.maxRefundAmount);
  }

  return { amount, rentalRefund, serviceRefund, requiresReview: rule.mode === "manual_review", basis };
}
