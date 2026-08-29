import {
  type RentalDatetimePriceOverride,
  type RentalPeriodicPriceWindow,
  type RentalPriceAdjustmentChange,
  type RentalPriceAdjustmentPreviewRow,
  type RentalPricingRate
} from "@store-rental/shared";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { DEFAULT_BUSINESS_TIME_ZONE, businessDateKey, businessTimeOfDay } from "./rental-business-day";

/**
 * PRICE-03（需求 4.4.3/4.5.5 v2.9）纯函数：调价计划应用、逐行最终价预览、
 * 周期性时段的命中与重叠判定。与仓储/Nest 生命周期解耦，便于单测直接覆盖。
 */

/** 周内分钟数。周期时段按「周循环」解释：fromWeekday/fromTime 起、toWeekday/toTime 止。 */
const WEEK_MINUTES = 7 * 1440;

const timeToMinutes = (time: string): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");
  if (!match) throw new BadRequestException(`时段 ${time} 必须是 HH:mm`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) throw new BadRequestException(`时段 ${time} 无效`);
  return hours * 60 + minutes;
};

/** 周期时段在一周环上的跨度（分钟）。from→to 逆时针（跨周）时补一圈。 */
export function periodicWindowSpanMinutes(window: RentalPeriodicPriceWindow): number {
  const from = window.fromWeekday * 1440 + timeToMinutes(window.fromTime);
  const to = window.toWeekday * 1440 + timeToMinutes(window.toTime);
  return (to - from + WEEK_MINUTES) % WEEK_MINUTES;
}

/** 取价时点在一周环上的位置（分钟）：营业时区的星期 + 当日分钟。 */
export function minuteOfWeek(iso: string, timeZone: string = DEFAULT_BUSINESS_TIME_ZONE): number {
  const date = businessDateKey(iso, timeZone);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const local = businessTimeOfDay(iso, timeZone);
  const localMatch = /^(\d{1,2}):(\d{2})/.exec(local ?? "");
  const minutes = localMatch ? Number(localMatch[1]) * 60 + Number(localMatch[2]) : 0;
  return weekday * 1440 + minutes;
}

/**
 * 某个营业日期上，周期时段是否有任意一分钟生效（供月历分时标记使用）。
 * 判定与 periodicWindowHits 同一周环数学，保证「月历展示」与「报价命中」同源。
 */
export function periodicWindowCoversDate(
  window: RentalPeriodicPriceWindow,
  dateKey: string,
  timeZone: string = DEFAULT_BUSINESS_TIME_ZONE
): boolean {
  const from = window.fromWeekday * 1440 + timeToMinutes(window.fromTime);
  const span = periodicWindowSpanMinutes(window);
  if (span <= 0) return false;
  const dayStart = minuteOfWeek(dateKey + "T00:00:00Z", timeZone);
  const deltaStart = (dayStart - from + WEEK_MINUTES) % WEEK_MINUTES;
  const deltaEnd = (dayStart + 1439 - from + WEEK_MINUTES) % WEEK_MINUTES;
  return (from - dayStart + WEEK_MINUTES) % WEEK_MINUTES < 1440 || deltaStart < span || deltaEnd < span;
}

/** 取价时点是否命中周期时段（营业时区）。 */
export function periodicWindowHits(window: RentalPeriodicPriceWindow, priceAt: string, timeZone?: string): boolean {
  const from = window.fromWeekday * 1440 + timeToMinutes(window.fromTime);
  const span = periodicWindowSpanMinutes(window);
  if (span <= 0) return false;
  const minute = minuteOfWeek(priceAt, timeZone);
  const delta = (minute - from + WEEK_MINUTES) % WEEK_MINUTES;
  return delta < span;
}

/**
 * 同一费率行内两条周期时段是否重叠：两条 [from, from+span) 的周环区间相交即重叠
 * （需求 4.4.3：同一商品同一计价单位不得存在无法唯一择价的重叠时段）。
 */
export function periodicWindowsOverlap(left: RentalPeriodicPriceWindow, right: RentalPeriodicPriceWindow): boolean {
  const spanOf = (window: RentalPeriodicPriceWindow) => ({
    from: window.fromWeekday * 1440 + timeToMinutes(window.fromTime),
    span: periodicWindowSpanMinutes(window)
  });
  const a = spanOf(left);
  const b = spanOf(right);
  const deltaBA = (b.from - a.from + WEEK_MINUTES) % WEEK_MINUTES;
  const deltaAB = (a.from - b.from + WEEK_MINUTES) % WEEK_MINUTES;
  return deltaBA < a.span || deltaAB < b.span;
}

export function assertNoPeriodicOverlap(windows: RentalPeriodicPriceWindow[] | undefined, label: string) {
  const list = windows ?? [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (periodicWindowsOverlap(list[i], list[j])) {
        throw new ConflictException(
          `${label} 的周期性计价时段存在重叠（${list[i].fromWeekday} ${list[i].fromTime} → ${list[i].toWeekday} ${list[i].toTime} 与 ${list[j].fromWeekday} ${list[j].fromTime} → ${list[j].toWeekday} ${list[j].toTime}），无法唯一择价`
        );
      }
    }
  }
}

export function assertNoDatetimeOverrideOverlap(overrides: RentalDatetimePriceOverride[] | undefined, label: string) {
  const list = overrides ?? [];
  const parsed = list.map((row) => ({ row, start: new Date(row.start).getTime(), end: new Date(row.end).getTime() }));
  for (const item of parsed) {
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start >= item.end) {
      throw new BadRequestException(`${label} 的一次性价格覆盖起止时点无效`);
    }
  }
  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const a = parsed[i];
      const b = parsed[j];
      if (a.start < b.end && b.start < a.end) {
        throw new ConflictException(
          `${label} 的一次性价格覆盖区间重叠（${a.row.start} ~ ${a.row.end} 与 ${b.row.start} ~ ${b.row.end}），无法唯一择价`
        );
      }
    }
  }
}

/**
 * 把调价差异应用到当前版本费率上，生成**完整新费率集**与逐行最终价预览
 * （需求 4.4.3：确认时展示每个受影响商品的最终价格，不得只展示公式）。
 * 未被差异覆盖的费率原样带入——版本行是完整结果，不只是差异。
 */
export function applyPriceAdjustment(
  currentRates: RentalPricingRate[],
  changes: RentalPriceAdjustmentChange[]
): { rates: RentalPricingRate[]; preview: RentalPriceAdjustmentPreviewRow[] } {
  const preview: RentalPriceAdjustmentPreviewRow[] = [];
  const rates = structuredClone(currentRates);
  for (const change of changes) {
    const rate = rates.find((row) => row.itemGroupId === change.itemGroupId && row.unit === change.unit);
    if (!rate) {
      throw new BadRequestException(
        `调价差异指向不存在的费率：商品 ${change.itemGroupId} 的 ${change.unit} 计价单位`
      );
    }
    if (!Number.isFinite(change.value)) throw new BadRequestException("调价值必须是有效数值");
    const before = rate.baseAmount;
    let after = before;
    if (change.op === "set_base") after = change.value;
    else if (change.op === "percent") after = before * (1 + change.value / 100);
    else if (change.op === "fixed") after = before + change.value;
    else throw new BadRequestException(`未知调价方式 ${change.op}`);
    if (after < 0) {
      throw new BadRequestException(`商品 ${rate.itemGroupName} 调整后基础价为负（${after}），不得把价格调为负数`);
    }
    rate.baseAmount = Math.round((after + Number.EPSILON) * 100) / 100;
    preview.push({
      itemGroupId: change.itemGroupId,
      itemGroupCode: rate.itemGroupCode,
      unit: change.unit,
      beforeBaseAmount: before,
      afterBaseAmount: rate.baseAmount
    });
  }
  if (!preview.length) throw new BadRequestException("调价计划至少包含一条变更");
  return { rates, preview };
}
