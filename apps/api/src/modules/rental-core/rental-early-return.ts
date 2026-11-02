import type { RentalEarlyReturnRule, RentalOrderServiceOccurrence, RentalOrder } from "@rental-os/shared";
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
  /** 当前原服务发生项，amount已由调用方扣原优惠。计划时间不能证明未履行。 */
  services?: RentalOrderServiceOccurrence[];
}

export interface EarlyReturnRefund {
  /** 退款总额，**正数**。落到订单时取负值进费用明细。 */
  amount: number | null;
  rentalRefund: number | null;
  serviceRefund: number | null;
  /** 金额未知时的原快照最大核减额；不是建议退款金额。 */
  maximumAmount?: number;
  /** 规则要求人工审批或缺少可自动复算依据时为 true，不得直接落账。 */
  requiresReview: boolean;
  /** 逐条依据，进订单费用明细的 detail，客服据此向客户解释。 */
  basis: string[];
}

/** Whole-return source only: exchange/service reductions have independent receipts. */
export function hasWholeEarlyReturnReduction(order?: Partial<Pick<RentalOrder, "id" | "chargeLines" | "feeReviews">>): boolean {
  const code = order?.id ? `early_return_refund:${order.id}` : undefined;
  return Boolean(code && order?.chargeLines?.some(line => line.type === "early_return_refund"
    && (line.code === code || line.code === `${code}:order`) && Number.isFinite(line.amount) && line.amount < 0)
    || order?.feeReviews?.some(review => review.type === "early_return_refund" && !review.sourceId && review.status === "approved"));
}

const EMPTY: EarlyReturnRefund = { amount: 0, rentalRefund: 0, serviceRefund: 0, requiresReview: false, basis: [] };

export function computeEarlyReturnRefund(
  rule: RentalEarlyReturnRule | undefined,
  ctx: EarlyReturnContext,
  /** Internal batch aggregation rounds rental cents once after summing all parts. */
  deferRentalRounding = false
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
  const rentalBasis = (netRental * unusedRatio * rule.refundPercent) / 100;
  const rentalRefund = deferRentalRounding ? rentalBasis : roundMoney(rentalBasis);
  basis.push(
    `净租金 ${netRental}（租金 ${ctx.rentalAmount} − 优惠 ${ctx.rentalDiscountAmount} − 券 ${ctx.rentalCouponAmount}）` +
      ` × 未使用 ${ctx.unusedUnits}/${ctx.totalUnits} × ${rule.refundPercent}% = ${rentalRefund}`
  );

  let serviceRefund = 0, serviceUnknown = false, serviceMaximum = 0;
  if (rule.refundUndeliveredServices) {
    for (const service of ctx.services ?? []) {
      // Another original cancellation/refund owns this service reduction. The
      // early-return path cannot issue it again under a different charge code.
      if (service.refundStatus && service.refundStatus !== "none") continue;
      // Terminal failure/cancellation owns its separate original service review,
      // including a zero or rejected refund; never repeat it as early return.
      if (["completed", "cancelled", "failed", "no_show"].includes(service.executionStatus ?? "")) continue;
      if (!Number.isFinite(service.amount) || service.amount < 0) throw new Error("原服务净额无效");
      serviceMaximum = roundMoney(serviceMaximum + service.amount);
      if (!service.occurrenceId || service.executionStatus !== "not_started"
        || !Number.isInteger(service.quantity) || service.quantity < 1 || service.actualStartAt) {
        serviceUnknown = true; basis.push(`服务「${service.serviceName}」实际履约依据不全，不能按计划时间退款`); continue;
      }
      const executed = service.executedQuantity ?? 0;
      if (!Number.isInteger(executed) || executed !== 0
        || service.executionSegments?.length && (service.executionSegments.some(segment => !Number.isInteger(segment.quantity) || segment.quantity < 1)
          || service.executionSegments.reduce((sum, segment) => sum + segment.quantity, 0) !== executed)) {
        serviceUnknown = true; basis.push(`服务「${service.serviceName}」已执行数量待核对`); continue;
      }
      // Core's service completion/cancellation path is the only writer of these facts.
      const refundable = roundMoney(Math.max(0, service.amount) * (service.quantity - executed) / service.quantity);
      serviceRefund = roundMoney(serviceRefund + refundable);
      basis.push(`原服务「${service.serviceName}」未执行 ${service.quantity - executed}/${service.quantity}，净额核减 ${refundable}`);
    }
  }
  if (serviceUnknown) return { amount: null, rentalRefund, serviceRefund: null,
    maximumAmount: roundMoney(Math.min(rentalRefund + serviceMaximum, rule.maxRefundAmount ?? Infinity)), requiresReview: true, basis };

  let amount = roundMoney(rentalRefund + serviceRefund);
  if (rule.maxRefundAmount !== undefined && amount > rule.maxRefundAmount) {
    basis.push(`退款上限封顶 ${rule.maxRefundAmount}（原 ${amount}）`);
    amount = roundMoney(rule.maxRefundAmount);
  }

  return { amount, rentalRefund, serviceRefund, requiresReview: rule.mode === "manual_review", basis };
}
