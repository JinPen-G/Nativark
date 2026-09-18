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
  LoginRequest,
  LoginResponse,
  ChangePasswordRequest,
  CreateBusinessWorkspaceRequest,
  RefreshSessionRequest,
  ResetUserPasswordResult,
  ResetLocalDemoPasswordRequest,
  ResetLocalDemoPasswordResult,
  SessionContextResponse,
  OrganizationSummary,
  PermissionModule,
  PlatformAuditLogRow,
  SaveOrganizationRequest,
  SaveSystemRoleRequest,
  SaveSystemUserAccessRequest,
  SaveSystemUserRequest,
  SystemSecurityBaselineConfig,
  SystemRoleRow,
  SystemRulesConfig,
  SystemUserRow,
  TenantBootstrapPreview,
  TenantBootstrapRequest,
  TenantBootstrapResult,
  TenantSummary,
  UpdateBusinessWorkspaceRequest,
  UpdateTenantRequest,
  UpdateTenantStatusRequest
} from "@rental-os/shared";
import { request } from "./http";

export const api = {
  // ---- 会话 ----
  login: (payload: LoginRequest) => request<LoginResponse>("/auth/login", { method: "post", data: payload }),
  resetLocalDemoPassword: (payload: ResetLocalDemoPasswordRequest) => request<ResetLocalDemoPasswordResult>("/auth/development/reset-demo-password", { method: "post", data: payload }),
  logout: (payload: RefreshSessionRequest) => request<{ loggedOut: boolean }>("/auth/logout", { method: "post", data: payload }),
  changePassword: (payload: ChangePasswordRequest) => request<LoginResponse>("/auth/change-password", { method: "post", data: payload }),
  // SPACE-05：切换当前经营空间。服务端重新校验成员资格与空间状态。
  switchWorkspace: (payload: { workspaceId: string }) => request<LoginResponse>("/auth/switch-workspace", { method: "post", data: payload }),
  sessionContext: () => request<SessionContextResponse>("/auth/session-context"),

  // ---- 系统规则与安全基线 ----
  systemRules: () => request<SystemRulesConfig>("/platform/system-rules"),
  saveSystemRuleSection: (sectionKey: string, config: SystemRulesConfig, operator: string) => request<SystemRulesConfig>(`/platform/system-rules/${sectionKey}`, { method: "put", data: { config, operator } }),
  testAiConnection: (operator: string) => request<unknown>("/platform/system-rules/ai-test", { method: "post", data: { operator } }),
  securityBaseline: () => request<SystemSecurityBaselineConfig>("/platform/security-baseline"),
  saveSecurityBaseline: (config: SystemSecurityBaselineConfig, operator?: string) => request<SystemSecurityBaselineConfig>("/platform/security-baseline", { method: "put", data: { config, operator } }),
  checkSecondConfirmation: (action: string, confirmationCode?: string) => request<{ action: string; required: boolean; accepted: boolean; message: string }>("/platform/security-baseline/second-confirmation/check", { method: "post", data: { action, confirmationCode } }),

  // ---- 当前租户：经营空间、组织、账号、角色 ----
  workspaces: () => request<BusinessWorkspace[]>("/platform/workspaces"),
  workspaceMembers: (workspaceId: string) => request<WorkspaceMember[]>(`/platform/workspaces/${workspaceId}/members`),
  organizations: () => request<OrganizationSummary[]>("/platform/organizations"),
  saveOrganization: (payload: SaveOrganizationRequest) => request<OrganizationSummary>(payload.id ? `/platform/organizations/${payload.id}` : "/platform/organizations", { method: payload.id ? "put" : "post", data: payload }),
  setOrganizationStatus: (id: string, status: OrganizationSummary["status"], operator: string) => request<OrganizationSummary>(`/platform/organizations/${id}/status`, { method: "put", data: { status, operator } }),
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
  bootstrapTenant: (payload: TenantBootstrapRequest) => request<TenantBootstrapResult>("/platform/tenant-bootstrap", { method: "post", data: payload }),
  tenants: () => request<TenantSummary[]>("/platform/tenants"),
  updateTenant: (id: string, payload: UpdateTenantRequest) => request<TenantSummary>(`/platform/tenants/${id}`, { method: "put", data: payload }),
  updateTenantStatus: (id: string, payload: UpdateTenantStatusRequest) => request<TenantSummary>(`/platform/tenants/${id}/status`, { method: "put", data: payload }),
  resetTenantAdminPassword: (tenantId: string) => request<ResetUserPasswordResult>(`/platform/tenants/${tenantId}/admin/reset-password`, { method: "post" }),
  tenantWorkspaces: (tenantId: string) => request<BusinessWorkspace[]>(`/platform/tenants/${tenantId}/workspaces`),
  createTenantWorkspace: (tenantId: string, payload: CreateBusinessWorkspaceRequest) => request<BusinessWorkspace>(`/platform/tenants/${tenantId}/workspaces`, { method: "post", data: payload }),
  updateTenantWorkspace: (tenantId: string, workspaceId: string, payload: UpdateBusinessWorkspaceRequest) => request<BusinessWorkspace>(`/platform/tenants/${tenantId}/workspaces/${workspaceId}`, { method: "put", data: payload })
};
