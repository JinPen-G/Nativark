/** 开业状态沿原租户与当前经营空间接口读取，状态和报价阻塞项由 Rental 服务端提供。 */
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";
import type { TenantReadinessStatus } from "@rental-os/rental-core";

export function createRentalSetupApi(request: AdminRuntime["request"]) {
  return {
    tenantReadiness: (signal?: AbortSignal) =>
      request<TenantReadinessStatus>("/rental/v1/tenant-readiness", { signal }),
  };
}

export type RentalSetupApi = ReturnType<typeof createRentalSetupApi>;
