/** Formatting host facts only; no price, FX or entitlement calculation. */
export function displayMeasurement(value: unknown, unit: unknown): { text: string; unit: string | null; source: "host" | null } {
  const safeUnit = typeof unit === "string" ? unit.slice(0, 32) : null;
  if (typeof value === "bigint" && value >= BigInt(0)) return { text: value.toString(), unit: safeUnit, source: "host" };
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && (!Number.isInteger(value) || Number.isSafeInteger(value))) return { text: String(value), unit: safeUnit, source: "host" };
  return { text: "未知", unit: safeUnit, source: null };
}
/** Reject implicit timezone and Date's silent calendar rollover before formatting. */
function explicitIsoTime(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  if (month < 1 || month > 12 || day < 1 || Number(parts[4]) > 23 ||
      Number(parts[5]) > 59 || Number(parts[6] ?? 0) > 59) return false;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
}
export function displayTime(value: unknown): string {
  if (typeof value !== "string" || !explicitIsoTime(value)) return "时间不可用";
  const date = new Date(value); return Number.isNaN(date.getTime()) ? "时间不可用" : date.toISOString();
}
export function boundedText(value: unknown, limit = 4000): string {
  return typeof value === "string" ? Array.from(value).slice(0, Math.min(10000, Math.max(0, limit))).join("").replace(/[\u202A-\u202E\u2066-\u2069]/g, "") : "内容不可用";
}
