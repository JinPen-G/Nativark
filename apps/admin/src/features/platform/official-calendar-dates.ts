/** UI-only decoding of the existing official calendar payload. No holiday inference,
 * source registration or publication; the server remains the final validator. */
import type { OfficialCalendarDayInput } from "@rental-os/shared";

export type OfficialDateDraft = Record<string, unknown>;
export interface OfficialDateIssue { message: string; row?: number }

export function decodeOfficialCalendarDates(text: string): OfficialDateDraft[] | null {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) && value.every(item => item && typeof item === "object" && !Array.isArray(item)) ? value : null;
  } catch { return null; }
}

export function officialCalendarDateIssue(rows: OfficialDateDraft[] | null, year: number | undefined): OfficialDateIssue | undefined {
  if (!rows) return { message: "请输入有效的日期 JSON 数组" };
  if (!rows.length) return { message: "请至少填写一条官方日期" };
  if (!Number.isInteger(year) || year! < 2000 || year! > 2999) return { message: "请先填写 2000—2999 的年度" };
  const seen = new Set<string>();
  for (const [index, item] of rows.entries()) {
    const row = index + 1;
    const value = item.date;
    const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00Z`) : null;
    if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return { message: "第 {row} 条：请选择有效日期", row };
    if (!String(value).startsWith(`${year}-`)) return { message: "第 {row} 条：日期不在所选年度内", row };
    if (seen.has(String(value))) return { message: "第 {row} 条：日期重复，请核对前面的记录", row };
    if (item.dayType !== "statutory_holiday" && item.dayType !== "makeup_workday") return { message: "第 {row} 条：请选择法定节假日或调休工作日", row };
    if (typeof item.name !== "string" || !item.name.trim()) return { message: "第 {row} 条：请填写节日或调休名称", row };
    seen.add(String(value));
  }
}

export function readOfficialCalendarDates(text: string, year: number, translate: (text: string, values?: Record<string, string | number>) => string): OfficialCalendarDayInput {
  const rows = decodeOfficialCalendarDates(text);
  const issue = officialCalendarDateIssue(rows, year);
  if (issue) throw new Error(translate(issue.message, issue.row ? { row: issue.row } : undefined));
  // Existing optional fields survive form/JSON round trips. UI edits never rebuild
  // a row from only its three visible fields or silently drop legacy source values.
  return rows as OfficialCalendarDayInput;
}

export function updateOfficialCalendarDate(rows: OfficialDateDraft[], index: number, field: "date" | "dayType" | "name", value: string) {
  return rows.map((row, position) => position === index ? { ...row, [field]: value } : row);
}
