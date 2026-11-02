import { ConflictException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { membershipBenefitScopeMatches, type RentalMembershipBenefitEvaluation, type RentalOrderExchangeExecutionBasis,
  type RentalOrderExchangePricingSegment, type RentalOrderChange, type RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { roundMoney } from "./rental-money";
import { isIndependentBenefitFreeSegment, segmentMarketingAmount } from "./rental-exchange-discount";

type LinePricing = NonNullable<RentalOrderExchangeExecutionBasis["linePricing"]>;

/** Adopted rental membership is separate from gross price and cash. This slice
 * requires its complete original allocation. An adopted coupon has its own
 * receipt; original marketing and coupon reductions consume its base first.
 * Extensions and multi-line budgets still require their own sources. */
export function originalExchangeMembership(quote: RentalQuoteSnapshotV1, workspaceId: string): RentalMembershipBenefitEvaluation {
  const rows = (quote.membershipBenefitEvaluations ?? []).filter(row => row.appliesTo === "rental" && row.appliedAmount > 0);
  const benefit = rows[0], amounts = quote.rentalLineAmounts;
  const targets = new Set(quote.request.lines.map(line => line.pricingGroupId ?? line.itemGroupId));
  const couponAmount = quote.couponEvaluation?.appliesTo === "rental" ? quote.couponAmount : 0;
  const marketingAmount = roundMoney(quote.discountEvaluations.filter(row => row.applied && row.appliesTo === "rental")
    .reduce((sum, row) => sum + row.discountAmount, 0));
  if (rows.length !== 1 || !benefit || benefit.type !== "rental_discount" || !benefit.planId || !benefit.planVersionId
    || !["personal", "corporate"].includes(benefit.source) || benefit.scopeMatched !== true || !benefit.scope
    || !membershipBenefitScopeMatches(benefit.scope, workspaceId, quote.categoryCode)
    || !["percentage", "amount", "quota"].includes(benefit.calculation)
    || !Number.isFinite(benefit.configuredValue) || benefit.configuredValue <= 0
    || benefit.calculation === "percentage" && benefit.configuredValue > 100
    || benefit.configuredMaximum !== undefined && (!Number.isFinite(benefit.configuredMaximum) || benefit.configuredMaximum < 0)
    || !Number.isFinite(couponAmount) || couponAmount < 0 || couponAmount > quote.rentalAmount
    || !Number.isFinite(marketingAmount) || marketingAmount < 0 || marketingAmount + couponAmount > quote.rentalAmount
    || !Number.isFinite(benefit.base) || roundMoney(benefit.base!) !== roundMoney(quote.rentalAmount - marketingAmount - couponAmount)
    || !amounts || Array.isArray(amounts) || Object.keys(amounts).length !== targets.size
    || Object.entries(amounts).some(([id, amount]) => !targets.has(id) || !Number.isFinite(amount) || amount < 0)
    || roundMoney(Object.values(amounts).reduce((sum, amount) => sum + amount, 0)) !== roundMoney(quote.rentalAmount)
    || !benefit.allocations || Array.isArray(benefit.allocations)
    || Object.entries(benefit.allocations).some(([id, amount]) => !Object.hasOwn(amounts, id) || !Number.isFinite(amount)
      || amount < 0 || amount > amounts[id])
    || roundMoney(Object.values(benefit.allocations).reduce((sum, amount) => sum + amount, 0)) !== roundMoney(benefit.appliedAmount)) {
    throw new ConflictException("原优惠会员租金规则或完整逐行分摊缺失，不能推断替换商品权益");
  }
  return structuredClone(benefit);
}

export function sameExchangeMembership(left: RentalMembershipBenefitEvaluation, right: RentalMembershipBenefitEvaluation): boolean {
  return isDeepStrictEqual([left.source, left.planId, left.planVersionId, left.type, left.calculation, left.configuredValue,
    left.configuredMaximum, left.scope, left.scopeMatched], [right.source, right.planId, right.planVersionId, right.type,
    right.calculation, right.configuredValue, right.configuredMaximum, right.scope, right.scopeMatched]);
}

export function segmentMembership(benefit: RentalMembershipBenefitEvaluation, segment: RentalOrderExchangePricingSegment,
  amount: number): RentalMembershipBenefitEvaluation {
  const base = roundMoney(segment.amount - segmentMarketingAmount(segment) - (segment.couponBenefit?.discountAmount ?? 0));
  if (!Number.isFinite(amount) || amount < 0 || amount > base) throw new ConflictException("原优惠分段减免超出租金");
  return { ...structuredClone(benefit), base, appliedAmount: roundMoney(amount),
    allocations: { [segment.orderLineId]: roundMoney(amount) }, detail: `原会员 ${benefit.planId}/${benefit.planVersionId}：扣原营销/券后基数 ${base}，本段净租金 ${roundMoney(base - amount)}` };
}

/** Splitting never reselects a benefit or restarts its fixed amount/cap. */
export function splitSegmentMembership(segment: RentalOrderExchangePricingSegment, usedAmount: number, usedCouponAmount = 0,
  usedDiscountAmount = 0): number {
  if (!segment.membershipBenefit) return 0;
  const origin = segment.membershipSplitBasis ?? { amount: segment.amount, reduction: segment.membershipBenefit.appliedAmount,
    consumedAmount: 0, consumedReduction: 0 };
  const cumulative = origin.amount > 0 ? roundMoney(origin.reduction * Math.min(1, (origin.consumedAmount + usedAmount) / origin.amount)) : 0;
  const usedBase = Math.max(0, roundMoney(usedAmount - usedDiscountAmount - usedCouponAmount));
  const remainingBase = Math.max(0, roundMoney(segment.amount - usedAmount
    - segmentMarketingAmount(segment) + usedDiscountAmount
    - (segment.couponBenefit?.discountAmount ?? 0) + usedCouponAmount));
  const minimumUsed = Math.max(0, roundMoney(segment.membershipBenefit.appliedAmount - remainingBase));
  return Math.max(minimumUsed, Math.min(usedBase, segment.membershipBenefit.appliedAmount,
    Math.max(0, roundMoney(cumulative - origin.consumedReduction))));
}

/** Reconcile net arithmetic to the original change, not merely to itself.
 * Positive additions and negative approvals remain the caller's ledger checks. */
export function assertExchangeMembershipChange(change: RentalOrderChange, pricing: LinePricing): void {
  assertExchangeMembershipPricing(pricing);
  const receipt = pricing.membershipPricing;
  if (!receipt) return;
  const added = change.diff.addedServices as Array<{ amount: number }> | undefined;
  const cancelled = change.diff.cancelledServices as Array<{ refundAmount: number }> | undefined;
  if (added !== undefined && !Array.isArray(added) || cancelled !== undefined && !Array.isArray(cancelled)
    || added?.some(row => !row || !Number.isFinite(row.amount) || row.amount < 0)
    || cancelled?.some(row => !row || !Number.isFinite(row.refundAmount) || row.refundAmount < 0)) {
    throw new ConflictException("原优惠换货服务差额来源无效");
  }
  const couponDelta = pricing.couponPricing ? roundMoney(pricing.couponPricing.replacementReduction - pricing.couponPricing.originalReduction) : 0;
  const discountDelta = pricing.discountPricing ? roundMoney(pricing.discountPricing.replacementReduction - pricing.discountPricing.originalReduction) : 0;
  const difference = roundMoney(receipt.replacementNetAmount - receipt.originalNetAmount - couponDelta - discountDelta
    + (added ?? []).reduce((sum, row) => sum + row.amount, 0) - (cancelled ?? []).reduce((sum, row) => sum + row.refundAmount, 0));
  if (change.diff.differenceAmount !== difference || change.additionalAmount !== Math.max(0, difference)
    || change.refundAmount !== Math.max(0, -difference)) {
    throw new ConflictException("原优惠会员净额与已入账换货差额不一致");
  }
}

export function assertExchangeMembershipPricing(pricing: LinePricing): void {
  const receipt = pricing.membershipPricing;
  const marked = [...pricing.previousSegments, ...pricing.segments].some(segment => segment.membershipBenefit !== undefined);
  if (!receipt) {
    if (marked) throw new ConflictException("原优惠分段缺少完整会员净额收据");
    return;
  }
  const benefit = receipt.benefit;
  if (receipt.version !== 1 || !benefit || benefit.type !== "rental_discount" || benefit.appliesTo !== "rental"
    || !benefit.planId || !benefit.planVersionId || !benefit.scope || benefit.scopeMatched !== true
    || !["percentage", "amount", "quota"].includes(benefit.calculation)
    || !Number.isFinite(benefit.configuredValue) || benefit.configuredValue <= 0
    || benefit.calculation === "percentage" && benefit.configuredValue > 100
    || benefit.configuredMaximum !== undefined && (!Number.isFinite(benefit.configuredMaximum) || benefit.configuredMaximum < 0
      || receipt.originalReduction > benefit.configuredMaximum || receipt.replacementReduction > benefit.configuredMaximum)
    || benefit.calculation !== "percentage" && (receipt.originalReduction > benefit.configuredValue || receipt.replacementReduction > benefit.configuredValue)
    || [receipt.originalReduction, receipt.replacementReduction, receipt.originalNetAmount, receipt.replacementNetAmount]
      .some(amount => !Number.isFinite(amount) || amount < 0)
    || roundMoney(pricing.originalAmount - receipt.originalReduction) !== receipt.originalNetAmount
    || roundMoney(pricing.replacementAmount - receipt.replacementReduction) !== receipt.replacementNetAmount) {
    throw new ConflictException("原优惠会员净额与稳定行毛租金不一致");
  }
  for (const [segments, reduction] of [[pricing.previousSegments, receipt.originalReduction],
    [pricing.segments, receipt.replacementReduction]] as const) {
    for (const segment of segments) {
      if (isIndependentBenefitFreeSegment(segment)) continue;
      const applied = segment.membershipBenefit;
      const origin = segment.membershipSplitBasis;
      if (origin && ([origin.amount, origin.reduction, origin.consumedAmount, origin.consumedReduction]
        .some(amount => !Number.isFinite(amount) || amount < 0)
        || origin.reduction > origin.amount || origin.consumedAmount + segment.amount > origin.amount + 0.005
        || origin.consumedReduction + (applied?.appliedAmount ?? 0) > origin.reduction + 0.005)) {
        throw new ConflictException("原优惠会员拆分基线与累计减免不一致");
      }
      if (!applied || !sameExchangeMembership(applied, benefit) || !Number.isFinite(applied.appliedAmount)
        || applied.appliedAmount < 0 || applied.appliedAmount > roundMoney(segment.amount - segmentMarketingAmount(segment) - (segment.couponBenefit?.discountAmount ?? 0))
        || applied.base !== roundMoney(segment.amount - segmentMarketingAmount(segment) - (segment.couponBenefit?.discountAmount ?? 0))
        || !isDeepStrictEqual(applied.allocations, { [pricing.orderLineId]: applied.appliedAmount })) {
        throw new ConflictException("原优惠会员逐段来源或净额不完整");
      }
    }
    if (roundMoney(segments.reduce((sum, segment) => sum + (segment.membershipBenefit?.appliedAmount ?? 0), 0)) !== reduction) {
      throw new ConflictException("原优惠会员逐段减免与原收据总额不一致");
    }
  }
}
