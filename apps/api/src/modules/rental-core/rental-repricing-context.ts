import { ConflictException } from "@nestjs/common";
import type { RentalCalendarYear, RentalOrder, RentalOrderExtension, RentalPricingRate, RentalQuoteCalendarDay, RentalQuoteChargeLine, RentalQuoteSnapshotV1, RentalRepricingContext } from "@rental-os/shared";
import { hasOriginalRentalCurrency, roundMoney } from "./rental-money";
import { businessDateKey, businessDateKeyFromIndex, businessDayIndex, isValidTimeZone } from "./rental-business-day";

/** A present gross target map is a receipt, not a hint. Legacy absence stays
 * absent; callers must not repair malformed maps from display codes. */
export function assertRentalTargetAmounts(
  snapshot: Pick<NonNullable<RentalOrderExtension["pricingSnapshot"]>, "rentalLineAmounts" | "recalculatedRentalAmount">,
  targets: readonly string[]
): void {
  if (snapshot.rentalLineAmounts === undefined) return;
  const map = snapshot.rentalLineAmounts, expected = new Set(targets);
  if (!map || typeof map !== "object" || Array.isArray(map)
    || targets.some(target => typeof target !== "string" || !target)
    || Object.keys(map).length !== expected.size || Object.keys(map).some(target => !expected.has(target))
    || !Number.isFinite(snapshot.recalculatedRentalAmount) || snapshot.recalculatedRentalAmount < 0
    || Object.values(map).some(amount => !Number.isFinite(amount) || amount < 0)
    || roundMoney(Object.values(map).reduce((sum, amount) => sum + amount, 0)) !== roundMoney(snapshot.recalculatedRentalAmount)) {
    throw new ConflictException("原全租期重算逐行租金来源与目标或总额不一致，不能重新计算覆盖坏收据");
  }
}

/** Validate the effective original-total receipt chain before consuming its
 * latest context. A missing successor must not fall back to the initial quote. */
export function assertOriginalTotalExtensionReceipts(tenantId: string, workspaceId: string,
  order: { id: string; endAt: string }, dueAt: string, currency: unknown, rows: readonly RentalOrderExtension[],
  original: Pick<RentalQuoteSnapshotV1, "rentalAmount" | "serviceAmount" | "fulfillmentAmount" | "payableAmount" | "request">): number {
  let cursor = Date.parse(order.endAt), sequence = 0;
  let rentalAmount = original.rentalAmount, serviceAmount = original.serviceAmount, chargedAmount = original.payableAmount;
  const approvedReductions = new Map<string, number>();
  if ([rentalAmount, serviceAmount, chargedAmount, original.fulfillmentAmount].some(value => !Number.isFinite(value) || value < 0)) {
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
    assertRentalTargetAmounts(snapshot, original.request.lines.map(line => line.pricingGroupId ?? line.itemGroupId!));
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
    // Freeze causal sources, not a wall-clock ordering: clocks may differ between
    // the approving and preparing processes. A later approval never rewrites this list.
    const consumedIds = reductionIds(snapshot);
    if (consumedIds === undefined && approvedReductions.size) {
      throw new ConflictException("旧续租缺少实际消费的核减来源，不能按墙钟或金额补写历史依据");
    }
    if (consumedIds?.some(id => !approvedReductions.has(id))) {
      throw new ConflictException("原续租核减来源不属于此前有效且已批准的续租");
    }
    const previousAmount = roundMoney(chargedAmount - (consumedIds ?? []).reduce((sum, id) => sum + approvedReductions.get(id)!, 0));
    if (previousAmount < 0 || roundMoney(snapshot.previousPayableAmount) !== previousAmount) {
      throw new ConflictException("原续租此前已计应付与原报价及有效追加/批准核减不一致");
    }
    chargedAmount = roundMoney(chargedAmount + row.payableAmount);
    if (review?.status === "approved") {
      if (!Number.isFinite(Date.parse(review.reviewedAt ?? ""))) {
        throw new ConflictException("原批准核减缺少有效审核记录，不能猜测历史余额");
      }
      approvedReductions.set(row.id, review.amount);
    }
    rentalAmount = snapshot.recalculatedRentalAmount; serviceAmount = snapshot.recalculatedServiceAmount;
    ids.add(row.id); sequence = row.sequence; cursor = Date.parse(row.newEndAt);
  }
  if (cursor !== Date.parse(dueAt)) throw new ConflictException("原全租期续租记录与当前归还时间不一致，不能猜测已计期间");
  const currentAmount = roundMoney(chargedAmount - [...approvedReductions.values()].reduce((sum, amount) => sum + amount, 0));
  if (!Number.isFinite(currentAmount) || currentAmount < 0) throw new ConflictException("原续租有效追加/核减形成无效余额");
  return currentAmount;
}

function reductionIds(snapshot: NonNullable<RentalOrderExtension["pricingSnapshot"]>): string[] | undefined {
  const basis = snapshot.balanceBasis;
  if (basis === undefined) return undefined;
  if (!basis || basis.version !== 1 || !Array.isArray(basis.approvedReductionExtensionIds)
    || basis.approvedReductionExtensionIds.some(id => typeof id !== "string" || !id)
    || new Set(basis.approvedReductionExtensionIds).size !== basis.approvedReductionExtensionIds.length) {
    throw new ConflictException("原续租消费的核减来源格式无效");
  }
  return basis.approvedReductionExtensionIds;
}

/** Lock-bound acceptance/payment must consume the same approved sources as preview,
 * even when a changed source set happens to produce the same monetary balance. */
export function assertCurrentExtensionReductionBasis(snapshot: NonNullable<RentalOrderExtension["pricingSnapshot"]>, rows: readonly RentalOrderExtension[]): void {
  const current = rows.filter(row => row.status === "effective" && row.pricingSnapshot?.refundReview?.status === "approved").map(row => row.id);
  const consumed = reductionIds(snapshot);
  if (consumed === undefined && current.length === 0) return; // 无核减的旧收据仍可核对原金额链。
  if (!consumed || consumed.length !== current.length || current.some(id => !consumed.includes(id))) {
    throw new ConflictException("实际核减来源已变化或旧收据缺少来源，请重新试算续租差额");
  }
}

/** Read the existing order charge journal; approval is a receivable reduction,
 * never proof of a cash refund. Independent fees reconcile to the order total
 * but do not enter the original-total extension pricing base. */
export function assertOriginalTotalExtensionLedger(
  order: Pick<RentalOrder, "id" | "tenantId" | "currency" | "payableAmount" | "adjustmentAmount" | "finalPayableAmount" | "chargeLines">,
  rows: readonly RentalOrderExtension[], currentAmount: number
): void {
  if (![order.payableAmount, order.adjustmentAmount, order.finalPayableAmount, currentAmount].every(Number.isFinite)
    || order.payableAmount < 0 || order.finalPayableAmount < 0 || currentAmount < 0
    || !Array.isArray(order.chargeLines) || order.chargeLines.some(line => !line || typeof line.code !== "string"
      || !line.code || !Number.isFinite(line.amount))) {
    throw new ConflictException("原订单费用账缺失或金额无效，不能核对续租余额");
  }
  const expected = new Map<string, { type: RentalQuoteChargeLine["type"]; amount: number; sourceId: string; sourceVersion?: string }>();
  const add = (row: RentalOrderExtension, code: string, type: RentalQuoteChargeLine["type"], amount: number, sourceVersion?: string) => {
    if (!Number.isFinite(amount) || expected.has(code)) throw new ConflictException("原续租费用来源重复或无效");
    if (amount !== 0) expected.set(code, { type, amount: roundMoney(amount), sourceId: row.id, sourceVersion });
  };
  let extensionAmount = 0;
  const ids = new Set<string>(), sequences = new Set<number>();
  for (const row of rows.filter(item => item.status === "effective")) {
    if (!row.id || ids.has(row.id) || row.orderId !== order.id || row.tenantId !== order.tenantId
      || !hasOriginalRentalCurrency(order.currency, row.currency) || !Number.isInteger(row.sequence) || row.sequence < 1 || sequences.has(row.sequence)
      || !Number.isFinite(row.payableAmount) || row.payableAmount < 0) throw new ConflictException("原续租费用来源重复或无效");
    ids.add(row.id); sequences.add(row.sequence);
    extensionAmount = roundMoney(extensionAmount + row.payableAmount);
    const snapshot = row.pricingSnapshot;
    if (snapshot) {
      const review = snapshot.refundReview;
      if (!Number.isFinite(snapshot.differenceAmount) || row.payableAmount !== roundMoney(Math.max(0, snapshot.differenceAmount))
        || !Array.isArray(snapshot.chargeLines) || snapshot.chargeLines.some(line => !line || !line.code || !Number.isFinite(line.amount))
        || new Set(snapshot.chargeLines.map(line => line.code)).size !== snapshot.chargeLines.length
        || roundMoney(snapshot.chargeLines.reduce((sum, line) => sum + line.amount, 0)) !== roundMoney(snapshot.differenceAmount)
        || snapshot.differenceAmount < 0 && (!review || !Number.isFinite(review.amount)
          || review.amount !== roundMoney(-snapshot.differenceAmount) || !["pending", "approved", "rejected", "superseded"].includes(review.status))
        || snapshot.differenceAmount >= 0 && review !== undefined) throw new ConflictException("原续租核减或追加收据金额不一致");
      if (snapshot.differenceAmount >= 0) {
        for (const line of snapshot.chargeLines) add(row, `extension:${row.sequence}:${line.code}`, line.type, line.amount, row.priceVersion);
      }
      if (review?.status === "approved") {
        add(row, `extension:${row.sequence}:refund`, "early_return_refund", -review.amount, row.priceVersion);
        extensionAmount = roundMoney(extensionAmount - review.amount);
      }
    } else {
      if (![row.rentalAmount, row.serviceAmount].every(value => Number.isFinite(value) && value >= 0)
        || roundMoney(row.rentalAmount + row.serviceAmount) !== row.payableAmount) throw new ConflictException("原独立续租费用分项不一致");
      add(row, `extension:${row.sequence}:rental`, "extension", row.rentalAmount, row.ruleVersion);
      add(row, `extension:${row.sequence}:service`, "service", row.serviceAmount, row.ruleVersion);
    }
  }
  const actual = order.chargeLines.filter(line => line.code.startsWith("extension:") || ids.has(line.sourceId ?? ""));
  if (actual.length !== expected.size || new Set(actual.map(line => line.code)).size !== actual.length
    || actual.some(line => {
      const source = expected.get(line.code);
      return !source || line.type !== source.type || line.amount !== source.amount
        || line.sourceId !== source.sourceId || line.sourceVersion !== source.sourceVersion;
    }) || roundMoney(order.payableAmount + extensionAmount) !== currentAmount) {
    throw new ConflictException("原续租追加/批准核减缺少唯一同源费用行，不能按审核状态猜测余额");
  }
  // 存量半分费用只按原逐笔入账口径核对，不原地规范化历史明细。
  const net = roundMoney(order.chargeLines.filter(line => !["deposit", "preauthorization"].includes(line.type))
    .reduce((sum, line) => sum + roundMoney(line.amount), 0));
  if (net !== roundMoney(order.finalPayableAmount)
    || roundMoney(order.payableAmount + order.adjustmentAmount) !== net) {
    throw new ConflictException("原订单费用明细与应付/调账总额不一致，不能继续自动核价");
  }
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
