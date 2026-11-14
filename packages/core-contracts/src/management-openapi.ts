/** 平台Core管理的接口资料从正式HTTP输入输出生成，动态初始化配置由所属Core补充。 */
import { BindCoreScopeSchema } from "./lifecycle";
import { CORE_MANAGEMENT_HTTP, CORE_MANAGEMENT_HTTP_BASE, CoreRegisteredSummarySchema } from "./management-http";
import { CoreSourceSchema } from "./manifest";
import { CoreVersionRangeSchema } from "./version";
import { coreOpenApiSchema } from "./schema";
import type { CoreOpenApiContribution } from "./openapi";

export function createCoreManagementOpenApi(): CoreOpenApiContribution {
  const paths: CoreOpenApiContribution["paths"] = {}, schemas: CoreOpenApiContribution["schemas"] = {};
  const json = (name: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${name}` } } });
  const registered = coreOpenApiSchema(CoreRegisteredSummarySchema.omit({ source: true, compatibility: true }));
  const registeredProperties = registered.properties as Record<string, unknown>;
  const source = coreOpenApiSchema(CoreSourceSchema.extend({ repository: CoreSourceSchema.shape.repository.innerType() }));
  source.description = "来源使用不含凭据、查询和片段的HTTPS仓库地址，提交固定为40位摘要。";
  const range = coreOpenApiSchema(CoreVersionRangeSchema.innerType());
  range.description = "包含minInclusive、不含maxExclusive，上限必须大于下限，由正式版本合同验证。";
  registeredProperties.source = source;
  registeredProperties.compatibility = { type: "object", required: ["platform", "contract"], additionalProperties: false,
    properties: { platform: range, contract: range } };
  registered.required = [...registered.required as string[], "source", "compatibility"];
  for (const [key, declaration] of Object.entries(CORE_MANAGEMENT_HTTP)) {
    const name = `PlatformCore.${key}`;
    schemas[`${name}.Response`] = { type: "object", required: ["data", "requestId"], properties: {
      data: key === "registered" ? { type: "array", items: registered } : coreOpenApiSchema(declaration.response), requestId: { type: "string" }
    } };
    const operation: Record<string, unknown> = {
      operationId: `platformCore_${key}`, summary: declaration.summary, tags: ["Platform Core"], security: [{ bearerAuth: [] }],
      "x-requiredPermissions": [declaration.permission], "x-core-management-audience": declaration.audience,
      description: declaration.audience === "saas"
        ? "需要原operator签名会话、当前SaaS管理身份及租户管理权限。登记、租户授权、成员分配及业务就绪分别成立。"
        : "需要原operator签名会话及当前租户管理权限。租户从原主体确定；成员分配与业务范围分别核验。初始化收据只读核对原主体与操作。",
      responses: {
        200: { description: "原读取结果或本次原操作收据", content: json(`${name}.Response`) },
        400: { description: "输入不符合正式schema" },
        401: { description: "原会话缺失、撤销、切换或到期" },
        403: { description: "当前管理权、Core使用权或业务范围不足" },
        409: { description: "对象修订或原操作键冲突，先读取原操作和当前事实" },
        503: { description: "Core部署、数据或必需适配尚未就绪" },
        500: { description: "存储或提交失败，结果未知时按原操作查询" }
      }
    };
    if ("request" in declaration) {
      const schema = declaration.request === BindCoreScopeSchema
        ? coreOpenApiSchema(BindCoreScopeSchema.omit({ configuration: true })) : coreOpenApiSchema(declaration.request);
      if (declaration.request === BindCoreScopeSchema) {
        const properties = schema.properties as Record<string, unknown>;
        properties.configuration = { description: "所属Core的初始化配置，由其唯一schema解析；已有绑定配置调整走Core业务接口。" };
      }
      schemas[`${name}.Request`] = schema;
      operation.requestBody = { required: true, content: json(`${name}.Request`) };
    }
    paths[`/api/${CORE_MANAGEMENT_HTTP_BASE}/${declaration.path}`] = { [declaration.method.toLowerCase()]: operation };
  }
  return { paths, schemas };
}
