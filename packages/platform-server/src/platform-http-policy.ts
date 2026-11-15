/** 公共HTTP方法、鉴权及接口资料的同源声明；业务Core另按其注册目录和当前授权接入。 */
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
] as const;

export function platformHttpPolicy(method: string, path: string) {
  const verb = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  return PLATFORM_HTTP_OPERATIONS.find(item => item.method === verb && item.path === path);
}
