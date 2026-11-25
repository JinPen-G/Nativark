/** 公共账号、角色和租户沿原接口及宿主唯一请求入口维护。
 * Core 的空间、业务对象和初始化判断由可选适配提供，写入不在 401 后重发。 */
import type {
  CreatePlatformTenantRequest,
  CreatePlatformTenantResult,
  PermissionModule,
  PlatformAuditResult,
  PlatformTenantSummary,
  ResetUserPasswordResult,
  SaveSystemRoleRequest,
  SaveSystemUserRequest,
  SystemRoleRow,
  SystemUserRow,
  UpdateTenantRequest,
  UpdateTenantStatusRequest
} from "@rental-os/platform-contracts";
import { useMemo } from "react";
import { useAdminRuntime, type AdminRuntime } from "../../runtime";
import { createPlatformSettingsApi } from "../platform-settings/client";

export function createPublicManagementApi(request: AdminRuntime["request"]) {
  return {
    ...createPlatformSettingsApi(request),
    users: (signal?: AbortSignal) => request<SystemUserRow[]>("/platform/users", { signal }),
    roles: (signal?: AbortSignal) => request<SystemRoleRow[]>("/platform/roles", { signal }),
    permissionTree: (signal?: AbortSignal) => request<PermissionModule[]>("/platform/permission-tree", { signal }),
    tenants: (signal?: AbortSignal) => request<PlatformTenantSummary[]>("/platform/tenants", { signal }),
    auditLogs: (signal?: AbortSignal) => request<PlatformAuditResult>("/platform/audit-logs", { signal }),
    saveUser: (payload: SaveSystemUserRequest, signal?: AbortSignal) => request<SystemUserRow>(
      payload.id ? `/platform/users/${encodeURIComponent(payload.id)}` : "/platform/users",
      { method: payload.id ? "put" : "post", data: payload, signal, retryAuthentication: false }
    ),
    setUserStatus: (id: string, isActive: boolean, signal?: AbortSignal) => request<SystemUserRow>(
      `/platform/users/${encodeURIComponent(id)}/status`,
      { method: "put", data: { isActive }, signal, retryAuthentication: false }
    ),
    resetUserPassword: (id: string, signal?: AbortSignal) => request<ResetUserPasswordResult>(
      `/platform/users/${encodeURIComponent(id)}/reset-password`,
      { method: "post", signal, retryAuthentication: false }
    ),
    saveRole: (payload: SaveSystemRoleRequest, signal?: AbortSignal) => request<SystemRoleRow>(
      payload.id ? `/platform/roles/${encodeURIComponent(payload.id)}` : "/platform/roles",
      { method: payload.id ? "put" : "post", data: payload, signal, retryAuthentication: false }
    ),
    deleteRole: (id: string, signal?: AbortSignal) => request<{ id: string; deleted: true }>(
      `/platform/roles/${encodeURIComponent(id)}`,
      { method: "delete", signal, retryAuthentication: false }
    ),
    createTenant: (payload: CreatePlatformTenantRequest, signal?: AbortSignal) => request<CreatePlatformTenantResult>(
      "/platform/tenants", { method: "post", data: payload, signal, retryAuthentication: false }
    ),
    updateTenant: (id: string, payload: UpdateTenantRequest, signal?: AbortSignal) => request<PlatformTenantSummary>(
      `/platform/tenants/${encodeURIComponent(id)}`,
      { method: "put", data: payload, signal, retryAuthentication: false }
    ),
    updateTenantStatus: (id: string, payload: UpdateTenantStatusRequest, signal?: AbortSignal) => request<PlatformTenantSummary>(
      `/platform/tenants/${encodeURIComponent(id)}/status`,
      { method: "put", data: payload, signal, retryAuthentication: false }
    ),
    resetTenantAdminPassword: (id: string, signal?: AbortSignal) => request<ResetUserPasswordResult>(
      `/platform/tenants/${encodeURIComponent(id)}/admin/reset-password`,
      { method: "post", signal, retryAuthentication: false }
    )
  };
}

export function usePublicManagementApi() {
  const runtime = useAdminRuntime();
  return useMemo(() => createPublicManagementApi(runtime.request), [runtime]);
}
