/** Bounded CSV transfer. Exports use explicit public fields; imports never accept IDs or updates. */
export type CsvValue = string | number | boolean | null | undefined;
/** Explicit local validation failure, before any write has been sent. */
export class ListPreflightError extends Error {}
export interface ExportField<T> { label: string; value: (row: T) => CsvValue }
export interface ListExport<T> { filename: string; fields: ExportField<T>[]; scope?: "page" | "filtered" }
export interface ImportField { key: string; label: string; example?: string; required?: boolean }
export interface ListImport<T> {
  filename: string;
  fields: ImportField[];
  parse: (values: Record<string, string>) => T;
  key: (values: T) => string;
  /** Fetch current keys immediately before execution, in the original permission scope. */
  existingKeys: () => Promise<string[]>;
  create: (values: T) => Promise<unknown>;
  allowed: () => boolean;
  onComplete: () => Promise<unknown>;
}
export const CSV_LIMITS = { bytes: 2 * 1024 * 1024, rows: 500 } as const;
/** Erase the payload only after the domain parser has validated and constructed it. */
export function defineListImport<T>(config: ListImport<T>): ListImport<unknown> {
  return { ...config, key: value => config.key(value as T), create: value => config.create(value as T) };
}

export function csvCell(value: CsvValue): string {
  let text = value == null ? "" : String(value);
  // Spreadsheet programs interpret formula prefixes even inside quoted cells.
  if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function encodeCsv(rows: CsvValue[][]): string { return "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"); }
export function downloadCsv(filename: string, rows: CsvValue[][]) {
  const url = URL.createObjectURL(new Blob([encodeCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = `${filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")}.csv`;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportRows<T>(config: ListExport<T>, rows: T[]) {
  downloadCsv(config.filename, [config.fields.map(field => field.label), ...rows.map(row => config.fields.map(field => field.value(row)))]);
}
/** RFC 4180 quoting, embedded newlines, CRLF and BOM; malformed data fails before any request. */
export function parseCsv(text: string): string[][] {
  if (text.includes("\u0000")) throw new Error("CSV 包含非法控制字符");
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  const end = () => { row.push(cell); if (row.some(value => value.trim())) rows.push(row); row = []; cell = ""; closed = false; };
  text = text.replace(/^\ufeff/, "");
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (char === '"') { if (text[index + 1] === '"') { cell += '"'; index++; } else { quoted = false; closed = true; } } else cell += char; continue; }
    if (char === '"') { if (cell || closed) throw new Error("CSV 引号格式错误"); quoted = true; }
    else if (char === ",") { row.push(cell); cell = ""; closed = false; }
    else if (char === "\r" || char === "\n") { if (char === "\r" && text[index + 1] === "\n") index++; end(); }
    else { if (closed) throw new Error("CSV 引号格式错误"); cell += char; }
    if (rows.length > CSV_LIMITS.rows + 1) throw new Error("每次最多导入 500 条");
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  if (cell || row.length || closed) end();
  return rows;
}
export function importRecords(text: string, fields: ImportField[]): Record<string, string>[] {
  const [head, ...rows] = parseCsv(text);
  if (!head || !rows.length) throw new Error("文件没有数据");
  if (rows.length > CSV_LIMITS.rows) throw new Error("每次最多导入 500 条");
  const columns = head.map(value => value.trim());
  if (new Set(columns).size !== columns.length || columns.some(key => !fields.some(field => field.key === key))) throw new Error("表头与模板不一致");
  if (fields.some(field => field.required && !columns.includes(field.key))) throw new Error("缺少必填列");
  return rows.map(row => {
    if (row.length !== columns.length) throw new Error("数据列数与表头不一致");
    const record = Object.fromEntries(columns.map((key, index) => [key, row[index].trim()]));
    if (fields.some(field => field.required && !record[field.key])) throw new Error("必填字段为空");
    return record;
  });
}
