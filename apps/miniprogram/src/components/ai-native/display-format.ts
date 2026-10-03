/** Formatting host facts only; no price, FX or entitlement calculation. */
export function displayMeasurement(value: unknown, unit: unknown): { text: string; unit: string | null; source: "host" | null } {
  const safeUnit = typeof unit === "string" ? unit.slice(0, 32) : null;
  if (typeof value === "bigint" && value >= BigInt(0)) return { text: value.toString(), unit: safeUnit, source: "host" };
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && (!Number.isInteger(value) || Number.isSafeInteger(value))) return { text: String(value), unit: safeUnit, source: "host" };
  return { text: "未知", unit: safeUnit, source: null };
}
export function displayTime(value: unknown): string {
  if (typeof value !== "string" || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(value)) return "时间不可用";
  const date = new Date(value); return Number.isNaN(date.getTime()) ? "时间不可用" : date.toISOString();
}
export function boundedText(value: unknown, limit = 4000): string {
  return typeof value === "string" ? Array.from(value).slice(0, Math.min(10000, Math.max(0, limit))).join("").replace(/[\u202A-\u202E\u2066-\u2069]/g, "") : "内容不可用";
}
