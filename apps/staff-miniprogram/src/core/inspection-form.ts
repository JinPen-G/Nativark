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
  return (template?.fields ?? []).map((field) => ({ code: field.code, label: field.label, type: field.type, required: field.required, unit: field.unit ?? "", options: field.options ?? [], value: "", checked: false, photos: [] }));
}

export function inspectionResults(rows: InspectionFieldRow[]): { results: Record<string, unknown>; error?: string } {
  const results: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.type === "photo") {
      if (row.required && !row.photos.length) return { results, error: `请为${row.label}上传照片凭证` };
      if (row.photos.length) results[row.code] = row.photos.map((photo) => photo.id);
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
