import { ConflictException } from "@nestjs/common";
import type { RentalCalendarYear, RentalOrderExtension, RentalPricingRate, RentalQuoteCalendarDay, RentalRepricingContext } from "@rental-os/shared";
import { hasOriginalRentalCurrency, roundMoney } from "./rental-money";
import { businessDateKey, businessDateKeyFromIndex, businessDayIndex, isValidTimeZone } from "./rental-business-day";

/** Validate the effective original-total receipt chain before consuming its
 * latest context. A missing successor must not fall back to the initial quote. */
export function assertOriginalTotalExtensionReceipts(tenantId: string, workspaceId: string,
  order: { id: string; endAt: string }, dueAt: string, currency: unknown, rows: readonly RentalOrderExtension[],
  original: { rentalAmount: number; serviceAmount: number; fulfillmentAmount: number }): void {
  let cursor = Date.parse(order.endAt), sequence = 0;
  let rentalAmount = original.rentalAmount, serviceAmount = original.serviceAmount;
  if ([rentalAmount, serviceAmount, original.fulfillmentAmount].some(value => !Number.isFinite(value) || value < 0)) {
    throw new ConflictException("原报价金额分项无效，不能核对后继续租收据");
  }
  const ids = new Set<string>();
  if (!Number.isFinite(cursor) || !Number.isFinite(Date.parse(dueAt))) throw new ConflictException("原续租计价期间无效");
  for (const row of rows) {
    if (!row || row.status !== "effective" || row.tenantId !== tenantId || row.workspaceId !== workspaceId || row.orderId !== order.id
      || typeof row.id !== "string" || !row.id || ids.has(row.id) || !Number.isInteger(row.sequence) || row.sequence <= sequence
      || !hasOriginalRentalCurrency(currency, row.currency) || Date.parse(row.originalEndAt) !== cursor
      || !Number.isFinite(Date.parse(row.newEndAt)) || Date.parse(row.newEndAt) <= cursor
      || !row.pricingSnapshot || row.pricingSnapshot.method !== "original_version_difference"
      || row.pricingSnapshot.scope !== undefined && row.pricingSnapshot.scope !== "order"
      || row.executionBasis?.pricingMode !== undefined && row.executionBasis.pricingMode !== "original_total"
      || row.executionBasis?.incrementalPricing !== undefined) {
      throw new ConflictException("原全租期续租收据缺失或与本订单空间、期间、模式不一致，不能退回原报价重算");
    }
    const snapshot = row.pricingSnapshot;
    const review = snapshot.refundReview;
    const amounts = [row.rentalAmount, row.serviceAmount, row.payableAmount, row.depositDelta, row.preAuthDelta, row.billableUnits,
      snapshot.previousPayableAmount, snapshot.recalculatedPayableAmount, snapshot.recalculatedRentalAmount,
      snapshot.recalculatedServiceAmount, snapshot.recalculatedDiscountAmount, snapshot.recalculatedCouponAmount, snapshot.totalBillableUnits];
    if (amounts.some(value => !Number.isFinite(value))
      || amounts.slice(1).some(value => value < 0)
      || !Number.isFinite(snapshot.differenceAmount)
      || row.payableAmount !== roundMoney(Math.max(0, snapshot.differenceAmount))
      || roundMoney(snapshot.recalculatedPayableAmount - snapshot.previousPayableAmount) !== roundMoney(snapshot.differenceAmount)
      || roundMoney(snapshot.recalculatedRentalAmount + snapshot.recalculatedServiceAmount + original.fulfillmentAmount
        - snapshot.recalculatedDiscountAmount - snapshot.recalculatedCouponAmount) !== roundMoney(snapshot.recalculatedPayableAmount)
      || roundMoney(rentalAmount + row.rentalAmount) !== roundMoney(snapshot.recalculatedRentalAmount)
      || roundMoney(serviceAmount + row.serviceAmount) !== roundMoney(snapshot.recalculatedServiceAmount)
      || !Array.isArray(snapshot.chargeLines) || snapshot.chargeLines.some(line => !line || !Number.isFinite(line.amount))
      || roundMoney(snapshot.chargeLines.reduce((sum, line) => sum + line.amount, 0)) !== roundMoney(snapshot.differenceAmount)
      || !Array.isArray(snapshot.fullChargeLines) || snapshot.fullChargeLines.some(line => !line || !Number.isFinite(line.amount))
      || roundMoney(snapshot.fullChargeLines.filter(line => line.type === "rental").reduce((sum, line) => sum + line.amount, 0))
        !== roundMoney(snapshot.recalculatedRentalAmount)
      || snapshot.differenceAmount < 0 && (!review || !Number.isFinite(review.amount)
        || review.amount !== roundMoney(-snapshot.differenceAmount) || !["pending", "approved", "rejected", "superseded"].includes(review.status))
      || snapshot.differenceAmount >= 0 && review !== undefined) {
      throw new ConflictException("原全租期续租金额与重算/核减收据不一致，不能按坏余额继续核价");
    }
    rentalAmount = snapshot.recalculatedRentalAmount; serviceAmount = snapshot.recalculatedServiceAmount;
    ids.add(row.id); sequence = row.sequence; cursor = Date.parse(row.newEndAt);
  }
  if (cursor !== Date.parse(dueAt)) throw new ConflictException("原全租期续租记录与当前归还时间不一致，不能猜测已计期间");
}

/** Restore billed years only from the original context or exact version refs.
 * A newly reached year may obtain its first calendar through the caller, then
 * becomes frozen history. That callback cannot repair a missing billed year. */
export function restoreRentalRepricingContext(tenantId: string, args: {
  context?: RentalRepricingContext;
  startAt: string;
  endAt: string;
  references: readonly RentalQuoteCalendarDay[];
  historicalCalendars: readonly RentalCalendarYear[];
  rates: readonly RentalPricingRate[];
  billedEndAt: string;
  newYearCalendar?: (year: number, timeZone: string) => RentalCalendarYear;
}): RentalRepricingContext {
  const saved = args.context;
  if (!saved || typeof saved.timeZone !== "string" || !saved.timeZone || !isValidTimeZone(saved.timeZone)
    || typeof saved.legacyDayTypeMultipliers !== "boolean" || !Array.isArray(saved.calendars)
    || saved.dayRates !== undefined && (!Array.isArray(saved.dayRates) || saved.dayRates.some(row => !row || row.unit !== "day_24h"))
    || !Array.isArray(args.references) || args.references.some(row => !row || !Number.isInteger(row.year))
    || !Array.isArray(args.historicalCalendars) || args.historicalCalendars.some(row => !row || typeof row !== "object")
    || !Array.isArray(args.rates) || args.rates.some(row => !row || typeof row !== "object")
    || !Number.isFinite(Date.parse(args.startAt)) || !Number.isFinite(Date.parse(args.endAt))
    || !Number.isFinite(Date.parse(args.billedEndAt))
    || Date.parse(args.endAt) <= Date.parse(args.startAt)) {
    throw new ConflictException("原计价时区或日历上下文缺失，不能按当前配置自动重算");
  }
  if (saved.calendars.some(row => !row || row.tenantId !== tenantId || !Number.isInteger(row.year)
    || typeof row.version !== "string" || !row.version || !Array.isArray(row.days)
    || !["draft", "published", "superseded"].includes(row.status))
    || new Set(saved.calendars.map(row => row.year)).size !== saved.calendars.length) {
    throw new ConflictException("原计价日历来源不属于本租户或同年度存在歧义");
  }
  const first = businessDayIndex(args.startAt, saved.timeZone);
  const last = businessDayIndex(new Date(Date.parse(args.endAt) - 1).toISOString(), saved.timeZone);
  const firstYear = Number(businessDateKey(args.startAt, saved.timeZone).slice(0, 4));
  const lastYear = Number(businessDateKeyFromIndex(last).slice(0, 4));
  const billedYear = Number(businessDateKey(new Date(Date.parse(args.billedEndAt) - 1).toISOString(), saved.timeZone).slice(0, 4));
  const calendars: RentalCalendarYear[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const snapshot = saved.calendars.find(row => row.year === year);
    if (snapshot) { calendars.push(structuredClone(snapshot)); continue; }
    if (year > billedYear && args.newYearCalendar) {
      const added = args.newYearCalendar(year, saved.timeZone);
      if (!added || added.tenantId !== tenantId || added.year !== year || !added.version || !Array.isArray(added.days)
        || !["published", "draft"].includes(added.status)) throw new ConflictException("新增续租年度日历来源无效");
      calendars.push(structuredClone(added)); continue;
    }
    const versions = [...new Set(args.references.filter(row => row.year === year).map(row => row.calendarVersion))];
    if (versions.length !== 1 || !versions[0] || versions[0] === "draft") {
      throw new ConflictException("原计价年度缺少唯一历史日历引用，不能用当前日历补齐");
    }
    const candidates = args.historicalCalendars.filter(row => row.tenantId === tenantId && row.year === year
      && row.version === versions[0] && ["published", "superseded"].includes(row.status));
    if (candidates.length !== 1 || !Array.isArray(candidates[0].days)) {
      throw new ConflictException("原日历引用的历史版本不可用，不能用当前日历补齐");
    }
    calendars.push(structuredClone(candidates[0]));
  }
  const rates: RentalPricingRate[] = [...args.rates, ...(saved.dayRates ?? [])];
  for (let index = first; index <= last; index++) {
    const date = businessDateKeyFromIndex(index);
    const calendar = calendars.find(row => row.year === Number(date.slice(0, 4)))!;
    const days = calendar.days.filter(row => row && row.date === date);
    if (days.length !== 1) throw new ConflictException("原日历缺少唯一计价日期，不能视为普通工作日");
    const day = days[0];
    if (!["workday", "weekend", "statutory_holiday", "makeup_workday", "tenant_special"].includes(day.dayType)
      || !["week_rule", "official_cn", "tenant_override"].includes(day.source)
      || !Number.isFinite(day.pricingMultiplier) || day.pricingMultiplier < 0
      || typeof day.closed !== "boolean"
      || day.businessStatus !== undefined && !["open", "limited", "closed", "self_service"].includes(day.businessStatus)
      || day.pricingOverrideRef !== undefined && (typeof day.pricingOverrideRef !== "string" || !day.pricingOverrideRef.trim())) {
      throw new ConflictException("原日历计价日期来源无效，不能降为基础价或普通营业");
    }
    const reference = day.pricingOverrideRef;
    // The calendar's reference may target only some products. It must resolve
    // in the original version, not necessarily on every product's rate.
    if (reference && !rates.some(rate => rate.datetimeOverrides?.some(row => row.id === reference))) {
      throw new ConflictException("原日历价格覆盖引用无法匹配原价格版本，不能降为基础价");
    }
  }
  return { ...structuredClone(saved), calendars };
}
