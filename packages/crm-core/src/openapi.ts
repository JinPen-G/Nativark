/** 根据实际HTTP合同生成OpenAPI贡献，不复制第三份请求字段或声明未实现的路由。 */
import { CoreOpenApiContributionSchema, coreOpenApiSchema, type CoreOpenApiContribution } from "@rental-os/core-contracts";
import { z } from "zod";
import { CRM_HTTP, CRM_HTTP_BASE, CrmErrorBodySchema } from "./http";
import { CrmTimeZoneSchema, CrmSettingsSchema, CrmPipelineSchema } from "./contracts";

/** 公共转换器故意拒绝 Effects；只显式记录 CRM 已知校验，不静默丢掉未来的新约束。 */
function crmOpenApiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodEffects) {
    const rule = schema === CrmTimeZoneSchema ? "有效 IANA 时区，由服务端 Intl.DateTimeFormat 验证"
      : schema === CrmSettingsSchema ? "来源 id 唯一，defaultSourceId 指向 active 来源"
      : schema === CrmPipelineSchema ? "流程内阶段 id 唯一" : undefined;
    if (!rule || schema._def.effect.type !== "refinement") throw new Error("CRM OpenAPI 存在未登记的运行时转换或校验");
    return { ...crmOpenApiSchema(schema.innerType()), "x-crm-runtime-validation": rule };
  }
  if (schema instanceof z.ZodObject) {
    if (schema._def.unknownKeys !== "strict" || !(schema._def.catchall instanceof z.ZodNever))
      throw new Error("CRM OpenAPI 对象必须显式禁止未知字段");
    const entries = Object.entries(schema.shape) as Array<[string, z.ZodTypeAny]>;
    return { type: "object", additionalProperties: false,
      properties: Object.fromEntries(entries.map(([name, value]) => [name, crmOpenApiSchema(value)])),
      required: entries.filter(([, value]) => !value.isOptional()).map(([name]) => name) };
  }
  if (schema instanceof z.ZodArray) {
    const structural = new z.ZodArray({ ...schema._def, type: z.string() });
    return { ...coreOpenApiSchema(structural), items: crmOpenApiSchema(schema.element) };
  }
  if (schema instanceof z.ZodDiscriminatedUnion)
    return { oneOf: schema.options.map((option: z.ZodTypeAny) => crmOpenApiSchema(option)), discriminator: { propertyName: schema.discriminator } };
  return coreOpenApiSchema(schema);
}

export function createCrmOpenApi(): CoreOpenApiContribution {
  const paths: CoreOpenApiContribution["paths"] = {}, schemas: CoreOpenApiContribution["schemas"] = {};
  const json = (name: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${name}` } } });
  schemas["crm.Error"] = coreOpenApiSchema(CrmErrorBodySchema);
  for (const [action, definition] of Object.entries(CRM_HTTP)) {
    const name = `crm.${action}`, parameters: unknown[] = [];
    const path = `/api/${CRM_HTTP_BASE}/${definition.path.replace(/:([a-zA-Z]+)/g, "{$1}")}`;
    schemas[`${name}.Response`] = { type: "object", required: ["data", "requestId"], properties: {
      data: crmOpenApiSchema(definition.response), requestId: { type: "string" }
    } };
    const operation: Record<string, unknown> = {
      operationId: name, summary: definition.summary, security: [{ bearerAuth: [] }],
      "x-core-permissions": [`crm:settings:${definition.permission}`],
      "x-core-audiences": ["operator"], "x-core-purpose": definition.purpose, "x-core-starts-new-business": definition.startsNewBusiness,
      description: "需要原operator会话、当前租户Core授权、成员分配及本动作权限。租户不从请求读取；读取范围由当前角色决定。响应沿原平台{data,requestId}信封，正文schema放在data内。",
      responses: {
        200: { description: "当前读取结果或原操作收据", content: json(`${name}.Response`) },
        400: { description: "输入不符合业务schema", content: json("crm.Error") },
        401: { description: "原宿主会话缺失或失效，按平台统一认证错误返回" },
        403: { description: "当前Core/成员/业务授权不足", content: json("crm.Error") },
        404: { description: "对象不存在或不在当前可读范围", content: json("crm.Error") },
        409: { description: "修订、状态或原操作键冲突；核对原操作，不自动换键重做", content: json("crm.Error") },
        500: { description: "存储或宿主执行失败；写入结果未明时按原操作键核对，不能自动换键重发" }
      }
    };
    if ("body" in definition) {
      schemas[`${name}.Request`] = crmOpenApiSchema(definition.body);
      operation.requestBody = { required: true, content: json(`${name}.Request`) };
    }
    if ("params" in definition) {
      const converted = coreOpenApiSchema(definition.params);
      for (const [key, value] of Object.entries(converted.properties as Record<string, unknown>))
        parameters.push({ name: key, in: "path", required: true, schema: value });
    }
    if (parameters.length) operation.parameters = parameters;
    paths[path] ??= {};
    paths[path][definition.method.toLowerCase()] = operation;
  }
  return CoreOpenApiContributionSchema.parse({ paths, schemas });
}
