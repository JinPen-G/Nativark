/** 根据实际HTTP合同生成OpenAPI贡献，不复制第三份请求字段或声明未实现的路由。 */
import { CoreOpenApiContributionSchema, coreOpenApiSchema, type CoreOpenApiContribution } from "@rental-os/core-contracts";
import { TICKETS_HTTP, TICKETS_HTTP_BASE, TicketErrorBodySchema } from "./http";

export function createTicketsOpenApi(): CoreOpenApiContribution {
  const paths: CoreOpenApiContribution["paths"] = {}, schemas: CoreOpenApiContribution["schemas"] = {};
  const json = (name: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${name}` } } });
  schemas["example-tickets.Error"] = coreOpenApiSchema(TicketErrorBodySchema);
  for (const [action, definition] of Object.entries(TICKETS_HTTP)) {
    const name = `example-tickets.${action}`, parameters: unknown[] = [];
    const path = `/api/${TICKETS_HTTP_BASE}/${definition.path.replace(/:([a-zA-Z]+)/g, "{$1}")}`;
    schemas[`${name}.Response`] = { type: "object", required: ["data", "requestId"], properties: {
      data: coreOpenApiSchema(definition.response), requestId: { type: "string" }
    } };
    const operation: Record<string, unknown> = {
      operationId: name, summary: definition.summary, security: [{ bearerAuth: [] }],
      "x-core-permissions": [`example-tickets:ticket:${definition.permission}`],
      description: "需要原operator会话、当前租户Core授权、成员分配及本动作权限。租户不从请求读取；读取范围由当前角色决定。响应沿原平台{data,requestId}信封，正文schema放在data内。",
      responses: {
        200: { description: "当前读取结果或原操作收据", content: json(`${name}.Response`) },
        400: { description: "输入不符合业务schema", content: json("example-tickets.Error") },
        401: { description: "原宿主会话缺失或失效，按平台统一认证错误返回" },
        403: { description: "当前Core/成员/业务授权不足", content: json("example-tickets.Error") },
        404: { description: "对象不存在或不在当前可读范围", content: json("example-tickets.Error") },
        409: { description: "修订、状态或原操作键冲突；核对原操作，不自动换键重做", content: json("example-tickets.Error") },
        500: { description: "存储或宿主执行失败；写入结果未明时按原操作键核对，不能自动换键重发" }
      }
    };
    if ("body" in definition) {
      schemas[`${name}.Request`] = coreOpenApiSchema(definition.body);
      operation.requestBody = { required: true, content: json(`${name}.Request`) };
    }
    for (const part of ["params", "query"] as const) {
      if (!(part in definition)) continue;
      const schema = part === "params" && "params" in definition ? definition.params : "query" in definition ? definition.query : undefined;
      if (!schema) continue;
      const converted = coreOpenApiSchema(schema);
      const required = new Set(converted.required as string[] | undefined);
      for (const [key, value] of Object.entries(converted.properties as Record<string, unknown>))
        parameters.push({ name: key, in: part === "params" ? "path" : "query", required: part === "params" || required.has(key), schema: value });
    }
    if (parameters.length) operation.parameters = parameters;
    paths[path] ??= {};
    paths[path][definition.method.toLowerCase()] = operation;
  }
  return CoreOpenApiContributionSchema.parse({ paths, schemas });
}
