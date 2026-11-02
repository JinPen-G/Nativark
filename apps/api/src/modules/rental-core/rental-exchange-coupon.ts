import { ConflictException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import type { RentalOrderChange, RentalOrderExchangeExecutionBasis, RentalOrderExchangePricingSegment,
  RentalQuoteCouponEvaluation, RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { roundMoney } from "./rental-money";
import { isIndependentBenefitFreeSegment, segmentMarketingAmount } from "./rental-exchange-discount";

type LinePricing = NonNullable<RentalOrderExchangeExecutionBasis["linePricing"]>;

/** Read the adopted coupon's frozen scope; allocations alone do not prove a
 * replacement's eligibility. No claim, redemption, or budget write occurs here. */
export function originalExchangeCoupon(quote: RentalQuoteSnapshotV1): RentalQuoteCouponEvaluation {
  const coupon = quote.couponEvaluation, target = quote.request.lines[0]?.pricingGroupId ?? quote.request.lines[0]?.itemGroupId;
  const marketing = quote.discountEvaluations.filter(row => row.applied && row.appliesTo === "rental" && row.discountAmount > 0);
  const marketingAmount = roundMoney(marketing.reduce((sum, row) => sum + row.discountAmount, 0));
  if (!coupon || quote.request.lines.length !== 1 || !target || coupon.appliesTo !== "rental"
    || !coupon.couponId || !coupon.templateId || !coupon.templateVersion
    || !Array.isArray(coupon.applicableItemGroupIds) || coupon.applicableItemGroupIds.some(id => typeof id !== "string" || !id.trim())
    || new Set(coupon.applicableItemGroupIds).size !== coupon.applicableItemGroupIds.length
    || coupon.applicableItemGroupIds.length > 0 && !coupon.applicableItemGroupIds.includes(quote.request.lines[0].itemGroupId!)
    || !["percentage", "fixed_amount"].includes(coupon.discountType)
    || !Number.isFinite(coupon.discountValue) || coupon.discountValue <= 0
    || coupon.discountType === "percentage" && coupon.discountValue > 100
    || !Number.isFinite(coupon.minimumSpend) || coupon.minimumSpend < 0 || quote.rentalAmount < coupon.minimumSpend
    || coupon.maximumDiscount !== undefined && (!Number.isFinite(coupon.maximumDiscount) || coupon.maximumDiscount < 0)
    || !Number.isFinite(coupon.discountAmount) || coupon.discountAmount <= 0 || coupon.discountAmount !== quote.couponAmount
    || !Number.isFinite(marketingAmount) || marketingAmount < 0 || marketingAmount > quote.rentalAmount
    || marketing.length > 0 && (!coupon.stackableWithDiscountPlans || marketing.some(row => !row.planSnapshot?.stackableWithCoupon))
    || coupon.baseBeforeDiscount !== quote.rentalAmount || coupon.runningBase !== roundMoney(quote.rentalAmount - marketingAmount)
    || !isDeepStrictEqual(coupon.rentalAllocations, { [target]: coupon.discountAmount })) {
    throw new ConflictException("原优惠券规则、完整商品范围或原租金分摊缺失，不能推断换货资格");
  }
  return structuredClone(coupon);
}

export function sameExchangeCoupon(left: RentalQuoteCouponEvaluation, right: RentalQuoteCouponEvaluation): boolean {
  return isDeepStrictEqual([left.couponId, left.templateId, left.templateVersion, left.appliesTo, left.discountType,
    left.discountValue, left.minimumSpend, left.maximumDiscount, left.applicableItemGroupIds],
  [right.couponId, right.templateId, right.templateVersion, right.appliesTo, right.discountType,
    right.discountValue, right.minimumSpend, right.maximumDiscount, right.applicableItemGroupIds]);
}

export function segmentCoupon(coupon: RentalQuoteCouponEvaluation, segment: RentalOrderExchangePricingSegment, amount: number): RentalQuoteCouponEvaluation {
  const base = roundMoney(segment.amount - segmentMarketingAmount(segment));
  if (!Number.isFinite(amount) || amount < 0 || amount > base) throw new ConflictException("原优惠券逐段减免超出租金");
  return { ...structuredClone(coupon), baseBeforeDiscount: segment.amount, runningBase: base,
    discountAmount: roundMoney(amount), rentalAllocations: { [segment.orderLineId]: roundMoney(amount) },
    formula: `原券 ${coupon.couponId}/${coupon.templateVersion}：本段减免 ${roundMoney(amount)}` };
}

export function splitSegmentCoupon(segment: RentalOrderExchangePricingSegment, usedAmount: number, usedDiscountAmount = 0): number {
  if (!segment.couponBenefit) return 0;
  const basis = segment.couponSplitBasis ?? { amount: segment.amount, reduction: segment.couponBenefit.discountAmount,
    consumedAmount: 0, consumedReduction: 0 };
  const cumulative = basis.amount > 0 ? roundMoney(basis.reduction * Math.min(1, (basis.consumedAmount + usedAmount) / basis.amount)) : 0;
  const usedBase = Math.max(0, roundMoney(usedAmount - usedDiscountAmount));
  const remainingBase = Math.max(0, roundMoney(segment.amount - usedAmount
    - segmentMarketingAmount(segment) + usedDiscountAmount));
  const minimumUsed = Math.max(0, roundMoney(segment.couponBenefit.discountAmount - remainingBase));
  return Math.max(minimumUsed, Math.min(usedBase, segment.couponBenefit.discountAmount,
    Math.max(0, roundMoney(cumulative - basis.consumedReduction))));
}

export function assertExchangeCouponPricing(pricing: LinePricing): void {
  const receipt = pricing.couponPricing;
  if (!receipt) {
    if ([...pricing.previousSegments, ...pricing.segments].some(segment => segment.couponBenefit !== undefined)) {
      throw new ConflictException("原优惠券逐段净额收据缺失");
    }
    return;
  }
  const coupon = receipt.coupon;
  if (receipt.version !== 1 || !coupon || coupon.appliesTo !== "rental" || !coupon.couponId || !coupon.templateId || !coupon.templateVersion
    || !Array.isArray(coupon.applicableItemGroupIds) || coupon.applicableItemGroupIds.some(id => typeof id !== "string" || !id)
    || !["percentage", "fixed_amount"].includes(coupon.discountType)
    || !Number.isFinite(coupon.discountValue) || coupon.discountValue <= 0
    || coupon.discountType === "percentage" && coupon.discountValue > 100
    || !Number.isFinite(coupon.minimumSpend) || coupon.minimumSpend < 0
    || [receipt.originalReduction, receipt.replacementReduction, receipt.originalNetAmount, receipt.replacementNetAmount]
      .some(amount => !Number.isFinite(amount) || amount < 0)
    || coupon.maximumDiscount !== undefined && (!Number.isFinite(coupon.maximumDiscount) || coupon.maximumDiscount < 0
      || receipt.originalReduction > coupon.maximumDiscount || receipt.replacementReduction > coupon.maximumDiscount)
    || coupon.discountType === "fixed_amount" && (receipt.originalReduction > coupon.discountValue || receipt.replacementReduction > coupon.discountValue)
    || roundMoney(pricing.originalAmount - receipt.originalReduction) !== receipt.originalNetAmount
    || roundMoney(pricing.replacementAmount - receipt.replacementReduction) !== receipt.replacementNetAmount) {
    throw new ConflictException("原优惠券净额与稳定行毛租金不一致");
  }
  for (const [segments, total] of [[pricing.previousSegments, receipt.originalReduction], [pricing.segments, receipt.replacementReduction]] as const) {
    for (const segment of segments) {
      if (isIndependentBenefitFreeSegment(segment)) continue;
      const benefit = segment.couponBenefit, origin = segment.couponSplitBasis;
      if (!benefit || !sameExchangeCoupon(coupon, benefit) || !Number.isFinite(benefit.discountAmount) || benefit.discountAmount < 0
        || benefit.discountAmount > roundMoney(segment.amount - segmentMarketingAmount(segment))
        || benefit.baseBeforeDiscount !== segment.amount || benefit.runningBase !== roundMoney(segment.amount - segmentMarketingAmount(segment))
        || !isDeepStrictEqual(benefit.rentalAllocations, { [pricing.orderLineId]: benefit.discountAmount })
        || origin && ([origin.amount, origin.reduction, origin.consumedAmount, origin.consumedReduction].some(value => !Number.isFinite(value) || value < 0)
          || origin.reduction > origin.amount || origin.consumedAmount + segment.amount > origin.amount + 0.005
          || origin.consumedReduction + benefit.discountAmount > origin.reduction + 0.005)) {
        throw new ConflictException("原优惠券逐段来源或累计分摊不完整");
      }
    }
    if (roundMoney(segments.reduce((sum, segment) => sum + (segment.couponBenefit?.discountAmount ?? 0), 0)) !== total) {
      throw new ConflictException("原优惠券逐段减免与总额不一致");
    }
  }
}

/** Match historical net evidence to the original change before any successor. */
export function assertExchangeCouponChange(change: RentalOrderChange, pricing: LinePricing): void {
  assertExchangeCouponPricing(pricing);
  const receipt = pricing.couponPricing;
  if (!receipt) return;
  const added = change.diff.addedServices as Array<{ amount: number }> | undefined;
  const cancelled = change.diff.cancelledServices as Array<{ refundAmount: number }> | undefined;
  if (added !== undefined && !Array.isArray(added) || cancelled !== undefined && !Array.isArray(cancelled)
    || added?.some(row => !row || !Number.isFinite(row.amount) || row.amount < 0)
    || cancelled?.some(row => !row || !Number.isFinite(row.refundAmount) || row.refundAmount < 0)) {
    throw new ConflictException("原优惠券换货服务差额来源无效");
  }
  const membershipDelta = pricing.membershipPricing ? roundMoney(pricing.membershipPricing.replacementReduction - pricing.membershipPricing.originalReduction) : 0;
  const discountDelta = pricing.discountPricing ? roundMoney(pricing.discountPricing.replacementReduction - pricing.discountPricing.originalReduction) : 0;
  const difference = roundMoney(receipt.replacementNetAmount - receipt.originalNetAmount - membershipDelta - discountDelta
    + (added ?? []).reduce((sum, row) => sum + row.amount, 0) - (cancelled ?? []).reduce((sum, row) => sum + row.refundAmount, 0));
  if (change.diff.differenceAmount !== difference || change.additionalAmount !== Math.max(0, difference) || change.refundAmount !== Math.max(0, -difference)) {
    throw new ConflictException("原优惠券净额与已入账换货差额不一致");
  }
}
