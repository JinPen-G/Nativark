/** 业务schema、Nest路由、Guard政策与OpenAPI的同源声明；当前租户只来自原身份。 */
import { z } from "zod";
import { CoreHttpContributionSchema } from "@rental-os/core-contracts";
import { CORE_ID, CORE_VERSION, IdSchema, ItemViewSchema, ListQuerySchema, ListResponseSchema,
  CreateItemSchema, UpdateItemSchema, ArchiveItemSchema, ReceiptSchema, ReceiptLookupSchema } from "./contracts";

export const HTTP_BASE = "cores/{{CORE_ID}}";
const params = z.object({ itemId: IdSchema }).strict();
export const ErrorBodySchema = z.object({ code: z.string(), message: z.string() }).strict();
export const HTTP = {
  list: { method: "GET", path: "items", permission: "read", purpose: "business", startsNewBusiness: false,
    summary: "读取本人的条目页与同范围总数", query: ListQuerySchema, response: ListResponseSchema },
  get: { method: "GET", path: "items/:itemId", permission: "read", purpose: "business", startsNewBusiness: false,
    summary: "读取本人的条目详情", params, response: ItemViewSchema },
  receipt: { method: "GET", path: "operations/:operationId", permission: "read", purpose: "original_receipt", startsNewBusiness: false,
    summary: "核对本人的原操作回执", params: z.object({ operationId: IdSchema }).strict(), response: ReceiptLookupSchema },
  create: { method: "POST", path: "items", permission: "create", purpose: "business", startsNewBusiness: true,
    summary: "创建条目", body: CreateItemSchema, response: ReceiptSchema },
  update: { method: "POST", path: "items/:itemId/update", permission: "update", purpose: "business", startsNewBusiness: false,
    summary: "编辑未归档条目", params, body: UpdateItemSchema.omit({ itemId: true }), response: ReceiptSchema },
  archive: { method: "POST", path: "items/:itemId/archive", permission: "archive", purpose: "business", startsNewBusiness: false,
    summary: "归档条目并保留历史", params, body: ArchiveItemSchema.omit({ itemId: true }), response: ReceiptSchema }
} as const;
export function createHttpContribution() {
  return CoreHttpContributionSchema.parse({ coreId: CORE_ID, implementationVersion: CORE_VERSION,
    routes: Object.entries(HTTP).map(([id, route]) => ({ id, method: route.method, path: `/${route.path}`,
      audiences: ["operator"], permissions: [{ resource: "item", action: route.permission }],
      purpose: route.purpose, startsNewBusiness: route.startsNewBusiness })) });
}
