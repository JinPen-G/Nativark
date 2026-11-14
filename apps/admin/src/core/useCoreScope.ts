/** 页面读取已获权Core自己的绑定/就绪，当前范围进入缓存键；失败或未验证不提供旧准入结果。 */
import { useQuery } from "@tanstack/react-query";
import type { CoreScopeReference } from "@rental-os/core-contracts";
import { useAuthStore } from "@/features/auth/authStore";
import { currentSessionEpoch } from "@/app/queryClient";
import { coreManagementApi } from "./management-client";

export function useCoreScope(coreId: string, container?: CoreScopeReference["container"]) {
  const { tenant, user, sessionVerified } = useAuthStore();
  const query = useQuery({
    queryKey: ["platform-core-scope", currentSessionEpoch(), tenant?.tenantId, user?.id, coreId, container?.type, container?.id],
    queryFn: async ({ signal }) => {
      const observed = await coreManagementApi.scope({ coreId, ...(container ? { container } : {}) }, signal);
      if (observed.status === "bound" && (observed.binding.tenantId !== tenant?.tenantId || observed.binding.coreId !== coreId
        || observed.binding.container?.type !== container?.type || observed.binding.container?.id !== container?.id))
        throw new Error("Core范围响应与当前页面不一致");
      return observed;
    },
    enabled: sessionVerified && Boolean(tenant && user)
  });
  return { ...query, data: sessionVerified && !query.error ? query.data : undefined,
    ready: Boolean(sessionVerified && !query.error && query.data?.status === "bound" && query.data.readiness.status === "ready") };
}
