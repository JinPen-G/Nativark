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
  photos: Array<{ id: string; path: string }>;
}

export function inspectionRows(template: RentalInspectionTemplate | undefined): InspectionFieldRow[] {
  for (const field of template?.fields ?? []) {
    if (!["boolean", "number", "text", "select", "photo"].includes(field.type)) throw new Error(`当前员工端不支持检查字段${field.label}的类型，请升级后重试`);
  }
  return (template?.fields ?? []).map((field) => ({ code: field.code, label: field.label, type: field.type, required: field.required, unit: field.unit ?? "", options: field.options ?? [], value: "", checked: false, photos: [] }));
}

export function inspectionResults(rows: InspectionFieldRow[]): { results: Record<string, unknown>; error?: string } {
  const results: Record<string, unknown> = {};
  for (const row of rows) {
    if (!["boolean", "number", "text", "select", "photo"].includes(row.type)) return { results, error: `不支持检查字段${row.label}的类型` };
    if (row.type === "photo") {
      if (row.required && !row.photos.length) return { results, error: `请为${row.label}上传照片凭证` };
      if (row.photos.length) results[row.code] = row.photos.map((photo) => photo.id);
      continue;
    }
    if (row.type === "boolean") { results[row.code] = row.checked; continue; }
    const raw = row.value.trim();
    if (!raw) { if (row.required) return { results, error: `请填写${row.label}` }; continue; }
    if (row.type === "select" && !row.options.includes(raw)) return { results, error: `请从${row.label}的可选值中选择` };
    if (row.type === "number") {
      const number = Number(raw);
      if (!Number.isFinite(number)) return { results, error: `${row.label}必须是数字` };
      results[row.code] = number;
    } else results[row.code] = raw;
  }
  return { results };
}
