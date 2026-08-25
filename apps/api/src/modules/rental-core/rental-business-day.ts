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
