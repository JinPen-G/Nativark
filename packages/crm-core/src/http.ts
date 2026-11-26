/** HTTP 政策、Nest 入口和 OpenAPI 共用本表；配置用途在 HTTP 中仍属 business。 */
import { z } from "zod";
import { CoreHttpContributionSchema, type CoreHttpContribution } from "@rental-os/core-contracts";
import { CRM_CORE_ID, CRM_CORE_VERSION, CrmIdSchema, CrmConfigurationSchema, CrmReceiptLookupSchema,
  CrmSettingsReceiptSchema, UpdateCrmSettingsSchema } from "./contracts";
export const CRM_HTTP_BASE = "cores/crm";
export const CrmErrorBodySchema = z.object({ code: z.string(), message: z.string() }).strict();
export const CRM_HTTP = {
  settings: { method: "GET", path: "settings", permission: "manage", purpose: "business", startsNewBusiness: false,
    summary: "读取 CRM 配置和当前销售流程版本", response: CrmConfigurationSchema },
  updateSettings: { method: "POST", path: "settings", permission: "manage", purpose: "business", startsNewBusiness: false,
    summary: "按修订更新 CRM 配置", body: UpdateCrmSettingsSchema, response: CrmSettingsReceiptSchema },
  receipt: { method: "GET", path: "operations/:operationId", permission: "manage", purpose: "original_receipt", startsNewBusiness: false,
    summary: "核对本人原配置操作", params: z.object({ operationId: CrmIdSchema }).strict(), response: CrmReceiptLookupSchema }
} as const;
export function createCrmHttpContribution(): CoreHttpContribution {
  return CoreHttpContributionSchema.parse({ coreId: CRM_CORE_ID, implementationVersion: CRM_CORE_VERSION,
    routes: Object.entries(CRM_HTTP).map(([id, route]) => ({ id: id.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), method: route.method, path: `/${route.path}`,
      audiences: ["operator"], permissions: [{ resource: "settings", action: route.permission }],
      purpose: route.purpose, startsNewBusiness: route.startsNewBusiness })) });
}
