/** 原组织与安全接口，宿主供给当前会话的唯一请求入口。 */
import type { OrganizationSummary, SaveOrganizationRequest, SystemSecurityBaselineConfig } from "@rental-os/platform-contracts";
import { useMemo } from "react";
import { useAdminRuntime, type AdminRuntime } from "../../runtime";

export function createPlatformSettingsApi(request: AdminRuntime["request"]) {
  return {
    organizations: (signal?: AbortSignal) => request<OrganizationSummary[]>("/platform/organizations", { signal }),
    saveOrganization: (payload: SaveOrganizationRequest) => request<OrganizationSummary>(
      payload.id ? `/platform/organizations/${payload.id}` : "/platform/organizations",
      { method: payload.id ? "put" : "post", data: payload, retryAuthentication: false }
    ),
    setOrganizationStatus: (id: string, status: OrganizationSummary["status"], operator: string) =>
      request<OrganizationSummary>(`/platform/organizations/${id}/status`, { method: "put", data: { status, operator }, retryAuthentication: false }),
    securityBaseline: (signal?: AbortSignal) => request<SystemSecurityBaselineConfig>("/platform/security-baseline", { signal }),
    saveSecurityBaseline: (config: SystemSecurityBaselineConfig, operator?: string) =>
      request<SystemSecurityBaselineConfig>("/platform/security-baseline", { method: "put", data: { config, operator }, retryAuthentication: false }),
    checkSecondConfirmation: (action: string, confirmationCode?: string) =>
      request<{ action: string; required: boolean; accepted: boolean; message: string }>(
        "/platform/security-baseline/second-confirmation/check", { method: "post", data: { action, confirmationCode } }
      )
  };
}

export function usePlatformSettingsApi() {
  const runtime = useAdminRuntime();
  return useMemo(() => createPlatformSettingsApi(runtime.request), [runtime]);
}
