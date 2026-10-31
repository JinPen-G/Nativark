import { ConflictException } from "@nestjs/common";
import { RentalInventoryMode, RENTAL_PRICING_UNIT_CODES, type RentalIncrementalPricingSnapshot, type RentalOrderLine,
  type RentalOrder, type RentalOrderExchangePricingSegment, type RentalPricingRate } from "@rental-os/shared";
import { isValidTimeZone } from "./rental-business-day";
import { roundMoney } from "./rental-money";

/** Validate persisted billed periods before reuse. This does not reconstruct a
 * missing receipt, authorize an exchange, or calculate a new price. */
export function assertExchangePricingSegments(segments: readonly RentalOrderExchangePricingSegment[],
  orderLineId: string, quantity: number, startAt: string, endAt: string, amount: number) {
  if (!Array.isArray(segments) || !segments.length || !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt))
    || !Number.isFinite(amount) || amount < 0 || !Number.isInteger(quantity) || quantity < 1) {
    throw new ConflictException("换货缺少有效的稳定行计价段");
  }
  let cursor = Date.parse(startAt);
  for (const segment of segments) {
    if (!segment || typeof segment !== "object" || segment.orderLineId !== orderLineId || segment.quantity !== quantity || !segment.itemGroupId
      || Date.parse(segment.startAt) !== cursor || !Number.isFinite(Date.parse(segment.endAt)) || Date.parse(segment.endAt) <= cursor
      || !segment.source?.id || !segment.source.priceVersion || !["quote", "extension", "price_version"].includes(segment.source.kind)
      || !segment.rate || !segment.context?.timeZone || !Array.isArray(segment.context.calendars)
      || typeof segment.context.legacyDayTypeMultipliers !== "boolean" || !segment.ruleSnapshot
      || !Array.isArray(segment.calendarSnapshot) || typeof segment.applyMinimumUnits !== "boolean"
      || [segment.amount, segment.billableUnits, segment.billedHours, segment.selectedUnitAmount].some(value => !Number.isFinite(value) || value < 0)
      || segment.amount > 0 && (segment.billableUnits <= 0 || segment.billedHours <= 0)) {
      throw new ConflictException("换货原计价段的稳定行、期间或金额不一致");
    }
    const origin = segment.splitBasis;
    if (origin && (Date.parse(origin.startAt) > Date.parse(segment.startAt) || Date.parse(origin.endAt) < Date.parse(segment.endAt)
      || !Number.isFinite(Date.parse(origin.startAt)) || !Number.isFinite(Date.parse(origin.endAt))
      || typeof origin.applyMinimumUnits !== "boolean"
      || [origin.amount, origin.billableUnits, origin.billedHours, origin.consumedAmount, origin.consumedUnits, origin.consumedHours]
        .some(value => !Number.isFinite(value) || value < 0)
      || origin.consumedAmount + segment.amount > origin.amount + 0.005
      || origin.consumedUnits + segment.billableUnits > origin.billableUnits
      || origin.consumedHours + segment.billedHours > origin.billedHours)) {
      throw new ConflictException("原价保留段与原已购计费块不一致");
    }
    cursor = Date.parse(segment.endAt);
  }
  if (cursor !== Date.parse(endAt) || roundMoney(segments.reduce((sum, segment) => sum + segment.amount, 0)) !== roundMoney(amount)) {
    throw new ConflictException("换货原计价段与约定租期或原租金不一致");
  }
}

/** Original extension receipts retain a separate amount/context shape: adding
 * it must not make an incremental extension enter original-total settlement. */
export function assertIncrementalPricingSnapshot(snapshot: RentalIncrementalPricingSnapshot,
  rentalAmount: number, billableUnits: number,
  binding?: { tenantId: string; startAt: string; endAt: string; lines: readonly RentalOrderLine[]; rates: readonly RentalPricingRate[];
    exchangeIds?: ReadonlyMap<string, string> }) {
  if (!snapshot || snapshot.version !== 1 || typeof snapshot.startAt !== "string" || typeof snapshot.endAt !== "string"
    || !Number.isFinite(Date.parse(snapshot.startAt)) || !Number.isFinite(Date.parse(snapshot.endAt)) || Date.parse(snapshot.endAt) <= Date.parse(snapshot.startAt)
    || typeof snapshot.context?.timeZone !== "string"
    || !snapshot.context.timeZone || !isValidTimeZone(snapshot.context.timeZone)
    || !Array.isArray(snapshot.context.calendars) || snapshot.context.calendars.some(row => !row || typeof row !== "object"
      || !row.tenantId || !Number.isInteger(row.year) || !row.version || !Array.isArray(row.days))
    || snapshot.context.dayRates !== undefined && (!Array.isArray(snapshot.context.dayRates)
      || snapshot.context.dayRates.some(row => !row || typeof row !== "object" || row.unit !== "day_24h"))
    || typeof snapshot.context.legacyDayTypeMultipliers !== "boolean"
    || !Number.isFinite(rentalAmount) || rentalAmount < 0 || !Number.isFinite(billableUnits) || billableUnits < 0
    || !Array.isArray(snapshot.lines) || snapshot.lines.some(row => !row || typeof row !== "object"
      || typeof row.itemGroupId !== "string" || !row.itemGroupId
      || row.orderLineId !== undefined && (typeof row.orderLineId !== "string" || !row.orderLineId)
      || row.pricingGroupId !== undefined && (typeof row.pricingGroupId !== "string" || !row.pricingGroupId)
      || row.exchangeId !== undefined && (typeof row.exchangeId !== "string" || !row.exchangeId)
      || !RENTAL_PRICING_UNIT_CODES.includes(row.pricingUnit)
      || !Number.isInteger(row.quantity) || row.quantity < 1
      || [row.amount, row.billableUnits, row.billedHours, row.selectedUnitAmount].some(value => !Number.isFinite(value) || value < 0)
      || row.amount > 0 && row.billableUnits <= 0)
    || new Set(snapshot.lines.filter(row => row.orderLineId).map(row => row.orderLineId)).size
      !== snapshot.lines.filter(row => row.orderLineId).length
    || !Number.isFinite(snapshot.lines.reduce((sum, row) => sum + row.amount, 0))
    || roundMoney(snapshot.lines.reduce((sum, row) => sum + row.amount, 0)) !== roundMoney(rentalAmount)
    || snapshot.lines.reduce((sum, row) => sum + row.billableUnits, 0) !== billableUnits) {
    throw new ConflictException("原独立续租逐行金额、单位或计价上下文不一致");
  }
  if (!binding) return;
  // An optional id can describe an old read receipt, but cannot authorize a new
  // commit. Every still-rented line must be present exactly once; consumables
  // have already been consumed and must not be charged again by this source.
  const lines = binding.lines.filter(row => row.inventoryMode !== RentalInventoryMode.Consumable
    && (row.cancelledQuantity ?? 0) < row.quantity);
  if (Date.parse(snapshot.startAt) !== Date.parse(binding.startAt) || Date.parse(snapshot.endAt) !== Date.parse(binding.endAt)
    || !Array.isArray(binding.rates) || binding.rates.some(row => !row || typeof row !== "object")
    || snapshot.context.calendars.some(row => row.tenantId !== binding.tenantId)
    || snapshot.lines.length !== lines.length || lines.some(row => typeof row.id !== "string" || !row.id)
    || new Set(lines.map(row => row.id)).size !== lines.length
    || snapshot.lines.some(row => {
      const line = lines.find(item => item.id === row.orderLineId);
      const rates = binding.rates.filter(rate => (rate.pricingGroupId ?? rate.itemGroupId) === (row.pricingGroupId ?? row.itemGroupId)
        && rate.unit === row.pricingUnit);
      return !line || line.itemGroupId !== row.itemGroupId || line.pricingGroupId !== row.pricingGroupId
        || line.quantity - (line.cancelledQuantity ?? 0) !== row.quantity || rates.length !== 1
        || (row.pricingUnit === "usage" || row.pricingUnit === "package"
          ? row.billedHours !== 0 : row.billableUnits > 0 && row.billedHours <= 0);
    })) throw new ConflictException("独立续租收据与原订单稳定行、费率或租户不一致");
  if (binding.exchangeIds && snapshot.lines.some(row => row.exchangeId !== binding.exchangeIds!.get(row.orderLineId!))) {
    throw new ConflictException("独立续租收据的换货来源已变化，请重新试算");
  }
}

/** Current held exchange ids are facts, not a client choice. Same-target
 * exchanges still invalidate pending extensions made before that exchange. */
export function currentExchangePricingIds(order: Pick<RentalOrder, "allocations">): Map<string, string> {
  const ids = new Map<string, string>();
  for (const allocation of order.allocations.filter(row => ["picked_up", "locked"].includes(row.status))) {
    const exchangeId = allocation.metadata?.exchangeId;
    if (!exchangeId) continue;
    if (!allocation.orderLineId || typeof exchangeId !== "string" || ids.has(allocation.orderLineId)
      && ids.get(allocation.orderLineId) !== exchangeId) throw new ConflictException("当前稳定行存在不一致的换货分配来源");
    ids.set(allocation.orderLineId, exchangeId);
  }
  return ids;
}
