/** 原筛选预设 DTO 与投影的接口资料，由宿主合入公共 OpenAPI。 */
import type { PlatformFilterPresetContribution } from "@rental-os/platform-contracts";
import { collectPlatformFilterPresetScopes } from "./filter-preset-scopes";

const text = { type: "string" };
const requiredText = { type: "string", minLength: 1 };
export const PLATFORM_FILTER_PRESET_QUERY_SCHEMAS = {
  "filterPresets.scopeKey": text,
  "deleteFilterPreset.operator": text
} as const;
const preset = { id: text, tenantId: text, scopeKey: text, name: text, description: text,
  filters: { type: "object", additionalProperties: true }, isDefault: { type: "boolean" },
  isSystem: { type: "boolean" }, updatedAt: { type: "string", format: "date-time" }, updatedBy: text };

export function createPlatformFilterPresetSchemas(contributions: readonly PlatformFilterPresetContribution[] = []) {
  const scope = { type: "string", enum: [...collectPlatformFilterPresetScopes(contributions)] };
  return {
  "PlatformTools.FilterPresetScopes": { type: "array", items: scope },
  "PlatformTools.FilterPreset": { type: "object",
    required: ["id", "tenantId", "scopeKey", "name", "filters", "isDefault", "isSystem", "updatedAt", "updatedBy"], properties: preset },
  "PlatformTools.FilterPresets": { type: "array", items: { $ref: "#/components/schemas/PlatformTools.FilterPreset" } },
  "PlatformTools.SaveFilterPreset": { type: "object", required: ["scopeKey", "name", "filters"], properties: {
    id: requiredText, tenantId: requiredText, scopeKey: scope,
    name: requiredText, description: text,
    filters: preset.filters, isDefault: { type: "boolean" }, operator: requiredText
  }, description: "tenantId 由当前租户覆盖，名称先去首尾空格再核 1 至 40 字符，operator 仅用于审计显示。" },
  "PlatformTools.SetFilterPresetDefault": { type: "object", properties: { operator: requiredText } },
  "PlatformTools.DeletedFilterPreset": { type: "object", required: ["id", "deleted"],
    properties: { id: text, deleted: { type: "boolean" } } }
} as const;
}
export const PLATFORM_FILTER_PRESET_SCHEMAS = createPlatformFilterPresetSchemas();
