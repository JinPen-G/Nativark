import { ConflictException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import type { RentalOrderChange, RentalOrderExchangeExecutionBasis, RentalOrderExchangePricingSegment,
  RentalQuoteDiscountEvaluation, RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { selectDiscountPlans } from "./rental-discount-selection";
import { roundMoney } from "./rental-money";

type LinePricing = NonNullable<RentalOrderExchangeExecutionBasis["linePricing"]>;

/** Only the originally adopted single rental plan is eligible here. This does
 * not select new promotions; downstream coupon/member layers keep separate receipts. */
export function originalExchangeDiscount(quote: RentalQuoteSnapshotV1, workspaceId: string): RentalQuoteDiscountEvaluation {
  const rows = quote.discountEvaluations.filter(row => row.applied && row.appliesTo === "rental" && row.discountAmount > 0);
  const evaluation = rows[0], plan = evaluation?.planSnapshot, line = quote.request.lines[0];
  if (rows.length !== 1 || quote.request.lines.length !== 1 || !line || !plan || plan.tenantId !== quote.tenantId
    || plan.categoryCode !== quote.categoryCode || plan.id !== evaluation.planId || plan.version !== evaluation.planVersion
    || evaluation.workspaceId !== workspaceId || plan.appliesTo !== "rental" || !evaluation.applied
    || !["percentage", "fixed_amount", "threshold_amount"].includes(plan.discountType)
    || !Number.isFinite(plan.discountValue) || plan.discountValue <= 0
    || plan.discountType === "percentage" && plan.discountValue > 100
    || !Number.isFinite(plan.minimumSpend) || plan.minimumSpend < 0
    || plan.discountType === "threshold_amount" && (!Number.isFinite(plan.thresholdAmount) || plan.thresholdAmount! < 0)
    || plan.maximumDiscount !== undefined && (!Number.isFinite(plan.maximumDiscount) || plan.maximumDiscount < 0)
    || !Array.isArray(plan.applicableItemGroupIds) || !Array.isArray(plan.applicableDayTypes)
    || plan.applicablePricingGroupIds !== undefined && !Array.isArray(plan.applicablePricingGroupIds)
    || !Number.isFinite(evaluation.discountAmount) || evaluation.discountAmount > quote.rentalAmount
    || !isDeepStrictEqual(evaluation.rentalAllocations, { [line.pricingGroupId ?? line.itemGroupId!]: evaluation.discountAmount })) {
    throw new ConflictException("原优惠营销规则或完整逐行分摊缺失，不能推断换货减免");
  }
  const replay = selectDiscountPlans([structuredClone(plan)], {
    bases: { rental: quote.rentalAmount, fulfillment: 0, service: 0 }, minimumSpendBase: quote.rentalAmount,
    customerType: quote.request.customerType, hasCustomer: Boolean(quote.membershipSnapshot),
    itemGroupIds: [line.itemGroupId!], pricingGroupIds: line.pricingGroupId ? [line.pricingGroupId] : [],
    rentalLines: [{ id: line.pricingGroupId ?? line.itemGroupId!, itemGroupId: line.itemGroupId!, pricingGroupId: line.pricingGroupId, amount: quote.rentalAmount }],
    dayTypes: new Set(quote.calendarSnapshot.map(row => row.dayType)), rentalStartAt: quote.request.startAt, workspaceId
  });
  if (replay.discountByTarget.rental !== evaluation.discountAmount) throw new ConflictException("原优惠营销金额无法按冻结规则复算");
  return structuredClone(evaluation);
}

/** Validate the original selected combination, not a fresh promotion search. */
export function originalExchangeDiscounts(quote: RentalQuoteSnapshotV1, workspaceId: string): RentalQuoteDiscountEvaluation[] {
  const rows = quote.discountEvaluations.filter(row => row.applied && row.appliesTo === "rental" && row.discountAmount > 0);
  if (rows.length === 1) return [originalExchangeDiscount(quote, workspaceId)];
  const line = quote.request.lines[0];
  if (rows.length < 2 || quote.request.lines.length !== 1 || !line
    || new Set(rows.map(row => row.planId)).size !== rows.length
    || new Set(rows.map(row => row.planSnapshot?.exclusiveGroup?.trim() || `__self:${row.planId}`)).size !== rows.length
    || rows.some(row => {
      const plan = row.planSnapshot;
      return !plan || plan.tenantId !== quote.tenantId || plan.categoryCode !== quote.categoryCode
        || plan.id !== row.planId || plan.version !== row.planVersion || row.workspaceId !== workspaceId
        || plan.appliesTo !== "rental" || !plan.stackableWithOtherPlans
        || !["percentage", "fixed_amount", "threshold_amount"].includes(plan.discountType)
        || !Number.isFinite(plan.discountValue) || plan.discountValue <= 0
        || plan.discountType === "percentage" && plan.discountValue > 100
        || !Number.isFinite(plan.minimumSpend) || plan.minimumSpend < 0
        || plan.discountType === "threshold_amount" && (!Number.isFinite(plan.thresholdAmount) || plan.thresholdAmount! < 0)
        || plan.maximumDiscount !== undefined && (!Number.isFinite(plan.maximumDiscount) || plan.maximumDiscount < 0)
        || !Array.isArray(plan.applicableItemGroupIds) || !Array.isArray(plan.applicableDayTypes)
        || plan.applicablePricingGroupIds !== undefined && !Array.isArray(plan.applicablePricingGroupIds);
    })) throw new ConflictException("原优惠多营销方案身份、叠加或冻结规则不完整");
  const replay = selectDiscountPlans(rows.map(row => structuredClone(row.planSnapshot!)), {
    bases: { rental: quote.rentalAmount, fulfillment: 0, service: 0 }, minimumSpendBase: quote.rentalAmount,
    customerType: quote.request.customerType!, hasCustomer: Boolean(quote.membershipSnapshot),
    itemGroupIds: [line.itemGroupId!], pricingGroupIds: line.pricingGroupId ? [line.pricingGroupId] : [],
    rentalLines: [{ id: line.pricingGroupId ?? line.itemGroupId!, itemGroupId: line.itemGroupId!, pricingGroupId: line.pricingGroupId, amount: quote.rentalAmount }],
    dayTypes: new Set(quote.calendarSnapshot.map(row => row.dayType)), rentalStartAt: quote.request.startAt, workspaceId
  });
  const ordered = replay.evaluations;
  if (ordered.length !== rows.length || ordered.some(expected => {
    const original = rows.find(row => row.planId === expected.planId)!;
    return !expected.applied || !sameExchangeDiscount(original, expected)
      || original.discountAmount !== expected.discountAmount || original.base !== expected.base
      || original.grossAmount !== expected.grossAmount || !isDeepStrictEqual(original.rentalAllocations, expected.rentalAllocations);
  })) throw new ConflictException("原优惠多营销逐层金额无法按冻结组合复算");
  return ordered.map(expected => structuredClone(rows.find(row => row.planId === expected.planId)!));
}

export function exchangeDiscountEvaluations(receipt: LinePricing["discountPricing"]): RentalQuoteDiscountEvaluation[] {
  return !receipt ? [] : receipt.version === 1 ? [receipt.evaluation] : receipt.evaluations;
}

export function sameExchangeDiscounts(left: RentalQuoteDiscountEvaluation[], right: RentalQuoteDiscountEvaluation[]): boolean {
  return Array.isArray(right) && left.length === right.length && left.every((row, index) => sameExchangeDiscount(row, right[index]));
}

/** Independent added time is not entitled to the original rental benefits.
 * The caller must also bind this segment to its effective extension receipt. */
export function isIndependentBenefitFreeSegment(segment: RentalOrderExchangePricingSegment): boolean {
  return segment.source.kind === "extension" && segment.discountBenefit === undefined && segment.discountLayers === undefined
    && segment.couponBenefit === undefined && segment.membershipBenefit === undefined
    && segment.discountSplitBasis === undefined && segment.couponSplitBasis === undefined && segment.membershipSplitBasis === undefined;
}

export function segmentMarketingAmount(segment: RentalOrderExchangePricingSegment): number {
  const layers = segment.discountLayers;
  if (layers !== undefined && (!Array.isArray(layers) || layers.length < 2 || segment.discountBenefit !== undefined
    || layers.some(row => !row || !row.evaluation || !Number.isFinite(row.evaluation.discountAmount) || row.evaluation.discountAmount < 0))) {
    throw new ConflictException("原优惠多营销逐层金额来源不完整");
  }
  return roundMoney(layers?.reduce((sum, row) => sum + row.evaluation.discountAmount, 0)
    ?? segment.discountBenefit?.discountAmount ?? 0);
}

export function segmentDiscountLayers(evaluations: RentalQuoteDiscountEvaluation[], segment: RentalOrderExchangePricingSegment,
  amounts = evaluations.map(row => row.discountAmount)): NonNullable<RentalOrderExchangePricingSegment["discountLayers"]> {
  let base = segment.amount;
  return evaluations.map((evaluation, index) => {
    const applied = segmentDiscount(evaluation, segment, amounts[index]);
    if (applied.discountAmount > base) throw new ConflictException("原优惠多营销逐层减免超出剩余基数");
    applied.base = base;
    base = roundMoney(base - applied.discountAmount);
    return { evaluation: applied };
  });
}

/** Allocate every plan's original cents to the performed prefix, bounded by
 * both sides' remaining base. Rounding a tail cannot grant another budget. */
export function splitSegmentDiscountLayers(segment: RentalOrderExchangePricingSegment, used: RentalOrderExchangePricingSegment) {
  let usedBase = used.amount, remainingBase = roundMoney(segment.amount - used.amount);
  used.discountLayers = segment.discountLayers!.map(layer => {
    const reduction = layer.evaluation.discountAmount;
    const basis = layer.splitBasis ?? { amount: segment.amount, reduction, consumedAmount: 0, consumedReduction: 0 };
    const cumulative = basis.amount > 0 ? roundMoney(basis.reduction * Math.min(1, (basis.consumedAmount + used.amount) / basis.amount)) : 0;
    const amount = Math.max(0, reduction - remainingBase, Math.min(usedBase, reduction, roundMoney(cumulative - basis.consumedReduction)));
    const evaluation = segmentDiscount(layer.evaluation, used, amount); evaluation.base = usedBase;
    usedBase = roundMoney(usedBase - amount); remainingBase = roundMoney(remainingBase - reduction + amount);
    return { evaluation, ...(layer.splitBasis ? { splitBasis: structuredClone(layer.splitBasis) } : {}) };
  });
}

export function remainingSegmentDiscountLayers(segment: RentalOrderExchangePricingSegment, used: RentalOrderExchangePricingSegment,
  tail: RentalOrderExchangePricingSegment) {
  tail.discountLayers = segmentDiscountLayers(segment.discountLayers!.map(row => row.evaluation), tail,
    segment.discountLayers!.map((row, index) => roundMoney(row.evaluation.discountAmount - used.discountLayers![index].evaluation.discountAmount)));
  tail.discountLayers.forEach((row, index) => {
    const original = segment.discountLayers![index];
    const basis = original.splitBasis ?? { amount: segment.amount, reduction: original.evaluation.discountAmount, consumedAmount: 0, consumedReduction: 0 };
    row.splitBasis = { ...basis, consumedAmount: roundMoney(basis.consumedAmount + used.amount),
      consumedReduction: roundMoney(basis.consumedReduction + used.discountLayers![index].evaluation.discountAmount) };
  });
}

/** The selected combination already establishes order and stackability. Each
 * original plan reuses the selector on the upstream remainder and its own cap. */
export function applyReplacementDiscountLayers(evaluations: RentalQuoteDiscountEvaluation[], replacement: RentalOrderExchangePricingSegment,
  retained: RentalOrderExchangePricingSegment[], remaining: RentalOrderExchangePricingSegment[], quote: RentalQuoteSnapshotV1) {
  let base = replacement.amount;
  const tail = remaining.length === 1 ? remaining[0] : undefined;
  replacement.discountLayers = evaluations.map((evaluation, index) => {
    const original = evaluation.planSnapshot!;
    const consumed = roundMoney(retained.reduce((sum, segment) => sum + segment.discountLayers![index].evaluation.discountAmount, 0));
    const plan = { ...structuredClone(original),
      discountValue: original.discountType === "percentage" ? original.discountValue : Math.max(0, roundMoney(original.discountValue - consumed)),
      maximumDiscount: original.maximumDiscount === undefined ? undefined : Math.max(0, roundMoney(original.maximumDiscount - consumed)) };
    const result = selectDiscountPlans([plan], {
      bases: { rental: base, fulfillment: 0, service: 0 }, minimumSpendBase: roundMoney(replacement.amount + retained.reduce((sum, row) => sum + row.amount, 0)),
      customerType: quote.request.customerType!, hasCustomer: Boolean(quote.membershipSnapshot),
      itemGroupIds: [replacement.itemGroupId], pricingGroupIds: replacement.pricingGroupId ? [replacement.pricingGroupId] : [],
      rentalLines: [{ id: replacement.orderLineId, itemGroupId: replacement.itemGroupId, pricingGroupId: replacement.pricingGroupId, amount: base }],
      dayTypes: new Set(replacement.calendarSnapshot.map(row => row.dayType)), rentalStartAt: quote.request.startAt, workspaceId: evaluation.workspaceId
    });
    let amount = result.discountByTarget.rental;
    const old = tail?.discountLayers?.[index];
    if (original.discountType === "percentage" && old && tail!.amount === replacement.amount
      && tail!.billableUnits === replacement.billableUnits && tail!.rate.unit === replacement.rate.unit && old.evaluation.base === base
      && replacementDiscountEligible(evaluation, replacement, retained, quote) && replacementDiscountEligible(evaluation, tail!, retained, quote)
      && Math.abs(roundMoney(amount - old.evaluation.discountAmount)) <= 0.01
      && old.evaluation.discountAmount <= base
      && (plan.maximumDiscount === undefined || old.evaluation.discountAmount <= plan.maximumDiscount)) amount = old.evaluation.discountAmount;
    const applied = segmentDiscount(evaluation, replacement, amount); applied.base = base;
    base = roundMoney(base - amount);
    return { evaluation: applied, ...(old?.splitBasis && old.evaluation.discountAmount === amount && old.evaluation.base === applied.base
      && tail!.amount === replacement.amount && tail!.billableUnits === replacement.billableUnits && tail!.rate.unit === replacement.rate.unit
      ? { splitBasis: structuredClone(old.splitBasis) } : {}) };
  });
}

export function segmentDiscount(evaluation: RentalQuoteDiscountEvaluation, segment: RentalOrderExchangePricingSegment, amount: number): RentalQuoteDiscountEvaluation {
  if (!Number.isFinite(amount) || amount < 0 || amount > segment.amount) throw new ConflictException("原优惠营销逐段减免超出租金");
  return { ...structuredClone(evaluation), grossAmount: segment.amount, base: segment.amount, discountAmount: roundMoney(amount),
    candidateAmount: roundMoney(amount), rentalAllocations: { [segment.orderLineId]: roundMoney(amount) },
    formula: `原方案 ${evaluation.planId}/${evaluation.planVersion}：本段减免 ${roundMoney(amount)}` };
}

export function splitSegmentDiscount(segment: RentalOrderExchangePricingSegment, usedAmount: number): number {
  if (!segment.discountBenefit) return 0;
  const basis = segment.discountSplitBasis ?? { amount: segment.amount, reduction: segment.discountBenefit.discountAmount,
    consumedAmount: 0, consumedReduction: 0 };
  const cumulative = basis.amount > 0 ? roundMoney(basis.reduction * Math.min(1, (basis.consumedAmount + usedAmount) / basis.amount)) : 0;
  return Math.min(segment.discountBenefit.discountAmount, Math.max(0, roundMoney(cumulative - basis.consumedReduction)));
}

export function sameExchangeDiscount(left: RentalQuoteDiscountEvaluation, right: RentalQuoteDiscountEvaluation): boolean {
  return isDeepStrictEqual([left.planId, left.planVersion, left.workspaceId, left.appliesTo, left.planSnapshot],
    [right.planId, right.planVersion, right.workspaceId, right.appliesTo, right.planSnapshot]);
}

/** Reuse the original selector for eligibility, scope and money calculation.
 * Performed amounts only satisfy original order thresholds and consume caps. */
export function replacementDiscount(evaluation: RentalQuoteDiscountEvaluation, segment: RentalOrderExchangePricingSegment,
  retained: readonly RentalOrderExchangePricingSegment[], quote: RentalQuoteSnapshotV1): number {
  const original = evaluation.planSnapshot!;
  const consumed = roundMoney(retained.reduce((sum, row) => sum + row.discountBenefit!.discountAmount, 0));
  const plan = { ...structuredClone(original),
    discountValue: original.discountType === "percentage" ? original.discountValue : Math.max(0, roundMoney(original.discountValue - consumed)),
    maximumDiscount: original.maximumDiscount === undefined ? undefined : Math.max(0, roundMoney(original.maximumDiscount - consumed)) };
  const result = selectDiscountPlans([plan], {
    bases: { rental: segment.amount, fulfillment: 0, service: 0 },
    minimumSpendBase: roundMoney(segment.amount + retained.reduce((sum, row) => sum + row.amount, 0)),
    customerType: quote.request.customerType, hasCustomer: Boolean(quote.membershipSnapshot),
    itemGroupIds: [segment.itemGroupId], pricingGroupIds: segment.pricingGroupId ? [segment.pricingGroupId] : [],
    rentalLines: [{ id: segment.orderLineId, itemGroupId: segment.itemGroupId, pricingGroupId: segment.pricingGroupId, amount: segment.amount }],
    dayTypes: new Set(segment.calendarSnapshot.map(row => row.dayType)), rentalStartAt: quote.request.startAt, workspaceId: evaluation.workspaceId
  });
  return result.discountByTarget.rental;
}

/** A rounded zero does not establish ineligibility. Read the original
 * selector's eligibility evidence without changing a billed reduction. */
export function replacementDiscountEligible(evaluation: RentalQuoteDiscountEvaluation, segment: RentalOrderExchangePricingSegment,
  retained: readonly RentalOrderExchangePricingSegment[], quote: RentalQuoteSnapshotV1): boolean {
  const plan = evaluation.planSnapshot!;
  const result = selectDiscountPlans([structuredClone(plan)], {
    bases: { rental: segment.amount, fulfillment: 0, service: 0 },
    minimumSpendBase: roundMoney(segment.amount + retained.reduce((sum, row) => sum + row.amount, 0)),
    customerType: quote.request.customerType, hasCustomer: Boolean(quote.membershipSnapshot),
    itemGroupIds: [segment.itemGroupId], pricingGroupIds: segment.pricingGroupId ? [segment.pricingGroupId] : [],
    rentalLines: [{ id: segment.orderLineId, itemGroupId: segment.itemGroupId, pricingGroupId: segment.pricingGroupId, amount: segment.amount }],
    dayTypes: new Set(segment.calendarSnapshot.map(row => row.dayType)), rentalStartAt: quote.request.startAt, workspaceId: evaluation.workspaceId
  });
  return result.evaluations.length === 1 && result.evaluations[0].eligibility.every(row => row.passed);
}

export function assertExchangeDiscountPricing(pricing: LinePricing): void {
  const receipt = pricing.discountPricing;
  if (!receipt) {
    if ([...pricing.previousSegments, ...pricing.segments].some(row => row.discountBenefit !== undefined || row.discountLayers !== undefined)) throw new ConflictException("原优惠营销逐段收据缺失");
    return;
  }
  if (receipt.version === 2) {
    const evaluations = receipt.evaluations;
    if (!Array.isArray(evaluations) || evaluations.length < 2
      || evaluations.some(row => !row || typeof row !== "object" || !row.planSnapshot || typeof row.planSnapshot !== "object")
      || new Set(evaluations.map(row => row.planId)).size !== evaluations.length
      || new Set(evaluations.map(row => row.planSnapshot?.exclusiveGroup?.trim() || `__self:${row.planId}`)).size !== evaluations.length
      || evaluations.some((row, index) => !row.planSnapshot || !row.applied || row.appliesTo !== "rental"
        || row.planSnapshot.appliesTo !== "rental" || !row.planSnapshot.stackableWithOtherPlans || !row.workspaceId
        || row.planId !== row.planSnapshot.id || row.planVersion !== row.planSnapshot.version
        || index > 0 && (evaluations[index - 1].planSnapshot!.priority > row.planSnapshot.priority
          || evaluations[index - 1].planSnapshot!.priority === row.planSnapshot.priority
            && evaluations[index - 1].planSnapshot!.code.localeCompare(row.planSnapshot.code) > 0))
      || [receipt.originalReduction, receipt.replacementReduction, receipt.originalNetAmount, receipt.replacementNetAmount].some(value => !Number.isFinite(value) || value < 0)
      || roundMoney(pricing.originalAmount - receipt.originalReduction) !== receipt.originalNetAmount
      || roundMoney(pricing.replacementAmount - receipt.replacementReduction) !== receipt.replacementNetAmount) {
      throw new ConflictException("原优惠多营销身份、顺序或净额收据不完整");
    }
    for (const [segments, total] of [[pricing.previousSegments, receipt.originalReduction], [pricing.segments, receipt.replacementReduction]] as const) {
      for (const segment of segments) {
        if (isIndependentBenefitFreeSegment(segment)) continue;
        const layers = segment.discountLayers;
        if (segment.discountBenefit !== undefined || segment.discountSplitBasis !== undefined || !Array.isArray(layers) || layers.length !== evaluations.length
          || layers.some(row => !row || typeof row !== "object" || !row.evaluation || typeof row.evaluation !== "object")) {
          throw new ConflictException("原优惠多营销逐段来源缺失或混用旧收据");
        }
        let base = segment.amount;
        layers.forEach((layer, index) => {
          const applied = layer.evaluation, basis = layer.splitBasis;
          if (!applied || !sameExchangeDiscount(evaluations[index], applied) || !Number.isFinite(applied.discountAmount)
            || applied.discountAmount < 0 || applied.discountAmount > base || applied.base !== base || applied.grossAmount !== segment.amount
            || !isDeepStrictEqual(applied.rentalAllocations, { [pricing.orderLineId]: applied.discountAmount })
            || basis && ([basis.amount, basis.reduction, basis.consumedAmount, basis.consumedReduction].some(value => !Number.isFinite(value) || value < 0)
              || basis.reduction > basis.amount || basis.consumedAmount + segment.amount > basis.amount + 0.005
              || basis.consumedReduction + applied.discountAmount > basis.reduction + 0.005)) {
            throw new ConflictException("原优惠多营销逐层基数、分摊或累计减免不一致");
          }
          base = roundMoney(base - applied.discountAmount);
        });
      }
      if (roundMoney(segments.reduce((sum, row) => sum + segmentMarketingAmount(row), 0)) !== total) throw new ConflictException("原优惠多营销分段总额不一致");
      evaluations.forEach((evaluation, index) => {
        const plan = evaluation.planSnapshot!, amount = roundMoney(segments.reduce((sum, row) => sum + (row.discountLayers?.[index].evaluation.discountAmount ?? 0), 0));
        if (plan.maximumDiscount !== undefined && amount > plan.maximumDiscount || plan.discountType !== "percentage" && amount > plan.discountValue) {
          throw new ConflictException("原优惠多营销方案重复授予固定额或封顶预算");
        }
      });
    }
    return;
  }
  if (receipt.version !== 1 || [...pricing.previousSegments, ...pricing.segments].some(row => row.discountLayers !== undefined)) {
    throw new ConflictException("原优惠营销收据版本不一致");
  }
  const evaluation = receipt.evaluation, plan = evaluation?.planSnapshot;
  if (receipt.version !== 1 || !plan || !evaluation.applied || evaluation.appliesTo !== "rental" || plan.appliesTo !== "rental"
    || plan.id !== evaluation.planId || plan.version !== evaluation.planVersion || !evaluation.workspaceId
    || [receipt.originalReduction, receipt.replacementReduction, receipt.originalNetAmount, receipt.replacementNetAmount].some(value => !Number.isFinite(value) || value < 0)
    || roundMoney(pricing.originalAmount - receipt.originalReduction) !== receipt.originalNetAmount
    || roundMoney(pricing.replacementAmount - receipt.replacementReduction) !== receipt.replacementNetAmount
    || plan.maximumDiscount !== undefined && (receipt.originalReduction > plan.maximumDiscount || receipt.replacementReduction > plan.maximumDiscount)
    || plan.discountType !== "percentage" && (receipt.originalReduction > plan.discountValue || receipt.replacementReduction > plan.discountValue)) {
    throw new ConflictException("原优惠营销净额与毛租金或规则不一致");
  }
  for (const [segments, total] of [[pricing.previousSegments, receipt.originalReduction], [pricing.segments, receipt.replacementReduction]] as const) {
    for (const segment of segments) {
      if (isIndependentBenefitFreeSegment(segment)) continue;
      const benefit = segment.discountBenefit, basis = segment.discountSplitBasis;
      if (!benefit || !sameExchangeDiscount(evaluation, benefit) || !Number.isFinite(benefit.discountAmount) || benefit.discountAmount < 0
        || benefit.discountAmount > segment.amount || benefit.base !== segment.amount || benefit.grossAmount !== segment.amount
        || !isDeepStrictEqual(benefit.rentalAllocations, { [pricing.orderLineId]: benefit.discountAmount })
        || basis && ([basis.amount, basis.reduction, basis.consumedAmount, basis.consumedReduction].some(value => !Number.isFinite(value) || value < 0)
          || basis.reduction > basis.amount || basis.consumedAmount + segment.amount > basis.amount + 0.005
          || basis.consumedReduction + benefit.discountAmount > basis.reduction + 0.005)) {
        throw new ConflictException("原优惠营销分段来源或累计减免不一致");
      }
    }
    if (roundMoney(segments.reduce((sum, row) => sum + (row.discountBenefit?.discountAmount ?? 0), 0)) !== total) throw new ConflictException("原优惠营销分段减免与总额不一致");
  }
}

export function assertExchangeDiscountChange(change: RentalOrderChange, pricing: LinePricing): void {
  assertExchangeDiscountPricing(pricing);
  const receipt = pricing.discountPricing;
  if (!receipt) return;
  const added = change.diff.addedServices as Array<{ amount: number }> | undefined;
  const cancelled = change.diff.cancelledServices as Array<{ refundAmount: number }> | undefined;
  if (added !== undefined && !Array.isArray(added) || cancelled !== undefined && !Array.isArray(cancelled)
    || added?.some(row => !row || !Number.isFinite(row.amount) || row.amount < 0)
    || cancelled?.some(row => !row || !Number.isFinite(row.refundAmount) || row.refundAmount < 0)) throw new ConflictException("原优惠营销换货服务来源无效");
  const downstreamDelta = [pricing.couponPricing, pricing.membershipPricing].reduce((sum, row) => sum
    + (row ? row.replacementReduction - row.originalReduction : 0), 0);
  const difference = roundMoney(receipt.replacementNetAmount - receipt.originalNetAmount - downstreamDelta
    + (added ?? []).reduce((sum, row) => sum + row.amount, 0) - (cancelled ?? []).reduce((sum, row) => sum + row.refundAmount, 0));
  if (change.diff.differenceAmount !== difference || change.additionalAmount !== Math.max(0, difference) || change.refundAmount !== Math.max(0, -difference)) {
    throw new ConflictException("原优惠营销净额与已入账换货差额不一致");
  }
}
