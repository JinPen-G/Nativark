export const CATEGORY_ATTRIBUTE_TYPES = ["string", "number", "boolean", "date", "select"] as const;
export const CATEGORY_INSPECTION_TYPES = ["boolean", "number", "text", "select", "photo"] as const;

export function updateCategoryField(fields: Record<string, unknown>, key: string, value: unknown, inspection: boolean) {
  const updated = { ...fields, [key]: value };
  if (key === "type" && value !== "select") delete updated.options;
  if (inspection && key === "type" && value !== "number") delete updated.usageMetric;
  return updated;
}

export function categoryArrayUsesTags(name: string, value: unknown[]) {
  return !["assetFields", "inspectionFields"].includes(name) && value.every((entry) => typeof entry === "string");
}
