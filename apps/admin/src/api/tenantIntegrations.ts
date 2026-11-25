/** 原请求实例供给公共租户集成 API，保持目录、保存和连接测试的原出口。 */
import type { ApiResult } from "@rental-os/platform-contracts";
import { createTenantIntegrationsApi } from "@rental-os/platform-admin/integration-client";
import { http } from "./http";

export const tenantIntegrationsApi = createTenantIntegrationsApi(async <T>(url: string, options = {}) => {
  const response = await http.request<ApiResult<T>>({ url, ...options });
  return response.data.data;
});
