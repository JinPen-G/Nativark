export type SafeFormattedValue = { value: string; source: string | null; unit: string | null; available: boolean };

export function formatAmount(value: unknown, unit: unknown = null): SafeFormattedValue {
  const normalizedUnit = typeof unit === "string" && unit.trim() ? unit.trim().slice(0, 32) : null;
  if (typeof value === "bigint" && value >= 0n) return { value: value.toString(), source: "host", unit: normalizedUnit, available: true };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (Number.isInteger(value) && !Number.isSafeInteger(value)))
    return { value: "未知", source: null, unit: normalizedUnit, available: false };
  return { value: String(value), source: "host", unit: normalizedUnit, available: true };
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
export function formatTimestamp(value: unknown): SafeFormattedValue {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date))
    return { value: "时间不可用", source: null, unit: null, available: false };
  const date = new Date(value);
  if ((typeof value === "string" && !explicitIsoTime(value)) || Number.isNaN(date.getTime())) return { value: "时间不可用", source: null, unit: null, available: false };
  return { value: date.toISOString(), source: "host", unit: "ISO-8601", available: true };
}

export function formatUsage(input: { amount?: unknown; unit?: unknown; status?: unknown } | null | undefined): SafeFormattedValue {
  if (!input || input.status === "unknown" || input.status === "pending_reconciliation")
    return { value: "未知用量", source: null, unit: null, available: false };
  return formatAmount(input.amount, input.unit);
}
