const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

/** Display-only projection. It never turns text into HTML or a navigable URL. */
export function safeDisplayText(value: unknown, limit = 4_000): string {
  if (typeof value !== "string") return "内容不可用";
  const bounded = Array.from(value).slice(0, Math.max(0, Math.min(limit, 20_000))).join("");
  return bounded.replace(CONTROL_CHARS, "");
}

export function safeDisplayLabel(value: unknown, fallback: string, limit = 200): string {
  const result = safeDisplayText(value, limit);
  return result === "内容不可用" || result.length === 0 ? fallback : result;
}
