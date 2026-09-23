/**
 * 营业时区的时间处理（需求 §4.3、§6.4）。
 *
 * 所有展示按订单/服务的营业时区，不按设备时区；本模块只做“时刻 ↔ 营业时区墙上时间”的换算与格式化，
 * **不计算夜数、自然日或任何费用**——那是服务端报价的事。
 *
 * 依赖宿主的 Intl.DateTimeFormat(timeZone)。极少数旧设备不支持时退回设备时区，并让页面明确标注，
 * 而不是悄悄算错。
 */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0=周日 … 6=周六 */
  weekday: number;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEKDAY_CODES: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const unsupportedZones = new Set<string>();

function formatter(timeZone: string): Intl.DateTimeFormat | undefined {
  if (unsupportedZones.has(timeZone)) return undefined;
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  try {
    // 未知时区在所有现代引擎里都会抛 RangeError。不能拿 resolvedOptions().timeZone 与入参做字符串比较：
    // ICU 会把别名规范化（Asia/Kolkata → Asia/Calcutta），比较不等会把合法时区误判为不支持，
    // 然后静默退回设备时区——那正是本模块要杜绝的错误。
    const created = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short"
    });
    if (!created.resolvedOptions().timeZone) throw new Error("timezone not honoured");
    formatterCache.set(timeZone, created);
    return created;
  } catch {
    unsupportedZones.add(timeZone);
    return undefined;
  }
}

export function zoneSupported(timeZone: string): boolean {
  return Boolean(formatter(timeZone));
}

function localParts(date: Date): ZonedParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    weekday: date.getDay()
  };
}

/** 某一时刻在营业时区的墙上时间。时区不受支持时退回设备时区（调用方可用 zoneSupported 标注）。 */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const format = formatter(timeZone);
  if (!format) return localParts(date);
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_CODES[parts.weekday] ?? new Date(date).getDay()
  };
}

/** 营业时区相对 UTC 的偏移（分钟），带符号；东八区为 480。 */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function parseIso(iso: string | undefined | null): Date | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : undefined;
}

/** “09-20 周日 10:00”；跨年时带年份。 */
export function formatBusinessDateTime(iso: string | undefined | null, timeZone: string, now: Date = new Date()): string {
  const date = parseIso(iso);
  if (!date) return "时间待提供";
  const parts = zonedParts(date, timeZone);
  const nowParts = zonedParts(now, timeZone);
  const yearPrefix = parts.year !== nowParts.year ? `${parts.year}-` : "";
  return `${yearPrefix}${pad(parts.month)}-${pad(parts.day)} ${WEEKDAYS[parts.weekday]} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatBusinessDate(iso: string | undefined | null, timeZone: string): string {
  const date = parseIso(iso);
  if (!date) return "日期待提供";
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function formatBusinessTime(iso: string | undefined | null, timeZone: string): string {
  const date = parseIso(iso);
  if (!date) return "--:--";
  const parts = zonedParts(date, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatBusinessRange(startIso: string | undefined, endIso: string | undefined, timeZone: string): string {
  return `${formatBusinessDateTime(startIso, timeZone)} 至 ${formatBusinessDateTime(endIso, timeZone)}`;
}

/** 供页面标注时区：“营业时区 Asia/Shanghai（UTC+08:00）”或设备时区回退提示。 */
export function zoneLabel(timeZone: string): string {
  if (!zoneSupported(timeZone)) return `当前设备无法按营业时区 ${timeZone} 显示，以下时间按设备时区显示`;
  return `营业时区 ${timeZone}（${formatOffset(zoneOffsetMinutes(new Date(), timeZone))}）`;
}

/** 营业时区下的今天，格式 YYYY-MM-DD，供日期选择器设置最小日期。 */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const parts = zonedParts(now, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function splitInstant(iso: string | undefined, timeZone: string): { date: string; time: string } {
  const parsed = parseIso(iso);
  if (!parsed) return { date: "", time: "" };
  const parts = zonedParts(parsed, timeZone);
  return { date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`, time: `${pad(parts.hour)}:${pad(parts.minute)}` };
}

/**
 * 把营业时区的“日期 + 时间”换算成 ISO 时刻。
 * 落在夏令时空洞或重叠里的时间会抛错，而不是悄悄挪到别的时刻——那会改变租期长度。
 */
export function zonedToInstant(dateText: string, timeText: string, timeZone: string): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeText.trim());
  if (!dateMatch || !timeMatch) throw new Error("日期或时间格式无效");
  const [year, month, day] = [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])];
  const [hour, minute] = [Number(timeMatch[1]), Number(timeMatch[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) throw new Error("日期或时间超出范围");
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  if (!zoneSupported(timeZone)) {
    // 设备时区回退：与展示口径一致（页面已标注）。
    const local = new Date(year, month - 1, day, hour, minute, 0);
    return local.toISOString();
  }
  // 真实时刻与“把墙上时间当作 UTC”的值最多相差 14 小时；前后各探测一天，
  // 就能拿到可能涉及的全部偏移量（夏令时切换前后各一个）。
  const roundTrips = (candidate: number) => {
    const parts = zonedParts(new Date(candidate), timeZone);
    return parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute;
  };
  const offsets = new Set([wall - 86400000, wall, wall + 86400000].map((probe) => zoneOffsetMinutes(new Date(probe), timeZone)));
  const candidates = new Set<number>();
  for (const offset of offsets) {
    const candidate = wall - offset * 60000;
    if (roundTrips(candidate)) candidates.add(candidate);
  }
  if (candidates.size === 0) throw new Error("所选时间在营业时区不存在（夏令时跳过），请换一个时间");
  if (candidates.size > 1) throw new Error("所选时间在营业时区出现两次（夏令时重叠），请换一个时间");
  return new Date(Array.from(candidates)[0]).toISOString();
}

/** 时长的人类可读描述，只用于提示（如“已逾期 3 小时”），不用于计费。 */
export function describeDuration(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `${days} 天${hours % 24 ? ` ${hours % 24} 小时` : ""}`;
}
