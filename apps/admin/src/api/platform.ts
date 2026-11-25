/**
 * 会话与平台/租户管理 API：登录、令牌轮换、切换经营空间，以及 SaaS 平台端与
 * 租户端共用的系统规则、安全基线、组织、账号、角色、权限树、审计、租户生命周期。
 *
 * 运维工具类接口（字典、编号规则、筛选预设、异步/打印任务、文件、通知、适配器）
 * 见 `./platformOps.ts`；门市业务见 `./rentalCore.ts`。
 */
import type {
  BusinessWorkspace,
  WorkspaceMember,
  CreateBusinessWorkspaceRequest,
  RefreshSessionRequest,
  ResetUserPasswordResult,
  ResetLocalDemoPasswordRequest,
  ResetLocalDemoPasswordResult,
  PermissionModule,
  PlatformAuditLogRow,
  SaveSystemRoleRequest,
  SaveSystemUserAccessRequest,
  SaveSystemUserRequest,
  SystemRoleRow,
  SystemRulesConfig,
  SystemUserRow,
  TenantBootstrapPreview,
  TenantBootstrapRequest,
  TenantBootstrapResult,
  RentalCategoryOpeningOptions, RentalCategoryOpeningOptionsQuery,
  TenantSummary,
  UpdateBusinessWorkspaceRequest,
  UpdateTenantRequest,
  UpdateTenantStatusRequest
} from "@rental-os/shared";
import { request, rentalBrowserSession } from "./http";
import { createPlatformSettingsApi } from "@rental-os/platform-admin/platform-settings/client";
const platformSettingsApi = createPlatformSettingsApi(request);

export const api = {
  // ---- 会话 ----
  login: rentalBrowserSession.api.login,
  resetLocalDemoPassword: (payload: ResetLocalDemoPasswordRequest) => request<ResetLocalDemoPasswordResult>("/auth/development/reset-demo-password", { method: "post", data: payload }),
  logout: (payload: RefreshSessionRequest) => request<{ loggedOut: boolean }>("/auth/logout", { method: "post", data: payload }),
  changePassword: rentalBrowserSession.api.changePassword,
  // SPACE-05：切换当前经营空间。服务端重新校验成员资格与空间状态。
  switchWorkspace: rentalBrowserSession.api.switchWorkspace,
  sessionContext: rentalBrowserSession.api.sessionContext,

  // ---- 系统规则与安全基线 ----
  systemRules: () => request<SystemRulesConfig>("/platform/system-rules"),
  saveSystemRuleSection: (sectionKey: string, config: SystemRulesConfig, operator: string) => request<SystemRulesConfig>(`/platform/system-rules/${sectionKey}`, { method: "put", data: { config, operator } }),
  testAiConnection: (operator: string) => request<unknown>("/platform/system-rules/ai-test", { method: "post", data: { operator } }),
  securityBaseline: () => platformSettingsApi.securityBaseline(),
  saveSecurityBaseline: platformSettingsApi.saveSecurityBaseline,
  checkSecondConfirmation: platformSettingsApi.checkSecondConfirmation,

  // ---- 当前租户：经营空间、组织、账号、角色 ----
  workspaces: () => request<BusinessWorkspace[]>("/platform/workspaces"),
  workspaceMembers: (workspaceId: string) => request<WorkspaceMember[]>(`/platform/workspaces/${workspaceId}/members`),
  workspaceFulfillmentLocations: (workspaceId: string) => request<Array<{ id: string; name: string; code: string; status: string }>>(`/platform/workspaces/${workspaceId}/fulfillment-locations`),
  organizations: () => platformSettingsApi.organizations(),
  saveOrganization: platformSettingsApi.saveOrganization,
  setOrganizationStatus: platformSettingsApi.setOrganizationStatus,
  users: () => request<SystemUserRow[]>("/platform/users"),
  saveUser: (payload: SaveSystemUserRequest) => request<SystemUserRow>(payload.id ? `/platform/users/${payload.id}` : "/platform/users", { method: payload.id ? "put" : "post", data: payload }),
  saveUserWithWorkspaceAccess: (payload: SaveSystemUserAccessRequest) => request<SystemUserRow>(payload.id ? `/platform/users/${payload.id}/access` : "/platform/users/access", { method: payload.id ? "put" : "post", data: payload }),
  setUserStatus: (id: string, isActive: boolean) => request<SystemUserRow>(`/platform/users/${id}/status`, { method: "put", data: { isActive } }),
  resetUserPassword: (id: string) => request<ResetUserPasswordResult>(`/platform/users/${id}/reset-password`, { method: "post" }),
  roles: () => request<SystemRoleRow[]>("/platform/roles"),
  saveRole: (payload: SaveSystemRoleRequest) => request<SystemRoleRow>(payload.id ? `/platform/roles/${payload.id}` : "/platform/roles", { method: payload.id ? "put" : "post", data: payload }),
  deleteRole: (id: string) => request<{ id: string; deleted: boolean }>(`/platform/roles/${id}`, { method: "delete" }),
  permissionTree: () => request<PermissionModule[]>("/platform/permission-tree"),
  auditLogs: () => request<{ rows: PlatformAuditLogRow[]; total: number }>("/platform/audit-logs"),

  // ---- SaaS 平台端：租户生命周期与目标租户经营空间 ----
  tenantBootstrapPreview: () => request<TenantBootstrapPreview>("/platform/tenant-bootstrap/preview"),
  rentalCategoryOpeningOptions: async (params: RentalCategoryOpeningOptionsQuery = {}) => {
    const result = await request<RentalCategoryOpeningOptions>("/platform/tenant-bootstrap/category-options", { params });
    if (result.structureVersion !== 1 || !["published", "builtin_demo"].includes(result.source) || !Array.isArray(result.options) ||
      result.options.length > 100 || result.source === "published" && result.options.some(option => !option.versionId)) throw new Error("Unsupported rental category options");
    return result;
  },
  bootstrapTenant: (payload: TenantBootstrapRequest) => request<TenantBootstrapResult>("/platform/tenant-bootstrap", { method: "post", data: payload }),
  tenants: () => request<TenantSummary[]>("/platform/tenants"),
  updateTenant: (id: string, payload: UpdateTenantRequest) => request<TenantSummary>(`/platform/tenants/${id}`, { method: "put", data: payload }),
  updateTenantStatus: (id: string, payload: UpdateTenantStatusRequest) => request<TenantSummary>(`/platform/tenants/${id}/status`, { method: "put", data: payload }),
  resetTenantAdminPassword: (tenantId: string) => request<ResetUserPasswordResult>(`/platform/tenants/${tenantId}/admin/reset-password`, { method: "post" }),
  tenantWorkspaces: (tenantId: string) => request<BusinessWorkspace[]>(`/platform/tenants/${tenantId}/workspaces`),
  createTenantWorkspace: (tenantId: string, payload: CreateBusinessWorkspaceRequest) => request<BusinessWorkspace>(`/platform/tenants/${tenantId}/workspaces`, { method: "post", data: payload }),
  updateTenantWorkspace: (tenantId: string, workspaceId: string, payload: UpdateBusinessWorkspaceRequest) => request<BusinessWorkspace>(`/platform/tenants/${tenantId}/workspaces/${workspaceId}`, { method: "put", data: payload })
};
