/** 公共宿主同版本接口资料；只组合已登记公共HTTP，不加载行业文档或开放业务工具。 */
import { Controller, Get, Inject } from "@nestjs/common";
import type { AuthUser, TenantIdentity, TenantAppearanceProfile, SaveTenantAppearanceRequest, PlatformTenantSummary,
  CreatePlatformTenantRequest, SaveSystemUserRequest, SaveSystemRoleRequest, SystemRoleRow, SystemUserRow, PlatformFilterPresetContribution } from "@rental-os/platform-contracts";
import { PLATFORM_HTTP_OPERATIONS, platformHttpPermissions } from "./platform-http-policy";
import { RAW_HTTP_RESPONSE } from "./common/request-id.interceptor";
import { SUBSCRIPTION_OPENAPI_SCHEMAS, SUBSCRIPTION_OPENAPI_QUERY_SCHEMAS } from "./modules/subscription/subscription-openapi";
import { INTEGRATION_OPENAPI_SCHEMAS } from "./modules/integrations/integration-openapi";
import { OFFICIAL_CALENDAR_SCHEMAS, OFFICIAL_CALENDAR_OPENAPI_QUERY_SCHEMAS } from "./modules/official-calendars/official-calendar-openapi";
import { PLATFORM_SETTINGS_SCHEMAS, PLATFORM_SETTINGS_OPENAPI_QUERY_SCHEMAS } from "./modules/platform/platform-settings-openapi";
import { PLATFORM_TOOLS_SCHEMAS } from "./modules/platform-tools/platform-tools-openapi";
import { PLATFORM_FILTER_PRESET_SCHEMAS, PLATFORM_FILTER_PRESET_QUERY_SCHEMAS, createPlatformFilterPresetSchemas } from "./modules/platform-tools/filter-presets-openapi";
import { DEMO_REQUEST_SCHEMAS, DEMO_REQUEST_QUERY_SCHEMAS } from "./modules/demo-requests/demo-request-openapi";
import { TENANT_MESSAGING_OPENAPI_SCHEMAS } from "./modules/messaging/tenant-messaging-openapi";

type Schema = { [field: string]: unknown };
const string: Schema = { type: "string" }, boolean: Schema = { type: "boolean" };
const integer: Schema = { type: "integer" }, strings: Schema = { type: "array", items: string };
const object = (properties: Record<string, Schema>, required: readonly string[] = [], additionalProperties = false): Schema =>
  ({ type: "object", properties, required, additionalProperties });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name.includes(".") ? name : `Platform.${name}`}` });
const password: Schema = { type: "string", format: "password", writeOnly: true };
const date: Schema = { type: "string", format: "date-time" };
const location = object({ mode: { type: "string", enum: ["all", "selected"] }, locationIds: strings }, ["mode", "locationIds"]);
const storedRadius: Schema = { type: "integer", minimum: 0, description: "历史值保持可读，界面按当前圆角范围显示；读取不会重写配置。" };
const radius = (maximum: number): Schema => ({ type: "integer", minimum: 4, maximum, nullable: true });
const array = (name: string): Schema => ({ type: "array", items: ref(name) });
const querySchemas: Readonly<Record<string, Schema>> = { ...SUBSCRIPTION_OPENAPI_QUERY_SCHEMAS, ...OFFICIAL_CALENDAR_OPENAPI_QUERY_SCHEMAS,
  ...PLATFORM_SETTINGS_OPENAPI_QUERY_SCHEMAS, ...PLATFORM_FILTER_PRESET_QUERY_SCHEMAS, ...DEMO_REQUEST_QUERY_SCHEMAS };

export const PLATFORM_OPENAPI_SCHEMAS = {
  ...SUBSCRIPTION_OPENAPI_SCHEMAS,
  ...INTEGRATION_OPENAPI_SCHEMAS,
  ...OFFICIAL_CALENDAR_SCHEMAS,
  ...PLATFORM_SETTINGS_SCHEMAS,
  ...PLATFORM_TOOLS_SCHEMAS,
  ...PLATFORM_FILTER_PRESET_SCHEMAS,
  ...DEMO_REQUEST_SCHEMAS,
  ...TENANT_MESSAGING_OPENAPI_SCHEMAS,
  "Platform.Health": object({ service: string, status: string, time: date }, ["service", "status", "time"]),
  "Platform.OpenApi": { type: "object", additionalProperties: true },
  "Platform.LoginRequest": object({ tenantCode: string, account: string, password }, ["tenantCode", "account", "password"]),
  "Platform.RefreshSessionRequest": object({ refreshToken: { type: "string", writeOnly: true } }, ["refreshToken"]),
  "Platform.ChangePasswordRequest": object({
    currentPassword: { ...password, description: "本人的当前密码，由原账号校验。" },
    newPassword: { ...password, minLength: 8,
      description: "长度至少为 max(8, 当前平台 passwordPolicy.minLength)，必须包含字母、数字和特殊字符，且须与当前密码不同。" }
  }, ["currentPassword", "newPassword"]),
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
  } satisfies Record<keyof SaveTenantAppearanceRequest, Schema>),
  "Platform.TenantSummary": object({ tenantId: string, tenantCode: string, tenantName: string, operatorShortName: string,
    tenantStatus: { type: "string", enum: ["active", "frozen", "disabled"] }, enabledBusinessLines: strings,
    userCount: integer, organizationCount: integer,
    workspaceCount: { ...integer, minimum: 0, readOnly: true, description: "已装配 Core 供给的原经营空间数量；缺少业务来源时省略。" },
    orderCount: { ...integer, minimum: 0, readOnly: true, description: "已装配 Core 供给的原订单数量；缺少业务来源时省略。" },
    statusReason: string, createdAt: date, updatedAt: date
  } satisfies Record<keyof PlatformTenantSummary, Schema>, ["tenantId", "tenantCode", "tenantName", "tenantStatus", "enabledBusinessLines"]),
  "Platform.Tenants": array("TenantSummary"),
  "Platform.CreateTenant": object({ tenantCode: string, tenantName: string, operatorShortName: { ...string, maxLength: 64, nullable: true },
    adminAccount: string, adminDisplayName: string, adminPhone: string
  } satisfies Record<keyof CreatePlatformTenantRequest, Schema>, ["tenantCode", "tenantName", "adminAccount", "adminDisplayName"]),
  "Platform.CreatedTenant": object({ tenant: ref("TenantSummary"), admin: ref("SystemUser"), temporaryPassword: { ...string, readOnly: true, description: "只在创建响应返回一次，不存明文或写入日志。" }, message: string },
    ["tenant", "admin", "temporaryPassword", "message"]),
  "Platform.UpdateTenant": object({
    tenantName: { ...string, description: "租户名称，去除首尾空白后须非空。租户本人资料页提交此字段。" },
    operatorShortName: { ...string, maxLength: 64, nullable: true,
      description: "后台简称。省略保留原值，空字符串、纯空白或 null 清除。SaaS 租户资料页提供此字段的编辑入口。" }
  }, ["tenantName"]),
  "Platform.TenantStatus": object({ status: { type: "string", enum: ["active", "frozen", "disabled"] }, reason: string }, ["status", "reason"]),
  "Platform.SelfProfile": object({
    displayName: { ...string, description: "本人姓名，去除首尾空白后须非空。" },
    phone: { ...string, description: "本人电话。省略保留原值，空字符串或纯空白清除，其余值去除首尾空白后保存。" }
  }, ["displayName"]),
  "Platform.SystemUser": object({ id: string, tenantId: string, account: string, displayName: string, phone: string, organizationId: string,
    organizationName: string, roleIds: strings, roleNames: strings, scope: string, isPlatformAdmin: boolean, isSaasAdmin: boolean,
    mustChangePassword: boolean, temporaryPassword: { ...string, readOnly: true }, isActive: boolean, permissions: strings,
    dataScope: string, locationScope: location
  } satisfies Record<keyof SystemUserRow, Schema>, ["id", "tenantId", "account", "displayName", "roleIds", "roleNames", "scope", "isPlatformAdmin", "isActive", "permissions", "dataScope"]),
  "Platform.Users": array("SystemUser"),
  "Platform.SaveUser": object({ id: string,
    tenantId: { ...string, description: "省略使用当前请求租户，指定其他租户会被拒绝。" }, account: string, displayName: string,
    phone: { ...string, description: "编辑时省略保留原电话，当前 DTO 拒绝空字符串。人员资料页将空电话省略。" },
    organizationId: { ...string, description: "编辑时省略保留原组织，填写的组织须属于当前租户。" },
    roleIds: { ...strings, description: "普通账号至少选择一个本租户启用角色。固定管理员角色由 isPlatformAdmin 按服务端规则分配。Core 使用权另行分配。" },
    isPlatformAdmin: { ...boolean, description: "租户管理员标识。管理员账号及该标识的管理要求当前租户管理员身份。" },
    isSaasAdmin: { type: "boolean", enum: [false], description: "仅允许 false。SaaS 主体沿独立平台初始化入口维护。" }, isActive: boolean
  } satisfies Record<keyof SaveSystemUserRequest, Schema>, ["account", "displayName", "roleIds", "isActive"]),
  "Platform.UserStatus": object({ isActive: boolean, tenantId: string }, ["isActive"]),
  "Platform.ResetUserPasswordInput": object({ tenantId: string }),
  "Platform.ResetPassword": object({ userId: string, account: string, temporaryPassword: { ...string, readOnly: true }, message: string }, ["userId", "account", "temporaryPassword", "message"]),
  "Platform.Role": object({ id: string, tenantId: string, code: string, name: string, description: string, scope: string,
    fixedAllPermissions: boolean, enabledBusinessScopes: strings, isActive: boolean, permissions: strings, buttonPermissions: strings, dataScope: string
  } satisfies Record<keyof SystemRoleRow, Schema>, ["id", "code", "name", "scope", "fixedAllPermissions", "enabledBusinessScopes", "isActive", "permissions", "buttonPermissions", "dataScope"]),
  "Platform.Roles": array("Role"),
  "Platform.SaveRole": object({ id: string, tenantId: string, code: string, name: string, description: string,
    scope: { type: "string", enum: ["operator", "car_shop", "store", "station"] }, enabledBusinessScopes: strings,
    permissions: strings, buttonPermissions: strings, dataScope: { type: "string", enum: ["all", "organization", "store", "own"] }, isActive: boolean
  } satisfies Record<keyof SaveSystemRoleRequest, Schema>, ["code", "name", "scope", "enabledBusinessScopes", "permissions", "isActive"]),
  "Platform.RolePermissions": object({ permissions: strings, tenantId: string }),
  "Platform.Deleted": object({ id: string, deleted: { type: "boolean", enum: [true] } }, ["id", "deleted"]),
  "Platform.PermissionTree": { type: "array", items: object({ code: string, name: string, children: { type: "array",
    items: object({ code: string, name: string, description: string }, ["code", "name"]) } }, ["code", "name", "children"]) }
} satisfies Record<string, Schema>;

export function createPlatformOpenApi(options: { filterPresetContributions?: readonly PlatformFilterPresetContribution[] } = {}) {
  const filterSchemas = createPlatformFilterPresetSchemas(options.filterPresetContributions);
  const selectedQuerySchemas: Readonly<Record<string, Schema>> = { ...querySchemas,
    "filterPresets.scopeKey": filterSchemas["PlatformTools.FilterPresetScopes"].items };
  const paths: Record<string, Record<string, unknown>> = {};
  for (const item of PLATFORM_HTTP_OPERATIONS) {
    const content = (schema: Schema) => ({ "application/json": { schema } });
    const raw = item.path === "/openapi.json";
    const response = raw ? ref(item.response) : object({ data: ref(item.response), requestId: string },
      item.response === "Subscription.Void" ? ["requestId"] : ["data", "requestId"]);
    const operation = { operationId: `Platform.${item.id}`, summary: item.summary, tags: ["Platform"],
      security: item.access === "anonymous" ? [] : [{ bearerAuth: [] }],
      "x-requiredPermissions": platformHttpPermissions(item),
      ...("permission" in item ? { "x-permissionMatch": "any" } : {}),
      "x-effect": "effect" in item ? item.effect : item.method === "GET" ? "read" : "write",
      description: item.access === "saas_subscription" ? "沿原SaaS订阅管理身份办理。租户父锁、当前修订、价格版本、申请与审计在原事务中核对；续费后仍需当前Core和成员授权。"
        : item.access === "saas_demo_request" ? "仅当前SaaS管理身份读取平台演示预约。保留原分页、个人资料投影与返回前权限复验，普通租户通配权限不可读取。"
        : item.access === "tenant_summary" ? "仅当前operator本租户的无金额提醒。SaaS身份不能代替租户读取，提醒不授予业务权限。"
        : item.access === "tenant" ? "当前operator的本租户管理范围，SaaS身份不代租户操作。当前角色/账号与提交条件由服务端复验，Core授权另行办理。"
        : item.access === "saas" ? "仅当前SaaS管理身份与对应权限。平台管理不会获得目标租户业务访问权；创建账号口令只在本响应返回，不记日志。"
        : item.access === "authenticated" ? "当前operator的原系统参数读取权限；由当前会话围栏复验。认证前内部读取使用独立只读接点。"
        : item.access === "self" ? "当前签名会话的本人范围；请求体和查询参数不能指定另一主体。" : "公共传输入口；登录保护及原令牌消费仍由对应服务执行。",
      ...("request" in item ? { requestBody: {
        required: "requestRequired" in item ? item.requestRequired : true, content: content(ref(item.request))
      } } : {}),
      parameters: "parameters" in item ? item.parameters : [
        ...item.path.split("/").filter(part => part.startsWith(":"))
          .map(part => ({ name: part.slice(1), in: "path", required: true, schema: string })),
        ...("query" in item ? item.query.map(name => ({ name, in: "query", required: false,
          schema: selectedQuerySchemas[`${item.id}.${name}`] ?? selectedQuerySchemas[name] })) : [])
      ],
      responses: { [item.method === "POST" ? "201" : "200"]: { description: "成功", content: content(response) },
        "400": { description: "输入不符合原DTO或业务约束" }, "401": { description: "原会话失效或登录受限" },
        "403": { description: "当前主体或操作权限不足" }, "404": { description: "目标租户或原申请不存在" }, "409": { description: "会话或配置修订已变化" },
        "429": { description: "请求超出当前限流，按原操作或凭证核对，不换键重发" },
        "503": { description: "实际必需参加者不可用，操作未完成" },
        "500": { description: "实际持久化失败；不能视为已保存或可重发" } } };
    (paths[`/api${item.path.replace(/:([a-z]+)/g, "{$1}")}`] ??= {})[item.method.toLowerCase()] = operation;
  }
  return { openapi: "3.0.3", info: { title: "Zelo Platform API", version: "0.1.0", description: "公共宿主接口；业务Core另贡献同版本文档，文档可见不授予Agent业务权限。" },
    paths, components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } }, schemas: { ...PLATFORM_OPENAPI_SCHEMAS, ...filterSchemas } } };
}

export const PLATFORM_OPENAPI_DOCUMENT = Symbol("platform.openapi.document");
@Controller()
export class PlatformOpenApiController {
  constructor(@Inject(PLATFORM_OPENAPI_DOCUMENT) private readonly document: unknown) {}
  @Get("openapi.json")
  documentJson() { return this.document; }
}
Reflect.defineMetadata(RAW_HTTP_RESPONSE, true, PlatformOpenApiController.prototype.documentJson);

// 独立资料导出只读取已编译声明，不启动宿主或读取数据库/配置。
if (require.main === module) process.stdout.write(JSON.stringify(createPlatformOpenApi(), null, 2) + "\n");
