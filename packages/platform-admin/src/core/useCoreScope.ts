/** 页面读取已获权Core自己的绑定/就绪，调用时复核原范围投影；失效观察不提供旧准入结果。 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CoreScopeReference, CoreScopeObservation } from "@rental-os/core-contracts";
import { useAdminSession, useAdminRuntime } from "../runtime";
import { useCoreManagementApi } from "./management-client";
import { useCoreSession } from "./useCoreSession";

export function useCoreScope(coreId: string, container?: CoreScopeReference["container"]) {
  const runtime = useAdminRuntime(), client = useQueryClient(), coreManagementApi = useCoreManagementApi();
  const { tenant, user, sessionVerified } = useAdminSession();
  const epoch = runtime.currentSessionEpoch();
  const session = useCoreSession();
  const admission = session.data?.cores.find(entry => entry.core.id === coreId)?.admission;
  const permitted = session.canAccess(coreId, []);
  const queryKey = ["platform-core-scope", epoch, tenant?.tenantId, user?.id, coreId, container?.type, container?.id,
    JSON.stringify(admission)];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const observed = await coreManagementApi.scope({ coreId, ...(container ? { container } : {}) }, signal);
      if (observed.status === "bound" && (observed.binding.tenantId !== tenant?.tenantId || observed.binding.coreId !== coreId
        || observed.binding.container?.type !== container?.type || observed.binding.container?.id !== container?.id))
        throw new Error("Core范围响应与当前页面不一致");
      return observed;
    },
    enabled: sessionVerified && Boolean(tenant && user) && permitted
  });
  const scopeSnapshot = JSON.stringify(query.data);
  return { ...query, data: permitted && !session.error && !query.error ? query.data : undefined,
    isPending: session.isPending || permitted && query.isPending, error: session.error ?? query.error,
    isCurrent: () => {
      const current = runtime.getSession();
      const cached = client.getQueryState<CoreScopeObservation>(queryKey);
      return Boolean(sessionVerified && current.sessionVerified && session.canAccess(coreId, []) && runtime.currentSessionEpoch() === epoch
        && current.tenant?.tenantId === tenant?.tenantId && current.user?.id === user?.id
        && query.data && !query.error && cached?.status === "success" && !cached.error
        && scopeSnapshot === JSON.stringify(cached.data));
    },
    ready: Boolean(permitted && !session.error && !query.error && query.data?.status === "bound" && query.data.readiness.status === "ready") };
}
