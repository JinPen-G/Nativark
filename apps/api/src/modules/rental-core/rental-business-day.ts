/**
 * 营业日的时区口径。
 *
 * 为什么必须收敛到一处：自然日、夜、日历日期类型三者都要按**同一个**日界切分。
 * 早前全部按 UTC 日界（各处自己写 `toISOString().slice(0, 10)`），于是
 * 北京时间 06:00–20:00 的当日租会跨两个 UTC 日期——自然日多收一天、日历也多命中一天。
 *
 * 为什么存 IANA 时区标识而不是固定偏移：项目负责人 2026-08-25 决定按租户配置时区。
 * 一旦允许多个时区，固定偏移就会在实行夏令时的地区算错日界（实测 America/New_York
 * 一月 GMT-5、七月 GMT-4）。`Intl` 自带完整 ICU 时区库，并对非法标识抛 `RangeError`，
 * 因此换算与校验都用它。
 *
 * 归属说明：时区放在 `TenantRentalBusinessSettings` 里，而该设置在 SPACE-03 之后
 * 已按**经营空间**存储（`rental_tenant_business_settings.workspaceId`）。
 * 因此实际粒度是「每个经营空间一个时区」——这与营业日历同样按空间存储保持一致，
 * 同一租户在不同城市的经营空间可以各自正确切分日界。
 */

import type { RentalBusinessHours, RentalTimeWindow } from "@store-rental/shared";

const MS_PER_DAY = 86_400_000;



/** 未配置时区时的兜底。选国内时区与既有数据的实际用法一致。 */
export const DEFAULT_BUSINESS_TIME_ZONE = "Asia/Shanghai";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  // en-CA 的 numeric 短格式即 `YYYY-MM-DD`，省掉手工拼接。
  // 非法时区在这里就抛 RangeError，不会带着坏值算下去。
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  formatters.set(timeZone, created);
  return created;
}

/** 时区标识是否可用。用于配置保存时 fail-closed，而不是等报价时才炸。 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验一组营业时段（需求 4.5.1）。返回错误信息或 null——由调用方包成 400，
 * 保持本模块不依赖 Nest。规则：每个时段起点早于终点；同类时段互不重叠；
 * 领取/归还/配送时段必须落在营业时段内。营业时段为空数组表示当天不营业；
 * 此处无需再做动作时段落域校验，运行时会统一拒绝该日履约。
 * 时段是营业时区当地 `HH:mm`，字符串比较即可正确排序。
 */
export function businessHoursError(hours: RentalBusinessHours, label: string): string | null {
  const checkGroup = (windows: RentalTimeWindow[] | undefined, name: string): string | null => {
    if (!windows?.length) return null;
    for (const window of windows) {
      if (window.start >= window.end) {
        return `${label} 的${name}时段 ${window.start}-${window.end} 起点必须早于终点`;
      }
    }
    const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].start < sorted[index - 1].end) {
        return `${label} 的${name}时段存在重叠：${sorted[index - 1].start}-${sorted[index - 1].end} 与 ${sorted[index].start}-${sorted[index].end}`;
      }
    }
    return null;
  };
  const groups: Array<[RentalTimeWindow[] | undefined, string]> = [
    [hours.windows, "营业"],
    [hours.pickup, "领取"],
    [hours.return, "归还"],
    [hours.delivery, "配送"]
  ];
  for (const [windows, name] of groups) {
    const error = checkGroup(windows, name);
    if (error) return error;
  }
  // 履约动作时段必须落在营业时段内：营业时段未配置（不限制）时跳过落域校验。
  if (hours.windows?.length) {
    const within = (windows: RentalTimeWindow[] | undefined, name: string): string | null => {
      if (!windows?.length) return null;
      for (const window of windows) {
        const covered = hours.windows.some((base) => window.start >= base.start && window.end <= base.end);
        if (!covered) return `${label} 的${name}时段 ${window.start}-${window.end} 必须落在营业时段内`;
      }
      return null;
    };
    for (const [windows, name] of [[hours.pickup, "领取"], [hours.return, "归还"], [hours.delivery, "配送"]] as const) {
      const error = within(windows, name);
      if (error) return error;
    }
  }
  return null;
}

/** 营业日期键（`YYYY-MM-DD`），与营业日历 `RentalCalendarDay.date` 同一口径。 */
export function businessDateKey(iso: string, timeZone: string): string {
  return formatterFor(timeZone).format(new Date(iso));
}

/**
 * 营业日序号：同一营业日内任意时刻返回同一整数，相邻营业日相差 1。
 *
 * 先换算成目标时区的日期键再折成序号，而不是「时间戳 + 偏移」再取整——
 * 后者在夏令时切换日会算错，因为那天的本地日长不是 24 小时。
 */
export function businessDayIndex(iso: string, timeZone: string): number {
  const [year, month, day] = businessDateKey(iso, timeZone).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** 由营业日序号还原日期键，供按日游走时使用。 */
export function businessDateKeyFromIndex(index: number): string {
  return new Date(index * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 该营业日期键所属年份，用于按年选取营业日历。 */
export function businessYearFromDateKey(dateKey: string): number {
  return Number(dateKey.slice(0, 4));
}

/**
 * 是否为真实存在的 `YYYY-MM-DD` 日期。
 *
 * 为什么不能只靠 DTO 的 `@IsISO8601()`：它接受带时间的完整时间戳，也接受
 * `2026-02-30` 这种格式合法但日期不存在的值。前者会让同一天出现两个日历键，
 * 后者会被 `new Date()` 静默滚到 3 月 2 日——那天的加价系数就落到了错误的日期上。
 * 因此除了格式，还要用回读法确认月份没有被滚动。
 */
export function isCalendarDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * 某个营业日期在营业时区的指定整点，返回对应的绝对时刻（毫秒）。
 *
 * 做法是先假定偏移为 0 取一个候选时刻，再用该候选在目标时区的实际偏移回修一次。
 * 直接拼 `${dateKey}T${hh}:00:00Z` 会把 UTC 当成当地时间；而固定偏移在夏令时
 * 地区又会错。回修一次即可对齐，因为同一时刻的偏移由 ICU 给出。
 */
export function businessInstantAt(dateKey: string, hour: number, timeZone: string): number {
  const naive = Date.parse(`${dateKey}T${String(hour).padStart(2, "0")}:00:00Z`);
  const offsetMs = zoneOffsetMs(naive, timeZone);
  // 用回修后的时刻再取一次偏移：跨夏令时切换时首次估计可能落在切换的另一侧。
  return naive - zoneOffsetMs(naive - offsetMs, timeZone);
}

/** 指定时刻在目标时区的 UTC 偏移（毫秒）。 */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - instant;
}

/**
 * 该时刻在营业时区的当地时间，格式 `HH:mm`（24 小时制）。
 *
 * 营业时段配的是门店挂钟时间，因此校验"领取时点是否落在营业时段内"必须先换算到
 * 营业时区再比较；直接用 UTC 小时会整体偏移时区差。
 */
export function businessTimeOfDay(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}
