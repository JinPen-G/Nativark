/** 第三方配置与测试公开投影。秘密输入标记writeOnly，返回值仅含配置标志与原测试结果。 */
import { TENANT_INTEGRATION_PROVIDERS } from "@rental-os/platform-contracts/tenant-integrations";

type Schema = { [field: string]: unknown };
const text: Schema = { type: "string" };
const boolean: Schema = { type: "boolean" };
const strings: Schema = { type: "array", items: text };
const object = (properties: Record<string, Schema>, required: string[] = [], additionalProperties = false): Schema =>
  ({ type: "object", properties, required, additionalProperties });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/Integration.${name}` });
const capability: Schema = { type: "string", enum: ["sms", "email", "payment", "file"] };
const provider: Schema = { type: "string", enum: TENANT_INTEGRATION_PROVIDERS.map(item => item.provider) };
const settings: Schema = { type: "object", additionalProperties: { type: ["string", "boolean", "number", "null"] } };

export const INTEGRATION_OPENAPI_SCHEMAS = {
  "Integration.ProviderField": object({ key: text, label: text, secret: boolean, required: boolean,
    inputType: { type: "string", enum: ["text", "password", "number", "url", "boolean"] }, placeholder: text, description: text },
  ["key", "label", "secret", "required", "inputType"]),
  "Integration.Provider": object({ capability, provider, name: text, description: text,
    fields: { type: "array", items: ref("ProviderField") }, supportedMethods: strings, settlementCurrencies: strings,
    audience: { type: "string", enum: ["domestic", "cross_border"] } }, ["capability", "provider", "name", "description", "fields"]),
  "Integration.Configuration": object({ id: text, capability, provider, enabled: boolean, isDefault: boolean, settings,
    secrets: object({ configured: boolean, fields: strings }, ["configured", "fields"]),
    lastTestStatus: { type: "string", enum: ["not_tested", "passed", "failed"] },
    lastTestMode: { type: "string", enum: ["none", "configuration", "live"] },
    lastTestAt: { type: "string", format: "date-time" }, lastTestError: text,
    createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } },
  ["id", "capability", "provider", "enabled", "isDefault", "settings", "secrets", "lastTestStatus", "lastTestMode", "createdAt", "updatedAt"]),
  "Integration.Catalog": object({ providers: { type: "array", items: ref("Provider") },
    configs: { type: "array", items: ref("Configuration") } }, ["providers", "configs"]),
  "Integration.SaveConfig": object({ enabled: boolean, isDefault: boolean, settings,
    credentials: { type: "object", writeOnly: true, additionalProperties: { type: "string", writeOnly: true } } },
  ["enabled", "isDefault", "settings"]),
  "Integration.TestResult": object({ capability, provider, ok: boolean,
    mode: { type: "string", enum: ["configuration", "live"] }, message: text,
    checkedAt: { type: "string", format: "date-time" }, missingFields: strings },
  ["capability", "provider", "ok", "mode", "message", "checkedAt", "missingFields"])
};
