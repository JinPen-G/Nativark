export const CATEGORY_ATTRIBUTE_TYPES = ["string", "number", "boolean", "date", "select"] as const;
export const CATEGORY_INSPECTION_TYPES = ["boolean", "number", "text", "select", "photo"] as const;

export function addCategoryAttributeSchemaField(schema: Record<string, unknown>, rawCode: string, type: string) {
  const code = rawCode.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(code) || ["__proto__", "constructor", "prototype"].includes(code)) throw new Error("字段编码格式不正确");
  if (Object.prototype.hasOwnProperty.call(schema, code)) throw new Error("字段编码已存在");
  if (!CATEGORY_ATTRIBUTE_TYPES.includes(type as typeof CATEGORY_ATTRIBUTE_TYPES[number])) throw new Error("字段类型不合法");
  return { ...schema, [code]: type };
}

export function updateCategoryField(fields: Record<string, unknown>, key: string, value: unknown, inspection: boolean) {
  const updated = { ...fields, [key]: value };
  if (key === "type" && value !== "select") delete updated.options;
  if (inspection && key === "type" && value !== "number") delete updated.usageMetric;
  return updated;
}

export function categoryArrayUsesTags(name: string, value: unknown[]) {
  return !["assetFields", "inspectionFields"].includes(name) && value.every((entry) => typeof entry === "string");
}
