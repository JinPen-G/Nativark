import { BadRequestException } from "@nestjs/common";
import {
  type RentalCalendarBusinessStatus,
  type RentalCalendarDay,
  type RentalCalendarDayOrigin,
  type RentalCalendarDaySnapshot,
  type RentalCalendarOverrideScope,
  type RentalCalendarRangeFields
} from "@store-rental/shared";
import { isCalendarDateKey, businessDateKey, DEFAULT_BUSINESS_TIME_ZONE } from "./rental-business-day";

const DAY_MS = 86_400_000;

export interface CalendarRangeValidationError extends Error {
  readonly code: "range_cross_year" | "range_invalid_date" | "range_order" | "range_too_long" | "range_datetime_mismatch";
}

/**
 * 范围校验失败必须表现为 400（调用方输入问题），而不是落成 500：
 * 与 `rental-pricing-strategy.ts` 一致，助手层直接抛 Nest 的 BadRequestException。
 */
function rangeError(code: CalendarRangeValidationError["code"], message: string): BadRequestException {
  return Object.assign(new BadRequestException(message), { code });
}

/**
 * 展开「同年度连续日期范围」（需求 4.5.9）。
 *
 * 校验规则全部 fail-closed：
 * - 两个端点都必须是有效 `YYYY-MM-DD`（`startsWith` 单独用会放过 `2026-02-30`
 *   被 `new Date` 静默滚动的问题，一律先过 `isCalendarDateKey`）；
 * - **不得跨年度**：需求 4.5.9「整日营业日历覆盖可以跨月但不得跨年度；
 *   跨年度操作必须拆成两个年度批次」——由前端拆分提交，后端单次请求直接拒绝，
 *   绝不在后端跑两个事务后伪装成一次原子操作；
 * - 最多覆盖一个自然年（同年度已隐含 ≤366 天）。
 */
export function expandCalendarRange(year: number, startDate: string, endDate: string): string[] {
  if (!isCalendarDateKey(startDate)) throw rangeError("range_invalid_date", `起始日期 ${startDate} 不是有效的 YYYY-MM-DD 日期`);
  if (!isCalendarDateKey(endDate)) throw rangeError("range_invalid_date", `结束日期 ${endDate} 不是有效的 YYYY-MM-DD 日期`);
  if (!startDate.startsWith(`${year}-`) || !endDate.startsWith(`${year}-`)) {
    throw rangeError("range_cross_year", "范围覆盖不得跨年度：请按年度拆分成两次提交");
  }
  const startIndex = Date.UTC(Number(startDate.slice(0, 4)), Number(startDate.slice(5, 7)) - 1, Number(startDate.slice(8, 10)));
  const endIndex = Date.UTC(Number(endDate.slice(0, 4)), Number(endDate.slice(5, 7)) - 1, Number(endDate.slice(8, 10)));
  if (endIndex < startIndex) throw rangeError("range_order", "结束日期不能早于起始日期");
  const days: string[] = [];
  for (let cursor = startIndex; cursor <= endIndex; cursor += DAY_MS) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * 日期时间范围（需求 4.5.9「带开始和结束时间的日期时间范围」）的时点校验。
 *
 * 边界语义（实现决策，随交付报告披露）：日历字段（类型/状态/时段）在数据模型上
 * 就是**逐日**属性，因此按整天生效；起止时点作为范围选择的原样记录进入
 * `overrideScope.startDateTime/endDateTime`，供日期详情展示，并供 PRICE-03 的
 * 一次性日期时间价格覆盖引用消费——本层不做半天截断。
 *
 * 起止时点必须落在范围端点日期的**营业时区**日界内（如「周一 00:00 +08:00」的
 * UTC 日期是周日，按营业时区才是周一）；用 UTC 日期比对会把需求 4.5.5 的
 * 「周五 12:00 至周一 00:00」这类边界误判为不匹配。
 */
export function assertRangeDateTimeScope(
  startDate: string,
  endDate: string,
  startDateTime?: string,
  endDateTime?: string,
  timeZone: string = DEFAULT_BUSINESS_TIME_ZONE
): void {
  if (startDateTime === undefined && endDateTime === undefined) return;
  if (!startDateTime || !endDateTime) {
    throw rangeError("range_datetime_mismatch", "日期时间范围必须同时提供开始与结束时点");
  }
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw rangeError("range_datetime_mismatch", "日期时间范围必须是有效的 ISO 时间");
  }
  if (start.getTime() >= end.getTime()) throw rangeError("range_datetime_mismatch", "日期时间范围结束时点必须晚于开始时点");
  if (businessDateKey(startDateTime, timeZone) !== startDate || businessDateKey(endDateTime, timeZone) !== endDate) {
    throw rangeError("range_datetime_mismatch", "起止时点必须分别落在范围的起始与结束日期当天（按营业时区）");
  }
}

/** 范围覆盖允许设置的字段集合，用于计算「将被修改的字段」。 */
const RANGE_FIELD_KEYS = ["dayType", "name", "pricingMultiplier", "businessStatus", "hours"] as const;
export type RentalCalendarRangeFieldKey = (typeof RANGE_FIELD_KEYS)[number];

/**
 * 只把**明确提供**的字段落到日期上（需求 4.5.9：未选择字段保持原值）。
 *
 * 叠加顺序：范围已有人工覆盖 → 在其现值上叠加；无覆盖 → 在基础值上叠加。
 * 四态与两态同步（`closed` 由 `businessStatus` 派生），与单日编辑同一口径：
 * 未提供 businessStatus 时不按 closed 反推，避免把 limited/self_service 静默降级。
 */
export function applyRangeFieldsToDay(
  current: RentalCalendarDay | undefined,
  baseDay: RentalCalendarDay,
  fields: RentalCalendarRangeFields,
  scope: RentalCalendarOverrideScope,
  meta: { reason: string; operator?: string; at: string }
): RentalCalendarDay {
  const source = current?.source === "tenant_override" ? current : baseDay;
  const next: RentalCalendarDay = {
    date: source.date,
    dayType: fields.dayType ?? source.dayType,
    name: fields.name ?? source.name,
    pricingMultiplier: fields.pricingMultiplier ?? source.pricingMultiplier,
    closed: source.closed,
    businessStatus: fields.businessStatus ?? source.businessStatus ?? (source.closed ? "closed" : "open"),
    hours: fields.hours !== undefined ? fields.hours : source.hours,
    source: "tenant_override",
    overrideReason: meta.reason,
    overrideBy: meta.operator,
    overrideAt: meta.at,
    // 沿用最早的非覆盖原值：`overriddenFrom` 记"官方或模板原本是什么"，
    // 不是"上一次人工改成了什么"（与单日编辑同一语义）。
    overriddenFrom:
      current?.source === "tenant_override" ? current.overriddenFrom : originSnapshotOf(baseDay),
    overrideScope: scope
  };
  next.closed = next.businessStatus === "closed" || next.businessStatus === "self_service";
  return next;
}

/** 从一个非覆盖日期提取 `overriddenFrom` 原值快照。 */
export function originSnapshotOf(day: RentalCalendarDay): RentalCalendarDayOrigin {
  return {
    dayType: day.dayType,
    name: day.name,
    pricingMultiplier: day.pricingMultiplier,
    closed: day.closed,
    businessStatus: day.businessStatus,
    // 显式写死来源，避免把调用方上下文里的 tenant_override 带进原值类型。
    source: day.source === "official_cn" ? "official_cn" : "week_rule"
  };
}

/**
 * 移除覆盖后的恢复值：有 `overriddenFrom` 恢复它，否则按周模板重算
 * （需求 4.5.3/4.5.9：不得把日期变成没有来源的空白日，也不得恢复成过期快照——
 * 模板值永远按当前每周默认营业模板现算）。
 */
export function deriveRestoredDay(
  target: RentalCalendarDay,
  fallbackTemplateDay: RentalCalendarDay | undefined
): { day: RentalCalendarDay; source: "official_cn" | "week_rule" } {
  const origin = target.overriddenFrom;
  if (origin) {
    return {
      day: {
        date: target.date,
        dayType: origin.dayType,
        name: origin.name,
        pricingMultiplier: origin.pricingMultiplier,
        closed: origin.closed,
        businessStatus: origin.businessStatus ?? (origin.closed ? "closed" : "open"),
        source: origin.source
      },
      source: origin.source === "official_cn" ? "official_cn" : "week_rule"
    };
  }
  const fallback = fallbackTemplateDay ?? {
    date: target.date,
    dayType: "workday" as const,
    name: "工作日",
    pricingMultiplier: 1,
    closed: false,
    businessStatus: "open" as RentalCalendarBusinessStatus,
    source: "week_rule" as const
  };
  return { day: { ...fallback, date: target.date }, source: "week_rule" };
}

/** 找出被明确修改的字段名（供预览行展示「将替换的字段」）。 */
export function changedFieldNames(before: RentalCalendarDaySnapshot, after: RentalCalendarDaySnapshot): string[] {
  const changed: string[] = [];
  if (before.dayType !== after.dayType) changed.push("dayType");
  if (before.name !== after.name) changed.push("name");
  if (before.pricingMultiplier !== after.pricingMultiplier) changed.push("pricingMultiplier");
  if ((before.businessStatus ?? undefined) !== (after.businessStatus ?? undefined)) changed.push("businessStatus");
  if (JSON.stringify(before.hours ?? null) !== JSON.stringify(after.hours ?? null)) changed.push("hours");
  return changed;
}
