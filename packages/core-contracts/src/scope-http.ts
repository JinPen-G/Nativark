/** 当前成员读取自身Core范围与就绪；请求不含主体，解析/读取不初始化或执行业务。 */
import { z } from "zod";
import { CoreScopeBindingQuerySchema } from "./management-http";
import { CoreBindingSchema, CoreReadinessSchema } from "./lifecycle";
import { coreOpenApiSchema } from "./schema";
import type { CoreOpenApiContribution } from "./openapi";

export const CoreScopeObservationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unbound") }).strict(),
  z.object({ status: z.literal("bound"), binding: CoreBindingSchema, readiness: CoreReadinessSchema }).strict()
]);
export type CoreScopeObservation = z.infer<typeof CoreScopeObservationSchema>;
export const CORE_SCOPE_HTTP = { method: "POST", path: "platform/core-host/scope/read",
  summary: "读取本人Core范围绑定与业务就绪", request: CoreScopeBindingQuerySchema, response: CoreScopeObservationSchema } as const;

export function createCoreScopeOpenApi(): CoreOpenApiContribution {
  const json = (name: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${name}` } } });
  return { paths: { [`/api/${CORE_SCOPE_HTTP.path}`]: { post: {
    operationId: "platformCore_scopeRead", summary: CORE_SCOPE_HTTP.summary, tags: ["Platform Core"], security: [{ bearerAuth: [] }],
    description: "当前operator会话读取本人获权Core及自身容器。主体来自原认证；Core独立裁定业务范围、绑定和就绪。读取不会首次初始化或授予使用权。",
    requestBody: { required: true, content: json("PlatformCore.Scope.Request") },
    responses: { 200: { description: "未建立绑定，或当前绑定及真实就绪", content: json("PlatformCore.Scope.Response") },
      400: { description: "范围不符合Core声明" }, 401: { description: "原会话不可用" },
      403: { description: "当前Core使用权或自身业务范围不足" }, 409: { description: "读取期间绑定已变化" },
      503: { description: "Core注册、部署或数据未就绪" }, 500: { description: "实际范围或就绪读取失败" } }
  } } }, schemas: { "PlatformCore.Scope.Request": coreOpenApiSchema(CORE_SCOPE_HTTP.request),
    "PlatformCore.Scope.Response": { type: "object", required: ["data", "requestId"], properties: {
      data: coreOpenApiSchema(CORE_SCOPE_HTTP.response), requestId: { type: "string" }
    } } } };
}
