import { BadRequestException, ConflictException } from "@nestjs/common";
import type { RentalAttributeDefinition } from "@rental-os/shared";
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Date.parse can normalize impossible dates (e.g. February 30); those are not business dates. */
function validRentalAttributeDate(value: unknown): boolean {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  const day = /^(\d{4}-\d{2}-\d{2})(?:$|T)/u.exec(value);
  if (!day) return false;
  const calendarDay = new Date(`${day[1]}T00:00:00.000Z`);
  return Number.isFinite(calendarDay.getTime()) && calendarDay.toISOString().slice(0, 10) === day[1];
}

export function normalizedRentalAttributeValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return value.normalize("NFKC").trim().toUpperCase() || undefined;
  return JSON.stringify(value);
}

/** Shared by active saves and candidate-version preparation; never changes active data. */
export function validateRentalCategoryAttributes(
  fields: RentalAttributeDefinition[], scope: "item_group" | "asset",
  attributes: Record<string, unknown>, aliases: Record<string, unknown> = {}, validateRequired = true
) {
  const scoped = fields.filter((field) => field.scope === scope);
  const allowed = new Set(scoped.map((field) => field.code).filter((code) => !hasOwn(aliases, code)));
  const unknown = Object.keys(attributes).filter((code) => !allowed.has(code));
  if (unknown.length) throw new BadRequestException(`存在未定义的品类字段：${unknown.join("、")}`);
  for (const field of scoped) {
    const value = hasOwn(aliases, field.code) ? aliases[field.code] : attributes[field.code];
    const missing = value === undefined || value === null || value === "" || (typeof value === "string" && !value.trim());
    if (validateRequired && field.required && missing) throw new BadRequestException(`${field.label}不能为空`);
    if (missing) continue;
    if (field.type === "string" && typeof value !== "string") throw new BadRequestException(`${field.label}必须是文本`);
    if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw new BadRequestException(`${field.label}必须是有效数字`);
    if (field.type === "boolean" && typeof value !== "boolean") throw new BadRequestException(`${field.label}必须是布尔值`);
    if (field.type === "date" && !validRentalAttributeDate(value)) throw new BadRequestException(`${field.label}必须是有效日期`);
    if (field.type === "select" && (typeof value !== "string" || !field.options?.includes(value))) throw new BadRequestException(`${field.label}不在允许选项中`);
  }
}

/** Preflight for non-unique -> unique adoption. Final claims must still be written transactionally. */
export function prepareRentalCategoryUniqueClaims(
  fields: RentalAttributeDefinition[], scope: "item_group" | "asset",
  records: Array<{ id: string; attributes: Record<string, unknown>; aliases?: Record<string, unknown>; validateRequired?: boolean }>
) {
  const occupied = new Map<string, string>();
  const claims: Array<{ entityId: string; fieldCode: string; label: string; normalizedValue: string }> = [];
  for (const record of records) {
    validateRentalCategoryAttributes(fields, scope, record.attributes, record.aliases, record.validateRequired ?? true);
    for (const field of fields.filter((item) => item.scope === scope && item.unique)) {
      const value = hasOwn(record.aliases ?? {}, field.code) ? record.aliases![field.code] : record.attributes[field.code];
      const normalizedValue = normalizedRentalAttributeValue(value);
      if (!normalizedValue) continue;
      const identity = JSON.stringify([field.code, normalizedValue]);
      if (occupied.has(identity) && occupied.get(identity) !== record.id) throw new ConflictException(`${field.label}已存在，不能采用目标品类版本`);
      occupied.set(identity, record.id);
      claims.push({ entityId: record.id, fieldCode: field.code, label: field.label, normalizedValue });
    }
  }
  return claims;
}
