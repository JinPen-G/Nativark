/** 同源 HTTP 合同形状与 OpenAPI 3.0 渲染。只描述原请求/响应及权限声明，执行授权由原 Guard 和业务应用裁定。 */
import { RENTAL_CATEGORY_CODE_PATTERN, ADMIN_UI_CORNER_RADIUS_MIN, ADMIN_UI_CORNER_RADIUS_MAX, ADMIN_UI_CORNER_RADIUS_CONTROL_MAX } from "@rental-os/shared";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface SchemaObject {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  example?: unknown;
  default?: unknown;
  enum?: (string | number | boolean | null)[];
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  not?: SchemaObject;
  allOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  writeOnly?: boolean;
  readOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  items?: SchemaObject;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  oneOf?: SchemaObject[];
  properties?: Record<string, SchemaObject>;
  minProperties?: number;
  maxProperties?: number;
  required?: readonly string[];
  additionalProperties?: boolean | SchemaObject;
  nullable?: boolean;
}

export interface ParameterObject {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  description?: string;
  schema: SchemaObject;
}

export interface ContractOperation {
  method: HttpMethod;
  path: string;
  tag: string;
  operationId: string;
  summary: string;
  permissions: string[];
  authRequired?: boolean;
  requestSchema?: string | SchemaObject;
  /** 缺省仍要求请求正文；false 用于兼容原无正文调用。 */
  requestRequired?: boolean;
  responseSchema?: string | SchemaObject;
  successStatus?: 200 | 201;
  parameters?: ParameterObject[];
  requestContentType?: string;
  requestEncoding?: Record<string, { contentType: string }>;
  rawResponseContentType?: string | readonly string[];
  responseHeaders?: Record<string, { description?: string; schema: SchemaObject }>;
  /** 原 302 跳转响应，复用既有响应头结构。 */
  redirectResponse?: { description: string; headers: NonNullable<ContractOperation["responseHeaders"]> };
  errorResponses?: Record<string, { description: string; schema: string | SchemaObject }>;
  rateLimited?: boolean;
  serviceUnavailableReason?: string;
}

export const stringSchema: SchemaObject = { type: "string" };

export const rentalCategoryCodeSchema: SchemaObject = { type: "string", pattern: RENTAL_CATEGORY_CODE_PATTERN.source, minLength: 2, maxLength: 64 };

export const numberSchema: SchemaObject = { type: "number" };

export const booleanSchema: SchemaObject = { type: "boolean" };

export const objectSchema: SchemaObject = { type: "object", additionalProperties: true };

export function ref(name: string): SchemaObject {
  return { $ref: `#/components/schemas/${name}` };
}

export function arrayOf(schema: string | SchemaObject): SchemaObject {
  return {
    type: "array",
    items: typeof schema === "string" ? ref(schema) : schema
  };
}

export function objectOf(
  properties: Record<string, SchemaObject>,
  required: string[] = [],
  additionalProperties: boolean | SchemaObject = true
): SchemaObject {
  return {
    type: "object",
    properties,
    required,
    additionalProperties
  };
}

export function queryParam(name: string, schema: SchemaObject = stringSchema): ParameterObject {
  return {
    name,
    in: "query",
    required: false,
    schema
  };
}

function toSchema(schema?: string | SchemaObject): SchemaObject {
  if (!schema) {
    return objectSchema;
  }
  return typeof schema === "string" ? ref(schema) : schema;
}

function apiResult(schema?: string | SchemaObject): SchemaObject {
  return objectOf(
    {
      data: toSchema(schema),
      requestId: stringSchema
    },
    schema === "Subscription.Void" ? ["requestId"] : ["data", "requestId"]
  );
}

function pathParameters(path: string, parameters: ParameterObject[] = []) {
  const names = Array.from(path.matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
  const existing = new Set(parameters.map((parameter) => `${parameter.in}:${parameter.name}`));
  const inferred = names
    .filter((name) => !existing.has(`path:${name}`))
    .map((name) => ({
      name,
      in: "path" as const,
      required: true,
      schema: stringSchema
    }));

  return [...inferred, ...parameters];
}

function operation(config: ContractOperation) {
  const parameters = pathParameters(config.path, config.parameters);
  const securityRequired = config.authRequired || config.permissions.length > 0;
  const responseContentTypes = typeof config.rawResponseContentType === "string"
    ? [config.rawResponseContentType]
    : config.rawResponseContentType ?? ["application/json"];
  const responseSchema = config.rawResponseContentType || config.path === "/api/openapi.json"
    ? toSchema(config.responseSchema)
    : apiResult(config.responseSchema);
  const item: Record<string, unknown> = {
    tags: [config.tag],
    operationId: config.operationId,
    summary: config.summary,
    parameters,
    security: securityRequired ? [{ bearerAuth: [] }] : [],
    "x-requiredPermissions": config.permissions,
    "x-permissionMode": config.permissions.length > 0 ? "any" : "none",
    responses: {
      [String(config.successStatus ?? 200)]: {
        description: "Success",
        content: Object.fromEntries(responseContentTypes.map(contentType => [contentType, { schema: responseSchema }])),
        ...(config.responseHeaders ? { headers: config.responseHeaders } : {})
      }
    }
  };

  if (config.requestSchema) {
    item.requestBody = {
      required: config.requestRequired ?? true,
      content: {
        [config.requestContentType ?? "application/json"]: {
          schema: toSchema(config.requestSchema),
          ...(config.requestEncoding ? { encoding: config.requestEncoding } : {})
        }
      }
    };
  }

  if (config.redirectResponse) {
    (item.responses as Record<string, unknown>)["302"] = config.redirectResponse;
  }

  if (config.serviceUnavailableReason) {
    // 未激活的客户端契约不能在文档中伪装成已经可成功创建真实支付。
    item.responses = { "503": { description: config.serviceUnavailableReason, content: { "application/json": { schema: objectSchema } } } };
  }

  for (const [status, response] of Object.entries(config.errorResponses ?? {})) {
    (item.responses as Record<string, unknown>)[status] = {
      description: response.description,
      content: { "application/json": { schema: toSchema(response.schema) } }
    };
  }

  if (config.rateLimited) {
    (item.responses as Record<string, unknown>)["429"] = {
      description: "Client request rate limit exceeded",
      content: { "application/json": { schema: objectSchema } }
    };
  }

  return item;
}

export function buildPaths(operations: ContractOperation[]) {
  const paths: Record<string, Record<HttpMethod, unknown>> = {};
  for (const item of operations) {
    paths[item.path] ??= {} as Record<HttpMethod, unknown>;
    paths[item.path][item.method] = operation(item);
  }
  return paths;
}

export function backlogOperation(
  method: HttpMethod,
  path: string,
  tag: string,
  operationId: string,
  summary: string,
  permissions: string[] = [],
  authRequired = true,
  requestSchema?: string,
  responseSchema?: string,
  parameters?: ParameterObject[]
): ContractOperation {
  return {
    method,
    path,
    tag,
    operationId,
    summary,
    permissions,
    authRequired,
    requestSchema: requestSchema ?? (method === "get" || method === "delete" ? undefined : "GenericObject"),
    responseSchema: responseSchema ?? "GenericObject",
    parameters
  };
}

export function clientOperation(
  method: HttpMethod,
  path: string,
  operationId: string,
  summary: string,
  options: { requestSchema?: string | SchemaObject; responseSchema?: string | SchemaObject; authRequired?: boolean; parameters?: ParameterObject[]; rawResponseContentType?: string; rateLimited?: boolean; serviceUnavailableReason?: string } = {}
): ContractOperation {
  return {
    method,
    path,
    tag: "Client",
    operationId,
    summary,
    permissions: [],
    authRequired: options.authRequired ?? true,
    requestSchema: options.requestSchema,
    responseSchema: options.responseSchema ?? "GenericObject",
    parameters: options.parameters,
    rawResponseContentType: options.rawResponseContentType,
    rateLimited: options.rateLimited ?? true,
    serviceUnavailableReason: options.serviceUnavailableReason
  };
}

// 保留原认证投影中的历史圆角配置值，读取不改写存量配置。
export const storedAdminRadiusSchema: SchemaObject = { type: "integer", description: "保留历史配置值；后台显示按容器 4–20px、按钮/输入 4–16px 收敛，读取不改库。无覆盖时分别默认 12/8/8px。" };

export const adminContainerRadiusInput: SchemaObject = { type: "integer", nullable: true, minimum: ADMIN_UI_CORNER_RADIUS_MIN, maximum: ADMIN_UI_CORNER_RADIUS_MAX, description: "省略保留，null 清除覆盖。只接受当前常用范围；未配置容器默认 12px。" };

export const adminControlRadiusInput: SchemaObject = { type: "integer", nullable: true, minimum: ADMIN_UI_CORNER_RADIUS_MIN, maximum: ADMIN_UI_CORNER_RADIUS_CONTROL_MAX, description: "省略保留，null 清除覆盖。只接受当前常用范围；未配置按钮/输入默认 8px。" };
