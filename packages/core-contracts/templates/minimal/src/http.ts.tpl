/** 处理器、Guard 政策与 OpenAPI 共用同一声明；HTTP 挂载和当前主体读取沿受控宿主。 */
import { CoreHttpContributionSchema, CoreOpenApiContributionSchema, coreOpenApiSchema, type CorePrincipal } from "@rental-os/core-contracts";
import { CORE_ID, CORE_VERSION, ListQuerySchema, ListResponseSchema } from "./contracts";
import type { ItemService } from "./service";

export const HTTP = {
  list: { method: "GET", path: "/items", summary: "读取当前成员可见条目（至多50条）",
    query: ListQuerySchema, response: ListResponseSchema, permission: { resource: "item", action: "read" } }
} as const;
export function createHttpContribution() {
  return CoreHttpContributionSchema.parse({ coreId: CORE_ID, implementationVersion: CORE_VERSION,
    routes: Object.entries(HTTP).map(([id, route]) => ({ id, method: route.method, path: route.path,
      audiences: ["operator"], permissions: [route.permission], purpose: "business", startsNewBusiness: false })) });
}
export function createApi(service: ItemService, current: () => CorePrincipal) {
  return { async list(query: unknown) {
    HTTP.list.query.parse(query);
    return HTTP.list.response.parse(await service.list(current()));
  } };
}
export function createOpenApi() {
  const route = HTTP.list, name = `${CORE_ID}.list`;
  return CoreOpenApiContributionSchema.parse({
    paths: { [`/api/cores/${CORE_ID}${route.path}`]: { get: {
      operationId: name, summary: route.summary, security: [{ bearerAuth: [] }],
      "x-core-permissions": [`${CORE_ID}:${route.permission.resource}:${route.permission.action}`],
      "x-core-audiences": ["operator"], "x-core-purpose": "business", "x-core-starts-new-business": false,
      description: "需正式宿主挂载、原会话、Core/成员授权、精确权限及真实数据适配；未装配不可用。",
      responses: {
        200: { description: "当前授权下的列表", content: { "application/json": { schema: { $ref: `#/components/schemas/${name}.Response` } } } },
        400: { description: "不接受租户或其他查询字段" }, 401: { description: "会话缺失或失效" },
        403: { description: "当前业务权限或对象范围不足" }, 503: { description: "Core/数据/适配尚未就绪" }
      }
    } } },
    schemas: { [`${name}.Response`]: { type: "object", required: ["data", "requestId"], properties: {
      data: coreOpenApiSchema(route.response), requestId: { type: "string" }
    } } }
  });
}
