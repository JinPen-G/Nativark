/** 租户第三方配置的原三个接口，宿主供给当前会话的唯一请求入口。 */
import type {
  SaveTenantIntegrationRequest,
  TenantIntegrationCapability,
  TenantIntegrationCatalogResponse,
  TenantIntegrationConfigSummary,
  TenantIntegrationProvider,
  TenantIntegrationTestResult
} from "@rental-os/platform-contracts/tenant-integrations";
import { useMemo } from "react";
import { useAdminRuntime, type AdminRuntime } from "../../runtime";

export function createTenantIntegrationsApi(request: AdminRuntime["request"]) {
  return {
    catalog: () => request<TenantIntegrationCatalogResponse>("/platform/integrations"),
    save: (capability: TenantIntegrationCapability, provider: TenantIntegrationProvider, payload: SaveTenantIntegrationRequest) =>
      request<TenantIntegrationConfigSummary>(`/platform/integrations/${capability}/${provider}`, { method: "put", data: payload, retryAuthentication: false }),
    test: (capability: TenantIntegrationCapability, provider: TenantIntegrationProvider) =>
      request<TenantIntegrationTestResult>(`/platform/integrations/${capability}/${provider}/test`, { method: "post", retryAuthentication: false })
  };
}

export function useTenantIntegrationsApi() {
  const runtime = useAdminRuntime();
  return useMemo(() => createTenantIntegrationsApi(runtime.request), [runtime]);
}
