import { createCorePackageOpenApi, createPlatformCorePackageOpenApi } from "@rental-os/platform-core-host";
import { adminContainerRadiusInput, adminControlRadiusInput, storedAdminRadiusSchema, RENTAL_HTTP_OPERATIONS, RENTAL_HTTP_COMPONENT_SCHEMAS, stringSchema, rentalCategoryCodeSchema, numberSchema, booleanSchema, objectSchema, ref, arrayOf, objectOf, queryParam, buildPaths, backlogOperation, type HttpMethod, type SchemaObject, type ContractOperation } from "@rental-os/rental-core/http-openapi";
import { TENANT_MESSAGING_OPERATIONS, TENANT_MESSAGING_SCHEMAS } from "./tenant-messaging-schemas";
import { SUBSCRIPTION_HTTP_OPERATIONS } from '@rental-os/platform-server/subscription-http-policy';
import { INTEGRATION_HTTP_OPERATIONS } from '@rental-os/platform-server/integration-http-policy';
import { INTEGRATION_OPENAPI_SCHEMAS } from '@rental-os/platform-server/integration-openapi';
import { OFFICIAL_CALENDAR_HTTP_OPERATIONS } from '@rental-os/platform-server/official-calendar-http-policy';
import { OFFICIAL_CALENDAR_SCHEMAS, OFFICIAL_CALENDAR_OPENAPI_QUERY_SCHEMAS } from '@rental-os/platform-server/official-calendar-openapi';
import { PLATFORM_SETTINGS_HTTP_OPERATIONS } from '@rental-os/platform-server/settings-http-policy';
import { PLATFORM_SETTINGS_SCHEMAS, PLATFORM_SETTINGS_OPENAPI_QUERY_SCHEMAS } from '@rental-os/platform-server/settings-openapi';
import { PLATFORM_TOOLS_HTTP_OPERATIONS, PLATFORM_TOOLS_SCHEMAS } from '@rental-os/platform-server/tools';
import { JOBS_OPENAPI_SCHEMAS } from '@rental-os/platform-server/jobs';
import { NOTIFICATIONS_OPENAPI_SCHEMAS } from '@rental-os/platform-server/notifications';
import { SUBSCRIPTION_OPENAPI_SCHEMAS, SUBSCRIPTION_OPENAPI_QUERY_SCHEMAS } from '@rental-os/platform-server/subscription-openapi';
import { AI_HTTP_OPERATIONS, AI_HTTP_COMPONENT_SCHEMAS } from "@rental-os/ai-native-server/runtime/contracts/http-openapi";

export type { SchemaObject, ContractOperation } from "@rental-os/rental-core/http-openapi";

// 旧校验器的操作表复用同源包管理片段；请求和响应不另造DTO或字段。
type CorePackageSchemaContent = { content: { "application/json": { schema: SchemaObject } } };
const corePackageContractOperations: ContractOperation[] = Object.entries(createCorePackageOpenApi().paths)
  .flatMap(([path, methods]) => Object.entries(methods).map(([method, value]) => {
    const operation = value as { operationId: string; summary: string; tags: string[];
      "x-requiredPermissions": string[]; requestBody?: CorePackageSchemaContent;
      responses: { "200": CorePackageSchemaContent } };
    return { method: method as HttpMethod, path, tag: operation.tags[0], operationId: operation.operationId,
      summary: operation.summary, permissions: operation["x-requiredPermissions"], authRequired: true,
      responseSchema: operation.responses["200"].content["application/json"].schema,
      ...(operation.requestBody ? { requestSchema: operation.requestBody.content["application/json"].schema } : {}) };
  }));

export const OPENAPI_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
  ...SUBSCRIPTION_OPENAPI_SCHEMAS,
  ...INTEGRATION_OPENAPI_SCHEMAS,
  ...OFFICIAL_CALENDAR_SCHEMAS,
  ...PLATFORM_SETTINGS_SCHEMAS,
  ...PLATFORM_TOOLS_SCHEMAS,
  ...JOBS_OPENAPI_SCHEMAS,
  ...NOTIFICATIONS_OPENAPI_SCHEMAS,
  ...TENANT_MESSAGING_SCHEMAS,
  ...RENTAL_HTTP_COMPONENT_SCHEMAS,
  ...AI_HTTP_COMPONENT_SCHEMAS,
  OpenApiDocument: objectSchema,
  HealthStatus: objectOf(
    {
      service: stringSchema,
      status: stringSchema,
      time: { type: "string", format: "date-time" }
    },
    ["service", "status", "time"]
  ),
  TenantAppearanceProfile: objectOf(
    {
      brandName: stringSchema, brandLogoUrl: stringSchema, faviconUrl: stringSchema, themeColor: stringSchema,
      adminCornerRadius: storedAdminRadiusSchema,
      adminContainerRadius: storedAdminRadiusSchema,
      adminButtonRadius: storedAdminRadiusSchema,
      adminInputRadius: storedAdminRadiusSchema,
      revision: numberSchema, updatedAt: { type: "string", format: "date-time" }
    },
    ["revision"],
    false
  ),
  SaveTenantAppearanceRequest: objectOf(
    {
      expectedRevision: numberSchema,
      brandName: stringSchema, brandLogoUrl: stringSchema, faviconUrl: stringSchema, themeColor: stringSchema,
      adminCornerRadius: adminContainerRadiusInput,
      adminContainerRadius: adminContainerRadiusInput,
      adminButtonRadius: adminControlRadiusInput,
      adminInputRadius: adminControlRadiusInput
    },
    [],
    false
  ),
  // 账户级外观（跟随登录账户的管理后台主题色，与租户品牌色相互独立）。
  AccountAppearanceProfile: objectOf({ themeColor: stringSchema, updatedAt: { type: "string", format: "date-time" } }, [], false),
  SaveAccountAppearanceRequest: objectOf({ themeColor: stringSchema }, [], false),
  TenantIntegrationCatalogResponse: INTEGRATION_OPENAPI_SCHEMAS["Integration.Catalog"],
  SaveTenantIntegrationRequest: INTEGRATION_OPENAPI_SCHEMAS["Integration.SaveConfig"],
  TenantIntegrationTestResult: INTEGRATION_OPENAPI_SCHEMAS["Integration.TestResult"],
  TenantSummary: objectOf(
    {
      tenantId: stringSchema,
      tenantCode: stringSchema,
      tenantName: stringSchema,
      operatorShortName: { type: "string", maxLength: 64, description: "后台营运商简称，与公司全称和对客品牌分别保存。" },
      tenantStatus: stringSchema,
      enabledBusinessLines: arrayOf(stringSchema),
      categoryCode: stringSchema,
      categoryName: stringSchema,
      userCount: numberSchema,
      organizationCount: numberSchema,
      orderCount: numberSchema,
      statusReason: stringSchema,
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    },
    ["tenantId", "tenantCode", "tenantName", "tenantStatus", "enabledBusinessLines"]
  ),
  ResetUserPasswordResult: objectOf(
    {
      userId: stringSchema,
      account: stringSchema,
      temporaryPassword: stringSchema,
      message: stringSchema
    },
    ["userId", "account", "temporaryPassword", "message"]
  ),
  OrganizationSummary: PLATFORM_SETTINGS_SCHEMAS["PlatformSettings.Organization"],
  PermissionModule: objectOf(
    {
      code: stringSchema,
      name: stringSchema,
      children: arrayOf(
        objectOf({
          code: stringSchema,
          name: stringSchema,
          description: stringSchema
        })
      )
    },
    ["code", "name", "children"]
  ),
  SystemRoleRow: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      code: stringSchema,
      name: stringSchema,
      description: stringSchema,
      scope: stringSchema,
      fixedAllPermissions: booleanSchema,
      enabledBusinessScopes: arrayOf(stringSchema),
      isActive: booleanSchema,
      permissions: arrayOf(stringSchema),
      buttonPermissions: arrayOf(stringSchema),
      dataScope: stringSchema
    },
    [
      "id",
      "code",
      "name",
      "scope",
      "fixedAllPermissions",
      "enabledBusinessScopes",
      "isActive",
      "permissions",
      "buttonPermissions",
      "dataScope"
    ]
  ),
  SaveSystemRoleRequest: objectOf(
    {
      id: stringSchema,
      code: stringSchema,
      name: stringSchema,
      description: stringSchema,
      scope: stringSchema,
      enabledBusinessScopes: arrayOf(stringSchema),
      permissions: arrayOf(stringSchema),
      buttonPermissions: arrayOf(stringSchema),
      dataScope: stringSchema,
      isActive: booleanSchema
    },
    ["code", "name", "scope", "enabledBusinessScopes", "permissions", "isActive"]
  ),
  SaveSystemUserRequest: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      account: stringSchema,
      displayName: stringSchema,
      phone: stringSchema,
      organizationId: stringSchema,
      roleIds: arrayOf(stringSchema),
      isPlatformAdmin: booleanSchema,
      isActive: booleanSchema
    },
    ["tenantId", "account", "displayName", "roleIds", "isActive"]
  ),
  SystemRulesConfig: objectSchema,
  SaveSystemRuleSectionRequest: objectOf(
    {
      config: ref("SystemRulesConfig"),
      operator: stringSchema
    },
    ["config"]
  ),
  SystemAiConnectionTestRequest: objectOf({
    operator: stringSchema
  }),
  SystemAiConnectionTestResult: objectOf(
    {
      status: stringSchema,
      testedAt: { type: "string", format: "date-time" },
      provider: stringSchema,
      modelName: stringSchema,
      message: stringSchema
    },
    ["status", "testedAt", "provider", "modelName", "message"]
  ),
  SystemSecurityBaselineConfig: PLATFORM_SETTINGS_SCHEMAS["PlatformSettings.SecurityBaseline"],
  SaveSecurityBaselineRequest: PLATFORM_SETTINGS_SCHEMAS["PlatformSettings.SaveSecurityBaseline"],
  SecondConfirmationCheckRequest: PLATFORM_SETTINGS_SCHEMAS["PlatformSettings.SecondConfirmation"],
  PlatformAuditResult: objectOf(
    {
      rows: arrayOf("PlatformAuditLogRow"),
      total: numberSchema
    },
    ["rows", "total"]
  ),
  PlatformAuditLogRow: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      workspaceId: stringSchema,
      action: stringSchema,
      operator: stringSchema,
      targetType: stringSchema,
      targetId: stringSchema,
      detail: stringSchema,
      createdAt: { type: "string", format: "date-time" }
    },
    ["id", "tenantId", "action", "operator", "targetType", "detail", "createdAt"]
  ),
  PlatformDictionaryGroup: PLATFORM_TOOLS_SCHEMAS["PlatformTools.Dictionary"],
  PlatformDictionaryItem: PLATFORM_TOOLS_SCHEMAS["PlatformTools.Dictionary"].properties.items.items,
  SavePlatformDictionaryGroupRequest: PLATFORM_TOOLS_SCHEMAS["PlatformTools.SaveDictionary"],
  PlatformNumberRule: PLATFORM_TOOLS_SCHEMAS["PlatformTools.NumberRule"],
  SavePlatformNumberRuleRequest: PLATFORM_TOOLS_SCHEMAS["PlatformTools.SaveNumberRule"],
  GeneratePlatformNumberRequest: PLATFORM_TOOLS_SCHEMAS["PlatformTools.GenerateNumber"],
  GeneratePlatformNumberResult: PLATFORM_TOOLS_SCHEMAS["PlatformTools.GeneratedNumber"],
  PlatformFilterPreset: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      scopeKey: stringSchema,
      name: stringSchema,
      description: stringSchema,
      filters: objectSchema,
      isDefault: booleanSchema,
      isSystem: booleanSchema,
      updatedAt: { type: "string", format: "date-time" },
      updatedBy: stringSchema
    },
    [
      "id",
      "tenantId",
      "scopeKey",
      "name",
      "filters",
      "isDefault",
      "isSystem",
      "updatedAt",
      "updatedBy"
    ]
  ),
  SavePlatformFilterPresetRequest: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      scopeKey: stringSchema,
      name: stringSchema,
      description: stringSchema,
      filters: objectSchema,
      isDefault: booleanSchema,
      operator: stringSchema
    },
    ["scopeKey", "name", "filters"]
  ),
  SetPlatformFilterPresetDefaultRequest: objectOf({
    operator: stringSchema
  }),
  DeletePlatformFilterPresetResult: objectOf(
    {
      id: stringSchema,
      deleted: booleanSchema
    },
    ["id", "deleted"]
  ),
  TenantBootstrapRequest: objectOf(
    {
      tenantCode: stringSchema,
      tenantName: stringSchema,
      operatorShortName: { type: "string", nullable: true, maxLength: 64, description: "可选后台营运商简称，null/空字符串表示未设置。" },
      categoryCode: rentalCategoryCodeSchema,
      categoryVersionId: { type: "string", minLength: 1, maxLength: 191, pattern: "\\S" },
      operator: stringSchema,
      adminAccount: stringSchema,
      adminDisplayName: stringSchema,
      adminPhone: stringSchema,
      storeName: stringSchema,
      storeCode: stringSchema
    },
    ["tenantCode", "tenantName", "categoryCode", "adminAccount", "adminDisplayName"]
  ),
  UpdateTenantRequest: objectOf(
    { tenantName: stringSchema, operatorShortName: { type: "string", nullable: true, maxLength: 64,
      description: "后台营运商简称；省略保持，null/空字符串清空并使用原全称。" } },
    ["tenantName"]
  ),
  UpdateTenantStatusRequest: objectOf(
    {
      status: stringSchema,
      reason: stringSchema
    },
    ["status", "reason"]
  ),
  TenantBootstrapPreview: objectSchema,
  TenantBootstrapResult: objectOf(
    {
      tenant: ref("TenantSummary"),
      adminUser: ref("SystemUserRow"),
      preview: ref("TenantBootstrapPreview"),
      templateExecution: objectSchema,
      message: stringSchema,
      temporaryPassword: stringSchema
    },
    ["tenant", "adminUser", "preview", "message"]
  ),
  RolePermissionsRequest: objectOf({
    permissions: arrayOf(stringSchema)
  }),
  UserStatusRequest: objectOf({
    isActive: booleanSchema
  })
};

const TENANT_INTEGRATION_OPERATIONS: ContractOperation[] = INTEGRATION_HTTP_OPERATIONS.map((item): ContractOperation => ({
  method: item.method.toLowerCase() as HttpMethod,
  path: `/api${item.path.replace(/:([a-zA-Z]+)/g, "{$1}")}`,
  tag: "Platform", operationId: item.id, summary: item.summary,
  permissions: [item.permission], responseSchema: item.response,
  ...("request" in item ? { requestSchema: item.request } : {})
}));

const INTEGRATION_BACKLOG_OPERATIONS: ContractOperation[] = [
  ...RENTAL_HTTP_OPERATIONS,
  // APPEARANCE-01：租户级「品牌与外观」（管理后台 UI 身份：品牌标识/主题色/圆角），从客户端渠道拆出的独立领域。
  backlogOperation("get", "/api/platform/appearance", "Platform", "getTenantAppearance", "Get the tenant-level brand & appearance profile (brand identity, theme color, corner radii)", ["system:integration:manage"], true, undefined, "TenantAppearanceProfile"),
  backlogOperation("put", "/api/platform/appearance", "Platform", "saveTenantAppearance", "Save the tenant-level brand & appearance profile with optimistic revision check", ["system:integration:manage"], true, "SaveTenantAppearanceRequest", "TenantAppearanceProfile"),
  // 账户级外观自助：登录账户本人的管理后台主题色，跟随账户、与租户品牌色相互独立；任何已登录账号读写自己的（无业务权限）。
  backlogOperation("get", "/api/platform/account-appearance", "Platform", "getAccountAppearance", "Get the signed-in account's admin theme color (follows the account, independent of the tenant brand color)", [], true, undefined, "AccountAppearanceProfile"),
  backlogOperation("put", "/api/platform/account-appearance", "Platform", "saveAccountAppearance", "Save the signed-in account's admin theme color", [], true, "SaveAccountAppearanceRequest", "AccountAppearanceProfile")
];

export const API_CONTRACT_OPERATIONS: ContractOperation[] = [
  ...AI_HTTP_OPERATIONS,
  {
    method: "post",
    path: "/api/public/demo-requests",
    tag: "Platform",
    operationId: "createWebsiteDemoRequest",
    summary: "Submit a website demo request; anonymous, idempotent and IP rate-limited (5 per 10 minutes)",
    permissions: [],
    authRequired: false,
    rateLimited: true,
    requestSchema: objectOf({
      requestKey: { type: "string", format: "uuid" },
      name: { type: "string", minLength: 1, maxLength: 80 },
      contactType: { type: "string", enum: ["phone", "email", "wechat"] },
      contactValue: { type: "string", minLength: 1, maxLength: 160, description: "Phone with 7–20 digits, valid email, or 3–80 character WeChat ID (letters, digits, underscore, hyphen)." },
      company: { type: "string", maxLength: 120 },
      message: { type: "string", maxLength: 1000 },
      language: { type: "string", enum: ["zh", "en"] }
    }, ["requestKey", "name", "contactType", "contactValue", "language"], false),
    responseSchema: objectOf({ received: booleanSchema }, ["received"], false)
  },
  {
    method: "get",
    path: "/api/platform/demo-requests",
    tag: "Platform",
    operationId: "listWebsiteDemoRequests",
    summary: "SaaS administrators only: newest-first paginated website demo requests, never tenant customer data",
    permissions: ["system:demo-request:view"],
    parameters: [queryParam("page", { type: "integer", minimum: 1, maximum: 100000 }), queryParam("pageSize", { type: "integer", minimum: 1, maximum: 100 }), queryParam("keyword", { type: "string", maxLength: 120 })],
    responseSchema: objectOf({
      items: arrayOf(objectOf({
        id: stringSchema, name: stringSchema,
        contactType: { type: "string", enum: ["phone", "email", "wechat"] },
        contactValue: stringSchema, company: stringSchema, message: stringSchema,
        language: { type: "string", enum: ["zh", "en"] },
        createdAt: { type: "string", format: "date-time" }
      }, ["id", "name", "contactType", "contactValue", "company", "message", "language", "createdAt"], false)),
      total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" }
    }, ["items", "total", "page", "pageSize"], false)
  },
  {
    method: "get",
    path: "/api/openapi.json",
    tag: "Contract",
    operationId: "getOpenApiDocument",
    summary: "Get OpenAPI contract document",
    permissions: [],
    responseSchema: "OpenApiDocument"
  },
  {
    method: "get",
    path: "/api/health",
    tag: "Health",
    operationId: "getHealth",
    summary: "Get API health status",
    permissions: [],
    responseSchema: "HealthStatus"
  },
  {
    method: "post",
    path: "/api/auth/login",
    tag: "Auth",
    operationId: "login",
    summary: "Login and issue access token",
    permissions: [],
    requestSchema: "LoginRequest",
    responseSchema: "LoginResponse"
  },
  {
    method: "get",
    path: "/api/auth/me",
    tag: "Auth",
    operationId: "getCurrentUser",
    summary: "Get current authenticated user",
    permissions: [],
    authRequired: true,
    responseSchema: "AuthUser"
  },
  {
    method: "get",
    path: "/api/auth/session-context",
    tag: "Auth",
    operationId: "getSessionContext",
    summary: "Refresh authenticated user and tenant capability context",
    permissions: [],
    authRequired: true,
    responseSchema: "SessionContextResponse"
  },
  {
    method: "post",
    path: "/api/auth/refresh",
    tag: "Auth",
    operationId: "refreshSession",
    summary: "Rotate refresh token and issue a new access token",
    permissions: [],
    requestSchema: "RefreshSessionRequest",
    responseSchema: "LoginResponse"
  },
  {
    method: "post",
    path: "/api/auth/logout",
    tag: "Auth",
    operationId: "logout",
    summary: "Revoke the current refresh session",
    permissions: [],
    authRequired: true,
    requestSchema: "RefreshSessionRequest",
    responseSchema: "GenericObject"
  },
  {
    method: "post",
    path: "/api/auth/change-password",
    tag: "Auth",
    operationId: "changePassword",
    summary: "Change password and revoke other sessions",
    permissions: [],
    authRequired: true,
    requestSchema: "ChangePasswordRequest",
    responseSchema: "LoginResponse"
  },
  {
    method: "get",
    path: "/api/platform/tenants",
    tag: "Platform",
    operationId: "listTenants",
    summary: "List tenants",
    permissions: ["system:tenant:manage"],
    responseSchema: arrayOf("TenantSummary")
  },
  {
    method: "get",
    path: "/api/platform/tenants/{id}",
    tag: "Platform",
    operationId: "getTenant",
    summary: "Get one SaaS tenant",
    permissions: ["system:tenant:manage"],
    responseSchema: "TenantSummary"
  },
  {
    method: "put",
    path: "/api/platform/tenants/{id}",
    tag: "Platform",
    operationId: "updateTenant",
    summary: "Update one SaaS tenant",
    permissions: ["system:tenant:manage"],
    requestSchema: "UpdateTenantRequest",
    responseSchema: "TenantSummary"
  },
  {
    method: "put",
    path: "/api/platform/tenants/{id}/status",
    tag: "Platform",
    operationId: "updateTenantStatus",
    summary: "Change one SaaS tenant lifecycle status",
    permissions: ["system:tenant:manage"],
    requestSchema: "UpdateTenantStatusRequest",
    responseSchema: "TenantSummary"
  },
  {
    method: "post",
    path: "/api/platform/tenants/{id}/admin/reset-password",
    tag: "Platform",
    operationId: "resetTenantAdminPassword",
    summary: "Reset a tenant administrator password",
    permissions: ["system:tenant:manage"],
    responseSchema: "ResetUserPasswordResult",
    parameters: [{ name: "id", in: "path", required: true, schema: stringSchema }]
  },
  {
    method: "get",
    path: "/api/platform/permission-tree",
    tag: "Platform",
    operationId: "listPermissionTree",
    summary: "List permission tree",
    permissions: ["system:role:manage"],
    responseSchema: arrayOf("PermissionModule")
  },
  {
    method: "get",
    path: "/api/platform/system-rules",
    tag: "Platform",
    operationId: "getSystemRules",
    summary: "Get system rules",
    permissions: ["system:params:manage"],
    responseSchema: "SystemRulesConfig"
  },
  {
    method: "put",
    path: "/api/platform/system-rules/{sectionKey}",
    tag: "Platform",
    operationId: "saveSystemRuleSection",
    summary: "Save one system rule section",
    permissions: ["system:params:manage"],
    requestSchema: "SaveSystemRuleSectionRequest",
    responseSchema: "SystemRulesConfig"
  },
  {
    method: "post",
    path: "/api/platform/system-rules/ai-test",
    tag: "Platform",
    operationId: "testAiConnection",
    summary: "Test AI model connection",
    permissions: ["system:params:manage"],
    requestSchema: "SystemAiConnectionTestRequest",
    responseSchema: "SystemAiConnectionTestResult"
  },
  {
    method: "get",
    path: "/api/platform/data-permission-preview",
    tag: "Platform",
    operationId: "getDataPermissionPreview",
    summary: "Preview current data permissions",
    permissions: ["system:user:manage", "system:role:manage"],
    responseSchema: "GenericObject"
  },
  {
    method: "get",
    path: "/api/platform/audit-logs",
    tag: "Platform",
    operationId: "listAuditLogs",
    summary: "List platform audit logs",
    permissions: ["system:audit:view"],
    parameters: [
      queryParam("tenantId"),
      queryParam("action"),
      queryParam("operator"),
      queryParam("targetType"),
      queryParam("limit", { type: "integer", format: "int32" })
    ],
    responseSchema: "PlatformAuditResult"
  },
  {
    method: "get",
    path: "/api/platform/filter-presets",
    tag: "Platform",
    operationId: "listFilterPresets",
    summary: "List saved filter presets",
    permissions: [],
    authRequired: true,
    parameters: [queryParam("tenantId"), queryParam("scopeKey")],
    responseSchema: arrayOf("PlatformFilterPreset")
  },
  {
    method: "post",
    path: "/api/platform/filter-presets",
    tag: "Platform",
    operationId: "saveFilterPreset",
    summary: "Save filter preset",
    permissions: [],
    authRequired: true,
    requestSchema: "SavePlatformFilterPresetRequest",
    responseSchema: "PlatformFilterPreset"
  },
  {
    method: "put",
    path: "/api/platform/filter-presets/{id}/default",
    tag: "Platform",
    operationId: "setDefaultFilterPreset",
    summary: "Set default filter preset",
    permissions: [],
    authRequired: true,
    requestSchema: "SetPlatformFilterPresetDefaultRequest",
    responseSchema: "PlatformFilterPreset"
  },
  {
    method: "delete",
    path: "/api/platform/filter-presets/{id}",
    tag: "Platform",
    operationId: "deleteFilterPreset",
    summary: "Delete filter preset",
    permissions: [],
    authRequired: true,
    parameters: [queryParam("operator")],
    responseSchema: "DeletePlatformFilterPresetResult"
  },
  {
    method: "get",
    path: "/api/platform/tenant-bootstrap/preview",
    tag: "Platform",
    operationId: "getTenantBootstrapPreview",
    summary: "Preview tenant bootstrap template",
    permissions: ["system:tenant:bootstrap", "system:tenant:manage"],
    responseSchema: "TenantBootstrapPreview"
  },
  {
    method: "post",
    path: "/api/platform/tenant-bootstrap",
    tag: "Platform",
    operationId: "bootstrapTenant",
    summary: "Bootstrap tenant",
    permissions: ["system:tenant:bootstrap", "system:tenant:manage"],
    requestSchema: "TenantBootstrapRequest",
    responseSchema: "TenantBootstrapResult"
  },
  {
    method: "get",
    path: "/api/platform/roles",
    tag: "Platform",
    operationId: "listRoles",
    summary: "List roles",
    permissions: ["system:user:manage", "system:role:manage"],
    responseSchema: arrayOf("SystemRoleRow")
  },
  {
    method: "post",
    path: "/api/platform/roles",
    tag: "Platform",
    operationId: "createRole",
    summary: "Create role",
    permissions: ["system:role:manage"],
    requestSchema: "SaveSystemRoleRequest",
    responseSchema: "SystemRoleRow"
  },
  {
    method: "put",
    path: "/api/platform/roles/{id}",
    tag: "Platform",
    operationId: "updateRole",
    summary: "Update role",
    permissions: ["system:role:manage"],
    requestSchema: "SaveSystemRoleRequest",
    responseSchema: "SystemRoleRow"
  },
  {
    method: "delete",
    path: "/api/platform/roles/{id}",
    tag: "Platform",
    operationId: "deleteRole",
    summary: "Delete role",
    permissions: ["system:role:manage"],
    responseSchema: "GenericObject"
  },
  {
    method: "put",
    path: "/api/platform/roles/{id}/permissions",
    tag: "Platform",
    operationId: "saveRolePermissions",
    summary: "Save role permissions",
    permissions: ["system:role:manage"],
    requestSchema: "RolePermissionsRequest",
    responseSchema: "SystemRoleRow"
  },
  {
    method: "get",
    path: "/api/platform/users",
    tag: "Platform",
    operationId: "listUsers",
    summary: "List system users",
    permissions: ["system:user:manage"],
    parameters: [queryParam("tenantId")],
    responseSchema: arrayOf("SystemUserRow")
  },
  {
    method: "post",
    path: "/api/platform/users",
    tag: "Platform",
    operationId: "createUser",
    summary: "Create system user",
    permissions: ["system:user:manage"],
    requestSchema: "SaveSystemUserRequest",
    responseSchema: "SystemUserRow"
  },
  {
    method: "put",
    path: "/api/platform/users/{id}",
    tag: "Platform",
    operationId: "updateUser",
    summary: "Update system user",
    permissions: ["system:user:manage"],
    requestSchema: "SaveSystemUserRequest",
    responseSchema: "SystemUserRow"
  },
  {
    method: "put",
    path: "/api/platform/users/{id}/status",
    tag: "Platform",
    operationId: "setUserStatus",
    summary: "Set system user status",
    permissions: ["system:user:manage"],
    requestSchema: "UserStatusRequest",
    responseSchema: "SystemUserRow"
  },
  {
    method: "post",
    path: "/api/platform/users/{id}/reset-password",
    tag: "Platform",
    operationId: "resetUserPassword",
    summary: "Reset system user password",
    permissions: ["system:user:manage"],
    responseSchema: "GenericObject"
  },
  ...rentalBusinessOperations(),
  ...TENANT_INTEGRATION_OPERATIONS,
  ...TENANT_MESSAGING_OPERATIONS,
  ...INTEGRATION_BACKLOG_OPERATIONS,
  ...corePackageContractOperations
];

function rentalBusinessOperations(): ContractOperation[] { return [
  // 公共字典/编号沿原路径与operationId；返回和请求字段从同一工具schema取得。
  ...PLATFORM_TOOLS_HTTP_OPERATIONS.map((item): ContractOperation => ({
    method: item.method.toLowerCase() as HttpMethod,
    path: `/api${item.path.replace(/:([a-zA-Z]+)/g, "{$1}")}`,
    tag: "Platform", operationId: item.id, summary: item.summary,
    permissions: [item.permission], responseSchema: item.response,
    ...("request" in item ? { requestSchema: item.request } : {})
  })),
  // 公共组织/安全操作与字段单源；保留原operationId，改正旧组织写入文档的权限和GenericObject缺口。
  ...PLATFORM_SETTINGS_HTTP_OPERATIONS.map((item): ContractOperation => ({
    method: item.method.toLowerCase() as HttpMethod,
    path: `/api${item.path.replace(/:([a-zA-Z]+)/g, "{$1}")}`,
    tag: "Platform", operationId: item.id, summary: item.summary,
    permissions: [item.permission], responseSchema: item.response,
    ...("request" in item ? { requestSchema: item.request } : {}),
    ...("query" in item ? { parameters: item.query.map(name => queryParam(name, PLATFORM_SETTINGS_OPENAPI_QUERY_SCHEMAS[name])) } : {})
  })),
  // 公共来源合同单源；组合文档保留原路径、operationId和权限，引用实际DTO字段。
  ...OFFICIAL_CALENDAR_HTTP_OPERATIONS.map((item): ContractOperation => ({
    method: item.method.toLowerCase() as HttpMethod,
    path: `/api${item.path.replace(/:([a-zA-Z]+)/g, "{$1}")}`,
    tag: "OfficialCalendarSource", operationId: item.id, summary: item.summary,
    permissions: [item.permission], responseSchema: item.response,
    ...("request" in item ? { requestSchema: item.request } : {}),
    ...("query" in item ? { parameters: item.query.map(name => queryParam(name, OFFICIAL_CALENDAR_OPENAPI_QUERY_SCHEMAS[name])) } : {})
  })),
  // 公共订阅HTTP与schema单源。保留原客户端路径和operationId，员工投影仍由Rental消费。
  ...SUBSCRIPTION_HTTP_OPERATIONS.map((item): ContractOperation => ({
    method: item.method.toLowerCase() as HttpMethod,
    path: `/api${item.path.replace(/:([a-zA-Z]+)/g, "{$1}")}`,
    tag: "Subscription", operationId: item.id, summary: item.summary,
    permissions: "permission" in item ? [item.permission] : [],
    responseSchema: item.response,
    ...("request" in item ? { requestSchema: item.request } : {}),
    ...("query" in item ? { parameters: item.query.map(name => queryParam(name, SUBSCRIPTION_OPENAPI_QUERY_SCHEMAS[name])) } : {})
  }))
]; }

export const OPENAPI_DOCUMENT = createPlatformCorePackageOpenApi({
  openapi: "3.0.3",
  info: {
    title: "Rental OS API",
    version: "0.1.0",
    description:
      "Internal OpenAPI contract for the Rental OS platform. Runtime responses are wrapped as { data, requestId } unless the path is /api/openapi.json."
  },
  servers: [
    {
      url: "http://localhost:3000"
    }
  ],
  tags: [
    { name: "Contract" },
    { name: "Health" },
    { name: "Auth" },
    { name: "Platform" },
    { name: "RentalOS" },
    { name: "Dispatch" },
    { name: "MasterData" },
    { name: "Customer" },
    { name: "Order" },
    { name: "RentalCore" },
    { name: "RentalBusiness" },
    { name: "Reports" },
    { name: "Core packages" }
  ],
  // 包管理片段已有原响应包装；旧渲染器仅处理原操作，合并仍核路径/schema冲突。
  paths: buildPaths(API_CONTRACT_OPERATIONS.filter(operation => !corePackageContractOperations.includes(operation))),
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer"
      }
    },
    schemas: Object.fromEntries<Record<string, unknown>>(
      Object.entries(OPENAPI_COMPONENT_SCHEMAS).map(([name, schema]) => [name, { ...schema }])
    )
  }
});
