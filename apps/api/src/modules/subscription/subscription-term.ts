/**
 * SUB-01：SaaS 订阅的期限/周年计算（纯函数，无 NestJS/Prisma 依赖，便于单测）。
 *
 * 需求 §4.1：统一区间 `[startAt, endAt)` 半开；正常按年办理用**日历周年**而非固定 365 天；
 * 目标年份无同一日（如 2/29）时取该月最后一日、同一时刻；保存原计费锚点避免逐年续期漂移；
 * 只录截止日时"可用至该日结束"= 下一日本地零点。SaaS 到期**不**使用营业日历（rental-business-day）。
 */

/** IANA 时区是否可用（与 rental-business-day 同口径：能构造 Intl 即有效）。 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 在 `from` 基础上加 `years` 个日历年，保留时刻；目标年月无同一日时收敛到该月最后一日（§4.1.5）。
 * 以 UTC 计算锚点，避免夏令时导致的时刻漂移；展示层再按服务时区格式化。
 */
export function addCalendarYears(from: Date, years: number): Date {
  const y = from.getUTCFullYear() + years;
  const m = from.getUTCMonth();
  const lastDayOfTargetMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(from.getUTCDate(), lastDayOfTargetMonth);
  return new Date(Date.UTC(
    y, m, day,
    from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()
  ));
}

/**
 * 从计费锚点 + 累计服务年数推算截止（§4.1.5 防漂移：始终基于原锚点，不逐年累加）。
 * @param anchorIso 原计费周年锚点（首次开通的开始时点）
 * @param totalYears 从锚点起累计的服务年数（如续第 2 年传 2）
 */
export function anniversaryFromAnchor(anchorIso: string, totalYears: number): string {
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) throw new Error("invalid anchor date");
  if (!Number.isInteger(totalYears) || totalYears <= 0) throw new Error("totalYears must be a positive integer");
  return addCalendarYears(anchor, totalYears).toISOString();
}

/** serviceYears → endAt：从 startIso 起加 serviceYears 个日历年。 */
export function endFromServiceYears(startIso: string, serviceYears: number): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) throw new Error("invalid start date");
  if (!Number.isInteger(serviceYears) || serviceYears <= 0) throw new Error("serviceYears must be a positive integer");
  return addCalendarYears(start, serviceYears).toISOString();
}

/**
 * "只录截止日"→ 半开区间的实际截止时点 = 该日**次日**在服务时区的本地零点（§4.1.4）。
 * 传入 `YYYY-MM-DD`（业务口径的截止日）与服务时区，返回该时区次日 00:00 的 UTC ISO。
 */
export function exclusiveEndFromDate(dateYmd: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd.trim());
  if (!match) throw new Error("date must be YYYY-MM-DD");
  if (!isValidTimeZone(timeZone)) throw new Error(`invalid time zone: ${timeZone}`);
  const [, ys, ms, ds] = match;
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  // 严格回读：2026-13-01 / 2026-02-30 会被 new Date 静默滚到别的日期，
  // 那样截止日会悄悄落到错误的一天。回读校验挡住不存在的日期（§4.1.4）。
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    throw new Error(`date is not a real calendar date: ${dateYmd}`);
  }
  // 次日的本地 00:00：先取该日 UTC 正午为基准算出该时区的 UTC 偏移，再定位次日零点。
  const nextDayUtcNoon = new Date(Date.UTC(y, mo - 1, d + 1, 12));
  const offsetMinutes = timeZoneOffsetMinutes(nextDayUtcNoon, timeZone);
  return new Date(Date.UTC(y, mo - 1, d + 1, 0, -offsetMinutes)).toISOString();
}

/** 给定时刻在某 IANA 时区相对 UTC 的偏移分钟（东为正）。 */
export function timeZoneOffsetMinutes(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const parts = dtf.formatToParts(at).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** 半开区间判定：startAt <= now < endAt。缺失起止按"待确认"处理（返回 false，不当作永久）。 */
export function isWithinTerm(nowIso: string, startIso?: string | null, endIso?: string | null): boolean {
  if (!startIso || !endIso) return false;
  const now = new Date(nowIso).getTime();
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if ([now, start, end].some(Number.isNaN)) return false;
  return start <= now && now < end;
}
