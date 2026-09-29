/**
 * SUB-01：SaaS 订阅的期限/周年计算（纯函数，无 NestJS/Prisma 依赖，便于单测）。
 *
 * 需求 §4.1：统一区间 `[startAt, endAt)` 半开；正常按年办理用**日历周年**而非固定 365 天；
 * 目标年份无同一日（如 2/29）时取该月最后一日、同一时刻；保存原计费锚点避免逐年续期漂移；
 * 只录截止日时"可用至该日结束"= 下一日本地零点。SaaS 到期**不**使用营业日历（rental-business-day）。
 */

type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

function timeZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  if (!timeZone) throw new Error(`invalid time zone: ${timeZone}`);
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone, calendar: "gregory", numberingSystem: "latn", hourCycle: "h23",
      era: "short", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  } catch {
    throw new Error(`invalid time zone: ${timeZone}`);
  }
}

/** IANA 时区是否可用（与 rental-business-day 同口径：能构造 Intl 即有效）。 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    timeZoneFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function wallTimeAt(at: Date, formatter: Intl.DateTimeFormat): WallTime {
  if (Number.isNaN(at.getTime())) throw new Error("invalid date");
  const parts = formatter.formatToParts(at).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: parts.era === "BC" ? 1 - Number(parts.year) : Number(parts.year),
    month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    millisecond: at.getUTCMilliseconds()
  };
}

/** 仅把墙上时间编码为可比较的数字，不在这里解释时区。避免 Date.UTC 对 0..99 年补 1900。 */
function wallTimeAsUtc(wall: WallTime): Date {
  const result = new Date(0);
  result.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  result.setUTCHours(wall.hour, wall.minute, wall.second, wall.millisecond);
  if (Number.isNaN(result.getTime())) throw new Error("date is outside the supported range");
  return result;
}

function offsetMilliseconds(at: Date, formatter: Intl.DateTimeFormat): number {
  return wallTimeAsUtc(wallTimeAt(at, formatter)).getTime() - at.getTime();
}

/**
 * 将服务时区墙上时间反解为时点。收集附近 IANA 偏移后逐个精确回读，而非拿 UTC 正午的偏移套零点。
 * 前后 48 小时覆盖跨日偏移/整日跳变；6 小时采样同时取得 IANA 转换两侧的偏移。
 * 重复时刻固定选择最早的有效时点；跳时导致不存在的时刻必须拒绝，不能自动滚到下一小时/天。
 */
function instantFromWallTime(wall: WallTime, timeZone: string, formatter: Intl.DateTimeFormat): Date {
  const wallMillis = wallTimeAsUtc(wall).getTime();
  const offsets = new Set<number>();
  const hourMillis = 60 * 60 * 1000;
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = new Date(wallMillis + hours * hourMillis);
    if (!Number.isNaN(sample.getTime())) offsets.add(offsetMilliseconds(sample, formatter));
  }
  const candidates: number[] = [];
  for (const offset of offsets) {
    const candidate = new Date(wallMillis - offset);
    if (!Number.isNaN(candidate.getTime()) && wallTimeAsUtc(wallTimeAt(candidate, formatter)).getTime() === wallMillis) {
      candidates.push(candidate.getTime());
    }
  }
  if (candidates.length === 0) {
    throw new Error(`nonexistent local time: ${new Date(wallMillis).toISOString().slice(0, -1)} in ${timeZone}`);
  }
  return new Date(Math.min(...candidates));
}

/** 服务时区的日历年份（不能用 UTC 年份推算本地计费周年数）。 */
export function calendarYear(at: Date, timeZone: string): number {
  return wallTimeAt(at, timeZoneFormatter(timeZone)).year;
}

/**
 * 在 `from` 基础上加 `years` 个日历年，保留服务时区的月/日/时刻（含毫秒）。
 * 目标年份无同一日时收敛到该月最后一日（§4.1.5）；调用者续期时应始终传原锚点。
 */
export function addCalendarYears(from: Date, years: number, timeZone = "UTC"): Date {
  if (!Number.isInteger(years)) throw new Error("years must be an integer");
  const formatter = timeZoneFormatter(timeZone);
  const wall = wallTimeAt(from, formatter);
  wall.year += years;
  const leapYear = wall.year % 4 === 0 && (wall.year % 100 !== 0 || wall.year % 400 === 0);
  const lastDay = wall.month === 2 ? (leapYear ? 29 : 28) : ([4, 6, 9, 11].includes(wall.month) ? 30 : 31);
  wall.day = Math.min(wall.day, lastDay);
  return instantFromWallTime(wall, timeZone, formatter);
}

/**
 * 从计费锚点 + 累计服务年数推算截止（§4.1.5 防漂移：始终基于原锚点，不逐年累加）。
 * @param anchorIso 原计费周年锚点（首次开通的开始时点）
 * @param totalYears 从锚点起累计的服务年数（如续第 2 年传 2）
 */
export function anniversaryFromAnchor(anchorIso: string, totalYears: number, timeZone = "UTC"): string {
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) throw new Error("invalid anchor date");
  if (!Number.isInteger(totalYears) || totalYears <= 0) throw new Error("totalYears must be a positive integer");
  return addCalendarYears(anchor, totalYears, timeZone).toISOString();
}

/** serviceYears → endAt：从 startIso 起加 serviceYears 个服务时区日历年。 */
export function endFromServiceYears(startIso: string, serviceYears: number, timeZone = "UTC"): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) throw new Error("invalid start date");
  if (!Number.isInteger(serviceYears) || serviceYears <= 0) throw new Error("serviceYears must be a positive integer");
  return addCalendarYears(start, serviceYears, timeZone).toISOString();
}

/**
 * "只录截止日"→ 半开区间的实际截止时点 = 该日**次日**在服务时区的本地零点（§4.1.4）。
 * 传入 `YYYY-MM-DD`（业务口径的截止日）与服务时区，返回该时区次日 00:00 的 UTC ISO。
 */
export function exclusiveEndFromDate(dateYmd: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd.trim());
  if (!match) throw new Error("date must be YYYY-MM-DD");
  const formatter = timeZoneFormatter(timeZone);
  const wall: WallTime = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: 0, minute: 0, second: 0, millisecond: 0
  };
  // 严格回读日历日期，拒绝 Date 会静默滚动到下月的 2/30 等输入。
  const probe = wallTimeAsUtc(wall);
  if (probe.getUTCFullYear() !== wall.year || probe.getUTCMonth() + 1 !== wall.month || probe.getUTCDate() !== wall.day) {
    throw new Error(`date is not a real calendar date: ${dateYmd}`);
  }
  probe.setUTCDate(probe.getUTCDate() + 1);
  wall.year = probe.getUTCFullYear();
  wall.month = probe.getUTCMonth() + 1;
  wall.day = probe.getUTCDate();
  return instantFromWallTime(wall, timeZone, formatter).toISOString();
}

/** 给定时刻在某 IANA 时区相对 UTC 的偏移分钟（东为正；保留历史秒级偏移，不受毫秒影响）。 */
export function timeZoneOffsetMinutes(at: Date, timeZone: string): number {
  return offsetMilliseconds(at, timeZoneFormatter(timeZone)) / 60000;
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
