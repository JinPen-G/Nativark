/** 原外观接口只通过宿主已有请求发送；保存不重放，修订号保留原契约。 */
import { useMemo } from "react";
import type { AccountAppearanceProfile, SaveAccountAppearanceRequest, SaveTenantAppearanceRequest, TenantAppearanceProfile } from "@rental-os/platform-contracts";
import { useAdminRuntime, type AdminRuntime } from "../../runtime";
export function createAppearanceApi(request: AdminRuntime["request"]) {
  return {
    appearanceApi: {
      getProfile: () => request<TenantAppearanceProfile>("/platform/appearance"),
      saveProfile: (data: SaveTenantAppearanceRequest) => request<TenantAppearanceProfile>("/platform/appearance", { method: "put", data, retryAuthentication: false }),
    },
    accountAppearanceApi: {
      getProfile: () => request<AccountAppearanceProfile>("/platform/account-appearance"),
      saveProfile: (data: SaveAccountAppearanceRequest) => request<AccountAppearanceProfile>("/platform/account-appearance", { method: "put", data, retryAuthentication: false }),
    },
  };
}
export function useAppearanceApi() {
  const { request } = useAdminRuntime();
  return useMemo(() => createAppearanceApi(request), [request]);
}
