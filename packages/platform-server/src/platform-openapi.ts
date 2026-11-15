/** 公共宿主同版本接口资料；只组合已登记公共HTTP，不加载行业文档或开放业务工具。 */
import { Controller, Get, Inject } from "@nestjs/common";
import type { AuthUser, TenantIdentity, TenantAppearanceProfile, SaveTenantAppearanceRequest } from "@rental-os/platform-contracts";
import { PLATFORM_HTTP_OPERATIONS } from "./platform-http-policy";
import { RAW_HTTP_RESPONSE } from "./common/request-id.interceptor";

type Schema = { [field: string]: unknown };
const string: Schema = { type: "string" }, boolean: Schema = { type: "boolean" };
const integer: Schema = { type: "integer" }, strings: Schema = { type: "array", items: string };
const object = (properties: Record<string, Schema>, required: readonly string[] = [], additionalProperties = false): Schema =>
  ({ type: "object", properties, required, additionalProperties });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/Platform.${name}` });
const password: Schema = { type: "string", format: "password", writeOnly: true };
const date: Schema = { type: "string", format: "date-time" };
const location = object({ mode: { type: "string", enum: ["all", "selected"] }, locationIds: strings }, ["mode", "locationIds"]);
const storedRadius: Schema = { type: "integer", minimum: 0, description: "历史值保持可读，界面按当前圆角范围显示；读取不会重写配置。" };
const radius = (maximum: number): Schema => ({ type: "integer", minimum: 4, maximum, nullable: true });

export const PLATFORM_OPENAPI_SCHEMAS = {
  "Platform.Health": object({ service: string, status: string, time: date }, ["service", "status", "time"]),
  "Platform.OpenApi": { type: "object", additionalProperties: true },
  "Platform.LoginRequest": object({ tenantCode: string, account: string, password }, ["tenantCode", "account", "password"]),
  "Platform.RefreshSessionRequest": object({ refreshToken: { type: "string", writeOnly: true } }, ["refreshToken"]),
  "Platform.ChangePasswordRequest": object({ currentPassword: password, newPassword: { ...password, minLength: 8 } }, ["currentPassword", "newPassword"]),
  "Platform.AuthUser": object({
    id: string, tenantId: string, account: string, displayName: string, roleNames: strings, roleIds: strings,
    scope: string, dataScope: { type: "string", enum: ["all", "organization", "store", "own"] }, locationScope: location,
    organizationId: string, organizationName: string, isPlatformAdmin: boolean, isSaasAdmin: boolean, mustChangePassword: boolean,
    permissions: strings, accountThemeColor: string,
    tenantMembership: object({ permissions: strings, dataScope: string, isTenantAdmin: boolean }, ["permissions", "dataScope", "isTenantAdmin"])
  } satisfies Record<keyof AuthUser, Schema>, ["id", "tenantId", "account", "displayName", "roleNames", "scope"]),
  "Platform.Tenant": object({ tenantId: string, tenantCode: string, tenantName: string, operatorShortName: { ...string, maxLength: 64 },
    tenantStatus: { type: "string", enum: ["active", "frozen", "disabled"] }, brandName: string, brandLogoUrl: string, faviconUrl: string,
    themeColor: string, adminCornerRadius: storedRadius, adminContainerRadius: storedRadius, adminButtonRadius: storedRadius, adminInputRadius: storedRadius
  } satisfies Record<keyof TenantIdentity, Schema>, ["tenantId", "tenantCode", "tenantName", "tenantStatus"]),
  "Platform.LoginResponse": object({ accessToken: string, refreshToken: string, expiresIn: integer, tenant: ref("Tenant"), user: ref("AuthUser"), needsTenantOnboarding: boolean }, ["accessToken", "refreshToken", "expiresIn", "tenant", "user"]),
  "Platform.SessionContext": object({ tenant: ref("Tenant"), user: ref("AuthUser") }, ["tenant", "user"]),
  "Platform.Logout": object({ loggedOut: boolean }, ["loggedOut"]),
  "Platform.AccountAppearance": object({ themeColor: string, updatedAt: date }),
  "Platform.SaveAccountAppearance": object({ themeColor: { type: "string", pattern: "^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))?$", description: "空字符串清除本人主题覆盖。" } }),
  "Platform.TenantAppearance": object({ brandName: string, brandLogoUrl: string, faviconUrl: string, themeColor: string,
    adminCornerRadius: storedRadius, adminContainerRadius: storedRadius, adminButtonRadius: storedRadius, adminInputRadius: storedRadius,
    revision: integer, updatedAt: date } satisfies Record<keyof TenantAppearanceProfile, Schema>, ["revision"]),
  "Platform.SaveTenantAppearance": object({ expectedRevision: { type: "integer", minimum: 0 }, brandName: { ...string, maxLength: 120 },
    brandLogoUrl: { ...string, maxLength: 512 }, faviconUrl: { ...string, maxLength: 512 }, themeColor: string,
    adminCornerRadius: radius(20), adminContainerRadius: radius(20), adminButtonRadius: radius(16), adminInputRadius: radius(16)
  } satisfies Record<keyof SaveTenantAppearanceRequest, Schema>)
} satisfies Record<string, Schema>;

export function createPlatformOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const item of PLATFORM_HTTP_OPERATIONS) {
    const content = (schema: Schema) => ({ "application/json": { schema } });
    const raw = item.path === "/openapi.json";
    const response = raw ? ref(item.response) : object({ data: ref(item.response), requestId: string }, ["data", "requestId"]);
    const operation = { operationId: `Platform.${item.id}`, summary: item.summary, tags: ["Platform"],
      security: item.access === "anonymous" ? [] : [{ bearerAuth: [] }],
      "x-requiredPermissions": "permission" in item ? [item.permission] : [],
      description: item.access === "tenant" ? "当前operator的本租户设置；SaaS身份不代租户操作。省略字段保留，显式清空按原合同，修订冲突保留原值。"
        : item.access === "self" ? "当前签名会话的本人范围；请求体和查询参数不能指定另一主体。" : "公共传输入口；登录保护及原令牌消费仍由对应服务执行。",
      ...("request" in item ? { requestBody: { required: true, content: content(ref(item.request)) } } : {}),
      responses: { [item.method === "POST" ? "201" : "200"]: { description: "成功", content: content(response) },
        "400": { description: "输入不符合原DTO或业务约束" }, "401": { description: "原会话失效或登录受限" },
        "403": { description: "当前主体或操作权限不足" }, "409": { description: "会话或配置修订已变化" },
        "500": { description: "实际持久化失败；不能视为已保存或可重发" } } };
    (paths[`/api${item.path}`] ??= {})[item.method.toLowerCase()] = operation;
  }
  return { openapi: "3.0.3", info: { title: "Nativark Platform API", version: "0.1.0", description: "公共宿主接口；业务Core另贡献同版本文档，文档可见不授予Agent业务权限。" },
    paths, components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } }, schemas: PLATFORM_OPENAPI_SCHEMAS } };
}

export const PLATFORM_OPENAPI_DOCUMENT = Symbol("platform.openapi.document");
@Controller()
export class PlatformOpenApiController {
  constructor(@Inject(PLATFORM_OPENAPI_DOCUMENT) private readonly document: ReturnType<typeof createPlatformOpenApi>) {}
  @Get("openapi.json")
  documentJson() { return this.document; }
}
Reflect.defineMetadata(RAW_HTTP_RESPONSE, true, PlatformOpenApiController.prototype.documentJson);

// 独立资料导出只读取已编译声明，不启动宿主或读取数据库/配置。
if (require.main === module) process.stdout.write(JSON.stringify(createPlatformOpenApi(), null, 2) + "\n");
