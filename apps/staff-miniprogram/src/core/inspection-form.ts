import type { RentalInspectionTemplate } from "@rental-os/shared";

export interface InspectionFieldRow {
  code: string;
  label: string;
  type: "boolean" | "number" | "text" | "select" | "photo";
  required: boolean;
  unit: string;
  options: string[];
  value: string;
  checked: boolean;
}

export function inspectionRows(template: RentalInspectionTemplate | undefined): InspectionFieldRow[] {
  return (template?.fields ?? []).map((field) => ({ code: field.code, label: field.label, type: field.type, required: field.required, unit: field.unit ?? "", options: field.options ?? [], value: "", checked: false }));
}

export function inspectionResults(rows: InspectionFieldRow[]): { results: Record<string, unknown>; error?: string } {
  const results: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.type === "photo") {
      if (row.required) return { results, error: `${row.label}需要上传照片凭证；当前文件服务未提供小程序直传通道，请在运营后台办理` };
      continue;
    }
    if (row.type === "boolean") { results[row.code] = row.checked; continue; }
    const raw = row.value.trim();
    if (!raw) { if (row.required) return { results, error: `请填写${row.label}` }; continue; }
    if (row.type === "number") {
      const number = Number(raw);
      if (!Number.isFinite(number)) return { results, error: `${row.label}必须是数字` };
      results[row.code] = number;
    } else results[row.code] = raw;
  }
  return { results };
}
