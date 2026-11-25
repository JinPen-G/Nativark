/** 原字典、编号DTO及响应字段，供宿主OpenAPI组合消费。 */
import { PLATFORM_NUMBER_DATE_PATTERNS, PLATFORM_NUMBER_RESET_CYCLES } from "./platform-tools.values";

const text = { type: "string" };
const requiredText = { type: "string", minLength: 1 };
const boolean = { type: "boolean" };
const item = { type: "object", required: ["code", "label", "value", "sortNo", "enabled"], properties: {
  code: requiredText, label: requiredText, value: text, sortNo: { type: "integer" }, enabled: boolean, remark: text
} };
const dictionary = { code: text, name: requiredText, module: requiredText, description: text,
  items: { type: "array", items: item }, updatedAt: text, updatedBy: text };
const numberRule = { code: text, name: requiredText, module: requiredText, prefix: text,
  datePattern: { type: "string", enum: [...PLATFORM_NUMBER_DATE_PATTERNS] }, sequenceLength: { type: "integer", minimum: 1 },
  currentSequence: { type: "integer", minimum: 0 }, resetCycle: { type: "string", enum: [...PLATFORM_NUMBER_RESET_CYCLES] },
  enabled: boolean, sample: text, updatedAt: text, updatedBy: text };

export const PLATFORM_TOOLS_SCHEMAS = {
  "PlatformTools.Dictionary": { type: "object", required: ["code", "name", "module", "items", "updatedAt", "updatedBy"], properties: dictionary },
  "PlatformTools.Dictionaries": { type: "array", items: { $ref: "#/components/schemas/PlatformTools.Dictionary" } },
  "PlatformTools.SaveDictionary": { type: "object", required: ["name", "module", "items", "operator"], properties: {
    name: dictionary.name, module: dictionary.module, description: dictionary.description, items: dictionary.items, operator: requiredText
  } },
  "PlatformTools.NumberRule": { type: "object", required: Object.keys(numberRule), properties: numberRule },
  "PlatformTools.NumberRules": { type: "array", items: { $ref: "#/components/schemas/PlatformTools.NumberRule" } },
  "PlatformTools.SaveNumberRule": { type: "object", required: ["name", "module", "prefix", "datePattern", "sequenceLength", "resetCycle", "enabled", "operator"], properties: {
    name: numberRule.name, module: numberRule.module, prefix: numberRule.prefix, datePattern: numberRule.datePattern,
    sequenceLength: numberRule.sequenceLength, currentSequence: numberRule.currentSequence, resetCycle: numberRule.resetCycle,
    enabled: boolean, operator: requiredText
  }, description: "服务层沿原规则要求流水长度3至12。省略当前流水时在锁内保留当前值，resetCycle沿原配置保留。" },
  "PlatformTools.GenerateNumber": { type: "object", required: ["code", "operator"], properties: { code: requiredText, operator: requiredText } },
  "PlatformTools.GeneratedNumber": { type: "object", required: ["code", "generatedNo", "nextSequence"], properties: {
    code: text, generatedNo: text, nextSequence: { type: "integer" }
  } }
} as const;
