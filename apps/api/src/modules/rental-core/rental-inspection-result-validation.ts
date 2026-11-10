/** Template facts only. Shared non-empty/usage validation preserves the original
 * fulfillment semantics; strict preparation never accepts media or charge inputs. */
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { RentalInspectionTemplate } from "@rental-os/shared";
import { optionalUsageReading } from "./rental-usage-reading";
export function assertInspectionRequiredResults(template: RentalInspectionTemplate, results: Record<string, unknown>): void {
  const missing = template.fields.filter(field => field.required && (results[field.code] === undefined || results[field.code] === null
    || typeof results[field.code] === "string" && !String(results[field.code]).trim()));
  if (missing.length) throw new BadRequestException(`缺少必填检查项：${missing.map(field => field.label).join("、")}`);
  template.fields.filter(field => field.usageMetric).forEach(field => optionalUsageReading(results[field.code], field.label));
}
export function preparedInspectionResults(template: RentalInspectionTemplate, input: Record<string, unknown>): Record<string, string | number | boolean> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 100 || template.fields.length > 100) throw new BadRequestException("检查结果超出模板范围");
  const codes = new Set<string>();
  for (const field of template.fields) {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(field.code) || ["__proto__", "constructor", "prototype"].includes(field.code) || codes.has(field.code) || !["boolean", "number", "text", "select", "photo"].includes(field.type)) throw new ConflictException("原检查模板字段不可核验");
    codes.add(field.code);
    if (field.type === "photo" && field.required) throw new ConflictException("生效前换货检查影像来源未接通，不能省略必需照片");
    if (field.usageMetric && field.type !== "number") throw new ConflictException("原计量字段类型不可核验");
  }
  if (Object.keys(input).some(code => !codes.has(code))) throw new BadRequestException("检查结果包含未知字段");
  assertInspectionRequiredResults(template, input);
  const result: Record<string, string | number | boolean> = {};
  for (const field of template.fields) {
    const value = input[field.code];
    if (value === undefined || value === null || typeof value === "string" && !value.trim()) continue;
    if (field.type === "photo") throw new ConflictException("生效前换货检查影像来源未接通，不能接收附件引用");
    if (field.type === "number") {
      if (field.usageMetric) { result[field.code] = optionalUsageReading(value, field.label)!; continue; }
      if (typeof value !== "number" || !Number.isFinite(value)) throw new BadRequestException(`${field.label}必须是有限数字`);
    } else if (field.type === "boolean") {
      if (typeof value !== "boolean") throw new BadRequestException(`${field.label}必须是布尔值`);
    } else {
      if (typeof value !== "string" || value.length > 1000) throw new BadRequestException(`${field.label}必须是有界文本`);
      if (field.type === "select" && (!field.options?.length || !field.options.includes(value))) throw new BadRequestException(`${field.label}不在原模板选项中`);
    }
    result[field.code] = value as string | number | boolean;
  }
  return result;
}
