/** 原组织与安全管理操作。租户组织、全平台安全保存与原 MVP 管理工具分别按当前主体授权。 */
export const PLATFORM_SETTINGS_HTTP_OPERATIONS = [
  { method: "GET", path: "/platform/organizations", id: "listOrganizations", summary: "读取当前租户的受权组织",
    access: "tenant", permission: "system:user:manage", query: ["tenantId"], response: "PlatformSettings.Organizations" },
  { method: "POST", path: "/platform/organizations", id: "createOrganization", summary: "创建当前租户组织",
    access: "tenant", permission: "system:user:manage", request: "PlatformSettings.SaveOrganization", response: "PlatformSettings.Organization" },
  { method: "PUT", path: "/platform/organizations/:id", id: "updateOrganization", summary: "维护当前租户组织",
    access: "tenant", permission: "system:user:manage", request: "PlatformSettings.SaveOrganization", response: "PlatformSettings.Organization" },
  { method: "PUT", path: "/platform/organizations/:id/status", id: "setOrganizationStatus", summary: "启用或停用当前租户组织",
    access: "tenant", permission: "system:user:manage", request: "PlatformSettings.OrganizationStatus", response: "PlatformSettings.Organization" },
  { method: "GET", path: "/platform/security-baseline", id: "getSecurityBaseline", summary: "读取原全平台安全配置",
    access: "authenticated", permission: "system:params:manage", response: "PlatformSettings.SecurityBaseline" },
  { method: "PUT", path: "/platform/security-baseline", id: "saveSecurityBaseline", summary: "SaaS维护原全平台安全配置",
    access: "saas", permission: "system:params:manage", request: "PlatformSettings.SaveSecurityBaseline", response: "PlatformSettings.SecurityBaseline" },
  { method: "POST", path: "/platform/security-baseline/second-confirmation/check", id: "checkSecondConfirmation", summary: "读取原MVP二次确认管理工具结果",
    access: "tenant", permission: "system:params:manage", request: "PlatformSettings.SecondConfirmation", response: "PlatformSettings.SecondConfirmationResult" }
] as const;
