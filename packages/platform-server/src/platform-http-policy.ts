/** 公共HTTP方法、鉴权及接口资料的同源声明；业务Core另按其注册目录和当前授权接入。 */
import { SUBSCRIPTION_HTTP_OPERATIONS } from "./modules/subscription/subscription-http-policy";
import { INTEGRATION_HTTP_OPERATIONS } from "./modules/integrations/integration-http-policy";
import { OFFICIAL_CALENDAR_HTTP_OPERATIONS } from "./modules/official-calendars/official-calendar-http-policy";
import { PLATFORM_SETTINGS_HTTP_OPERATIONS } from "./modules/platform/platform-settings-http-policy";
export const PLATFORM_HTTP_OPERATIONS = [
  { method: "GET", path: "/health", id: "health", summary: "读取公共宿主健康状态", access: "anonymous", response: "Health" },
  { method: "GET", path: "/openapi.json", id: "openApi", summary: "读取当前宿主接口资料", access: "anonymous", response: "OpenApi" },
  { method: "POST", path: "/auth/login", id: "login", summary: "登录公共管理后台", access: "anonymous", request: "LoginRequest", response: "LoginResponse" },
  { method: "POST", path: "/auth/refresh", id: "refresh", summary: "单次轮换原刷新会话", access: "anonymous", request: "RefreshSessionRequest", response: "LoginResponse" },
  { method: "POST", path: "/auth/logout", id: "logout", summary: "撤销原刷新会话", access: "anonymous", request: "RefreshSessionRequest", response: "Logout" },
  { method: "GET", path: "/auth/me", id: "me", summary: "读取当前账号资料", access: "self", response: "AuthUser" },
  { method: "GET", path: "/auth/session-context", id: "sessionContext", summary: "读取公共租户与本人会话", access: "self", response: "SessionContext" },
  { method: "POST", path: "/auth/change-password", id: "changePassword", summary: "修改密码并撤销旧会话", access: "self", request: "ChangePasswordRequest", response: "LoginResponse" },
  { method: "GET", path: "/platform/account-appearance", id: "readAccountAppearance", summary: "读取本人的外观设置", access: "self", response: "AccountAppearance" },
  { method: "PUT", path: "/platform/account-appearance", id: "saveAccountAppearance", summary: "保存本人的外观设置", access: "self", request: "SaveAccountAppearance", response: "AccountAppearance" },
  { method: "GET", path: "/platform/appearance", id: "readTenantAppearance", summary: "读取本租户的品牌与外观", access: "tenant", permission: "system:integration:manage", response: "TenantAppearance" },
  { method: "PUT", path: "/platform/appearance", id: "saveTenantAppearance", summary: "保存本租户的品牌与外观", access: "tenant", permission: "system:integration:manage", request: "SaveTenantAppearance", response: "TenantAppearance" },
  { method: "GET", path: "/platform/tenants", id: "listTenants", summary: "SaaS读取公共租户", access: "saas", permission: "system:tenant:manage", response: "Tenants" },
  { method: "POST", path: "/platform/tenants", id: "createTenant", summary: "创建无业务前置的公共租户", access: "saas", permission: "system:tenant:bootstrap", request: "CreateTenant", response: "CreatedTenant" },
  { method: "PUT", path: "/platform/tenants/:id", id: "updateTenant", summary: "SaaS更新公共租户资料", access: "saas", permission: "system:tenant:manage", request: "UpdateTenant", response: "TenantSummary" },
  { method: "PUT", path: "/platform/tenants/:id/status", id: "tenantStatus", summary: "冻结恢复租户并撤销旧会话", access: "saas", permission: "system:tenant:manage", request: "TenantStatus", response: "TenantSummary" },
  { method: "GET", path: "/platform/tenant", id: "readOwnTenant", summary: "读取本租户公共资料", access: "tenant", permission: "system:tenant:manage", response: "TenantSummary" },
  { method: "PUT", path: "/platform/tenant", id: "updateOwnTenant", summary: "更新本租户公共名称", access: "tenant", permission: "system:tenant:manage", request: "UpdateTenant", response: "TenantSummary" },
  { method: "GET", path: "/platform/self-profile", id: "readSelfProfile", summary: "读取本人姓名和联系方式", access: "self", response: "SystemUser" },
  { method: "PUT", path: "/platform/self-profile", id: "saveSelfProfile", summary: "保存本人姓名和联系方式", access: "self", request: "SelfProfile", response: "SystemUser" },
  { method: "GET", path: "/platform/users", id: "listUsers", summary: "读取本租户账号", access: "tenant", permission: "system:user:manage", response: "Users" },
  { method: "POST", path: "/platform/users", id: "createUser", summary: "创建本租户账号", access: "tenant", permission: "system:user:manage", request: "SaveUser", response: "SystemUser" },
  { method: "PUT", path: "/platform/users/:id", id: "saveUser", summary: "保存本租户账号和角色", access: "tenant", permission: "system:user:manage", request: "SaveUser", response: "SystemUser" },
  { method: "PUT", path: "/platform/users/:id/status", id: "userStatus", summary: "启停账号并撤销旧会话", access: "tenant", permission: "system:user:manage", request: "UserStatus", response: "SystemUser" },
  { method: "POST", path: "/platform/users/:id/reset-password", id: "resetUserPassword", summary: "重置成员密码并撤销旧会话", access: "tenant", permission: "system:user:manage", response: "ResetPassword" },
  { method: "GET", path: "/platform/roles", id: "listRoles", summary: "读取本租户角色", access: "tenant", permission: "system:role:manage", response: "Roles" },
  { method: "POST", path: "/platform/roles", id: "createRole", summary: "创建本租户角色", access: "tenant", permission: "system:role:manage", request: "SaveRole", response: "Role" },
  { method: "PUT", path: "/platform/roles/:id", id: "saveRole", summary: "保存本租户角色权限", access: "tenant", permission: "system:role:manage", request: "SaveRole", response: "Role" },
  { method: "DELETE", path: "/platform/roles/:id", id: "deleteRole", summary: "删除未分配的普通角色", access: "tenant", permission: "system:role:manage", response: "Deleted" },
  { method: "GET", path: "/platform/permission-tree", id: "permissionTree", summary: "读取实际登记的公共与Core权限", access: "tenant", permission: "system:role:manage", response: "PermissionTree" },
  ...SUBSCRIPTION_HTTP_OPERATIONS,
  ...INTEGRATION_HTTP_OPERATIONS,
  ...OFFICIAL_CALENDAR_HTTP_OPERATIONS,
  ...PLATFORM_SETTINGS_HTTP_OPERATIONS,
] as const;

export function platformHttpPolicy(method: string, path: string) {
  const verb = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  const segments = path.split("/");
  return PLATFORM_HTTP_OPERATIONS.find(item => item.method === verb && item.path.split("/").length === segments.length
    && item.path.split("/").every((segment, index) => segment.startsWith(":") ? Boolean(segments[index]) : segment === segments[index]));
}
