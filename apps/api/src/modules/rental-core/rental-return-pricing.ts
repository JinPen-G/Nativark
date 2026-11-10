import { ConflictException } from "@nestjs/common";
import type { RentalOrder, RentalOrderChange, RentalOrderExchangeExecutionBasis, RentalOrderExchangePricingSegment, RentalPricingRate, RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { roundMoney } from "./rental-money";
import { exchangeBasis } from "./rental-exchange-inspection";
import { assertExchangePricingSegments } from "./rental-exchange-pricing-source";

interface ReturnPricingSlice {
  quote: RentalQuoteSnapshotV1;
  quantities: Record<string, number>;
  billedLinePricing?: RentalOrderExchangePricingSegment;
}

/** Match actual returnable allocations to their immutable price source. This
 * projects calculation inputs only; never changes the order, quote or receipt. */
export function returnPricingSlices(tenantId: string, workspaceId: string, quote: RentalQuoteSnapshotV1,
  order: RentalOrder, changes: readonly RentalOrderChange[], items?: readonly { allocationId: string; quantity: number }[],
  extendedSources?: ReadonlyMap<string, readonly RentalOrderExchangePricingSegment[]>): ReturnPricingSlice[] {
  if (quote.tenantId !== tenantId || order.tenantId !== tenantId || quote.id !== order.quoteId) {
    throw new ConflictException("归还计价来源不属于原订单");
  }
  const returnable = order.allocations.filter(row => row.status === "picked_up" || row.status === "locked" && row.metadata?.exchangeId);
  const selected = items ? items.map(item => {
    const allocation = returnable.find(row => row.id === item.allocationId);
    if (!allocation || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > allocation.quantity) {
      throw new ConflictException("归还计价数量与本批实际分配不一致");
    }
    return { allocation, quantity: item.quantity };
  }) : returnable.map(allocation => ({ allocation, quantity: allocation.quantity }));
  if (items && new Set(items.map(row => row.allocationId)).size !== items.length) throw new ConflictException("归还计价分配不可重复");
  const originalQuantities: Record<string, number> = {};
  const wholeBundles = new Set<string>();
  const replacements = new Map<string, { basis: RentalOrderExchangeExecutionBasis; change: RentalOrderChange; line: RentalOrder["lines"][number]; quantity: number }>();
  for (const { allocation, quantity } of selected) {
    const line = order.lines.find(row => row.id === allocation.orderLineId);
    if (!line || !Number.isInteger(quantity) || quantity < 1) throw new ConflictException("归还计价缺少稳定订单行");
    const target = line.pricingGroupId ?? line.itemGroupId;
    if (!allocation.metadata?.exchangeId) {
      if (!quote.request.lines.some(row => (row.pricingGroupId ?? row.itemGroupId) === target)) {
        throw new ConflictException("归还商品已变更但缺少原换货计价来源");
      }
      if (line.inventoryMode === 'bundle') {
        if (items || order.allocations.some(row => row.orderLineId === line.id && row.status === 'returned')) {
          throw new ConflictException('套装组件分批缺少冻结租金分摊，须按原归还批次人工核价');
        }
        if (!wholeBundles.has(line.id)) {
          originalQuantities[target] = (originalQuantities[target] ?? 0) + line.quantity - (line.cancelledQuantity ?? 0);
          wholeBundles.add(line.id);
        }
      } else originalQuantities[target] = (originalQuantities[target] ?? 0) + quantity;
      continue;
    }
    const change = changes.find(row => row.id === allocation.metadata?.exchangeId);
    const basis = change && exchangeBasis(change);
    const exchange = change?.diff.exchange as { orderLineId?: string; replacementItemGroupId?: string; replacementPricingGroupId?: string } | undefined;
    if (!change || change.tenantId !== tenantId || change.workspaceId !== workspaceId || change.orderId !== order.id
      || !basis || exchange?.orderLineId !== line.id || exchange.replacementItemGroupId !== line.itemGroupId
      || exchange.replacementPricingGroupId !== line.pricingGroupId || allocation.itemGroupId !== line.itemGroupId) {
      throw new ConflictException("换货归还缺少一致的原计价收据，不能套用原商品或现价");
    }
    const key = `${line.id}:${change.id}`;
    const part = replacements.get(key) ?? { basis, change, line, quantity: 0 };
    part.quantity += quantity;
    if (part.quantity > line.quantity - (line.cancelledQuantity ?? 0)) throw new ConflictException("归还计价数量超过有效订单行");
    replacements.set(key, part);
  }
  const slices: ReturnPricingSlice[] = Object.keys(originalQuantities).length ? [{ quote, quantities: originalQuantities }] : [];
  for (const { basis, change, line, quantity } of replacements.values()) {
    const before = change.beforeSnapshot.line as RentalOrder["lines"][number] | undefined;
    const exchange = change.diff.exchange as { originalItemGroupId?: string; replacementAmount?: number };
    if (!before || before.id !== line.id || before.itemGroupId !== exchange.originalItemGroupId || before.quantity !== line.quantity) {
      throw new ConflictException("换货归还缺少原稳定行快照");
    }
    const target = line.pricingGroupId ?? line.itemGroupId;
    const oldTarget = before.pricingGroupId ?? before.itemGroupId;
    const linePricing = basis.linePricing;
    const extended = extendedSources?.get(line.id);
    const billed = extended?.at(-1) ?? linePricing?.overdueBasis;
    if (linePricing) {
      if (linePricing.version !== 1 || linePricing.orderLineId !== line.id || !Array.isArray(linePricing.segments) || !billed
        || billed.itemGroupId !== line.itemGroupId || billed.pricingGroupId !== line.pricingGroupId
        || linePricing.replacementAmount !== exchange.replacementAmount || roundMoney(line.amount) !== linePricing.replacementAmount
        || !extended && (order.effectiveEndAt ?? order.endAt) !== linePricing.segments.at(-1)?.endAt) {
        throw new ConflictException("换货归还的计价段与当前行或约定终点不一致，须核对续租来源");
      }
      assertExchangePricingSegments(linePricing.segments, line.id, line.quantity, order.startAt,
        linePricing.segments.at(-1)!.endAt, linePricing.replacementAmount);
      assertExchangePricingSegments([billed], line.id, line.quantity, billed.startAt, billed.endAt, billed.amount);
      if (extended) {
        const prefix = extended.slice(0, linePricing.segments.length);
        assertExchangePricingSegments(prefix, line.id, line.quantity, order.startAt, linePricing.segments.at(-1)!.endAt, linePricing.replacementAmount);
        assertExchangePricingSegments(extended, line.id, line.quantity, order.startAt, order.effectiveEndAt ?? order.endAt,
          roundMoney(extended.reduce((sum, row) => sum + row.amount, 0)));
      }
    }
    const sourceTarget = billed ? billed.rate.pricingGroupId ?? billed.rate.itemGroupId
      : basis.priceBasis === "original_order_price" ? oldTarget : target;
    const rate = billed ? [billed.rate] : basis.rateSnapshot.filter(row => (row.pricingGroupId ?? row.itemGroupId) === sourceTarget);
    if (rate.length !== 1 || !Number.isFinite(exchange.replacementAmount) || exchange.replacementAmount! < 0
      || !Number.isFinite(Date.parse(basis.effectiveFrom)) || !Number.isFinite(Date.parse(change.appliedAt ?? ""))) {
      throw new ConflictException("换货归还缺少唯一费率或原租金金额，须人工核定");
    }
    const pricingContext = billed?.context ?? basis.pricingSnapshot?.context
      ?? (basis.priceBasis === "original_order_price" ? quote.pricingContext : undefined);
    if (!pricingContext || !pricingContext.timeZone || !Array.isArray(pricingContext.calendars)
      || typeof pricingContext.legacyDayTypeMultipliers !== "boolean") {
      throw new ConflictException("换货归还缺少原计价日历与时区依据");
    }
    // Original-price exchange keeps the frozen old rate but maps it to the
    // stable returned line. The target alias does not change any price value.
    const alias = (row: RentalPricingRate): RentalPricingRate => ({ ...structuredClone(row), itemGroupId: line.itemGroupId,
      itemGroupCode: line.itemGroupCode, pricingGroupId: line.pricingGroupId, pricingGroupCode: line.pricingGroupCode });
    const selectedRate = alias(rate[0]);
    const amount = roundMoney(billed?.amount ?? exchange.replacementAmount!);
    const code = `rental:${line.pricingGroupCode ?? line.itemGroupCode}`;
    const requestLine = { itemGroupId: line.itemGroupId, pricingGroupId: line.pricingGroupId,
      quantity: line.quantity, pricingUnit: selectedRate.unit };
    slices.push({ quantities: { [target]: quantity }, billedLinePricing: billed && structuredClone(billed), quote: { ...structuredClone(quote),
      request: { ...structuredClone(quote.request), ...(billed ? { startAt: billed.startAt, endAt: billed.endAt } : {}), lines: [requestLine] },
      ...(billed ? { priceVersionId: billed.source.priceVersionId, priceVersion: billed.source.priceVersion } : {}),
      rateSnapshot: [selectedRate], rentalAmount: amount, rentalLineAmounts: { [target]: amount },
      chargeLines: [{ code, name: `${line.itemGroupName}原换货租金`, type: "rental", amount }],
      pricingContext: { ...structuredClone(pricingContext),
        dayRates: [...(pricingContext.dayRates ?? []), ...(billed ? [billed.rate] : basis.rateSnapshot)].filter(row =>
          (row.pricingGroupId ?? row.itemGroupId) === sourceTarget && row.unit === "day_24h").map(alias) } } });
  }
  return slices;
}
