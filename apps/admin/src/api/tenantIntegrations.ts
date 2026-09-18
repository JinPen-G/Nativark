/** 租户集成配置 API：支付 / 文件存储等第三方能力的目录、保存与连通性测试（`/platform/integrations*`）。 */
import type {
  ApiResult,
  SaveTenantIntegrationRequest,
  TenantIntegrationCapability,
  TenantIntegrationCatalogResponse,
  TenantIntegrationConfigSummary,
  TenantIntegrationProvider,
  TenantIntegrationTestResult
} from "@rental-os/shared";
import { http } from "./http";

export const tenantIntegrationsApi = {
  async catalog() {
    const response = await http.get<ApiResult<TenantIntegrationCatalogResponse>>("/platform/integrations");
    return response.data.data;
  },
  async save(capability: TenantIntegrationCapability, provider: TenantIntegrationProvider, payload: SaveTenantIntegrationRequest) {
    const response = await http.put<ApiResult<TenantIntegrationConfigSummary>>(`/platform/integrations/${capability}/${provider}`, payload);
    return response.data.data;
  },
  async test(capability: TenantIntegrationCapability, provider: TenantIntegrationProvider) {
    const response = await http.post<ApiResult<TenantIntegrationTestResult>>(`/platform/integrations/${capability}/${provider}/test`);
    return response.data.data;
  }
};
