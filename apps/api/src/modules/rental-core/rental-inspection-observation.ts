import { BadRequestException } from "@nestjs/common";
import type { RentalInspectionTemplate } from "@rental-os/shared";
import { optionalUsageReading } from "./rental-usage-reading";

/** Template-bound observations only. Does not authorize or advance a handover. */
export function assertInspectionObservations(template: RentalInspectionTemplate, results: Record<string, unknown>, strict = false): void {
  if (!results || typeof results !== "object" || Array.isArray(results)
    || Object.keys(results).some(code => code.startsWith("__"))) throw new BadRequestException("检查结果必须是有效字段对象");
  if (strict && Object.keys(results).some(code => !template.fields.some(field => field.code === code))) {
    throw new BadRequestException("检查结果包含模板以外的字段");
  }
  const missing = template.fields.filter(field => field.required && (results[field.code] === undefined || results[field.code] === null
    || typeof results[field.code] === "string" && !String(results[field.code]).trim()
    || field.type === "photo" && Array.isArray(results[field.code]) && !(results[field.code] as unknown[]).length));
  if (missing.length) throw new BadRequestException(`缺少必填检查项：${missing.map(field => field.label).join("、")}`);
  for (const field of template.fields) {
    const value = results[field.code];
    if (value === undefined || value === null || value === "") continue;
    if (strict && (field.type === "boolean" && typeof value !== "boolean"
      || field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))
      || ["text", "select"].includes(field.type) && typeof value !== "string"
      || field.type === "select" && field.options && !field.options.includes(value as string)
      || field.type === "photo" && (!Array.isArray(value) || value.some(id => typeof id !== "string" || !id.trim())))) {
      throw new BadRequestException(`检查项「${field.label}」格式无效`);
    }
    if (field.usageMetric) optionalUsageReading(value, field.label);
  }
}
