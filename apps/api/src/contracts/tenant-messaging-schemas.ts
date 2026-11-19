/** 原组合 API 消费公共消息的同源字段与路由；Rental 邀请仍要求至少一个经营空间。 */
import {
  createTenantMessagingOpenApiSchemas,
  TENANT_MESSAGING_HTTP_OPERATIONS
} from "@rental-os/platform-server/messaging";
import type { ContractOperation, SchemaObject } from "./openapi-document";

export const TENANT_MESSAGING_SCHEMAS = createTenantMessagingOpenApiSchemas("", 1) as Record<string, SchemaObject>;

export const TENANT_MESSAGING_OPERATIONS: ContractOperation[] = TENANT_MESSAGING_HTTP_OPERATIONS.map(item => ({
  method: item.method.toLowerCase() as ContractOperation["method"],
  path: "/api" + item.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, "{$1}"),
  tag: "TenantMessaging",
  operationId: item.id,
  summary: item.summary,
  permissions: "permission" in item ? [item.permission] : [],
  authRequired: item.access !== "anonymous",
  requestSchema: "request" in item ? item.request.replace(/^Messaging\./, "") : undefined,
  responseSchema: item.response.replace(/^Messaging\./, ""),
  parameters: "parameters" in item ? item.parameters.map(parameter => ({ ...parameter })) : undefined,
  successStatus: item.method === "POST" ? 201 : 200
}));
