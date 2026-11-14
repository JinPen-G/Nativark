/** 登录成员的Core目录沿原认证和查询缓存读取；页面就绪/对象范围仍由宿主及所属Core处理。 */
import { useQuery } from "@tanstack/react-query";
import { canUseCorePage } from "@rental-os/core-contracts";
import { useAuthStore } from "@/features/auth/authStore";
import { currentSessionEpoch } from "@/app/queryClient";
import { coreManagementApi } from "./management-client";

export function useCoreSession() {
  const { tenant, user, sessionVerified } = useAuthStore();
  const query = useQuery({
    queryKey: ["platform-core-session", currentSessionEpoch(), tenant?.tenantId, user?.id],
    queryFn: async ({ signal }) => {
      const context = await coreManagementApi.sessionContext(signal);
      if (context.tenantId !== tenant?.tenantId || context.subjectId !== user?.id)
        throw new Error("Core目录与当前原会话不一致");
      return context;
    },
    enabled: sessionVerified && Boolean(tenant && user)
  });
  return {
    ...query,
    data: sessionVerified && !query.error ? query.data : undefined,
    canAccess(coreId: string, permissions: readonly { resource: string; action: string }[]): boolean {
      return Boolean(sessionVerified && query.data && !query.error && canUseCorePage(query.data, coreId, permissions));
    }
  };
}
