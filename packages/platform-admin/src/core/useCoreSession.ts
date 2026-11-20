/** 登录成员的Core目录沿原认证和缓存读取，旧回调即时核对当前主体及本Core授权修订。
 * 页面就绪/对象范围仍由宿主及所属Core处理，目录不授予服务端业务执行权。 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { canUseCorePage, type CoreSessionContext } from "@rental-os/core-contracts";
import { useAdminSession, useAdminRuntime } from "../runtime";
import { useCoreManagementApi } from "./management-client";

export function useCoreSession() {
  const runtime = useAdminRuntime(), client = useQueryClient(), coreManagementApi = useCoreManagementApi();
  const { tenant, user, sessionVerified } = useAdminSession();
  const epoch = runtime.currentSessionEpoch();
  const queryKey = ["platform-core-session", epoch, tenant?.tenantId, user?.id];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const context = await coreManagementApi.sessionContext(signal);
      if (context.tenantId !== tenant?.tenantId || context.subjectId !== user?.id)
        throw new Error("Core目录与当前原会话不一致");
      return context;
    },
    enabled: sessionVerified && Boolean(tenant && user)
  });
  const currentContext = () => {
    const current = runtime.getSession();
    const cached = client.getQueryState<CoreSessionContext>(queryKey);
    if (!sessionVerified || !current.sessionVerified || runtime.currentSessionEpoch() !== epoch
      || current.tenant?.tenantId !== tenant?.tenantId || current.user?.id !== user?.id
      || cached?.status !== "success" || cached.error) return;
    return cached.data;
  };
  const contextSnapshot = JSON.stringify(query.data);
  return {
    ...query,
    data: sessionVerified && !query.error ? query.data : undefined,
    /** 目录管理核原投影，指定Core时只绑定当前管理资格及该Core的授权修订。 */
    isCurrent(coreId?: string): boolean {
      const current = currentContext();
      const same = coreId === undefined ? contextSnapshot === JSON.stringify(current)
        : JSON.stringify(query.data?.cores.find(entry => entry.core.id === coreId))
          === JSON.stringify(current?.cores.find(entry => entry.core.id === coreId));
      return Boolean(query.data && current && !query.error
        && query.data.canManageMembers === current.canManageMembers && same);
    },
    canAccess(coreId: string, permissions: readonly { resource: string; action: string }[]): boolean {
      const current = currentContext();
      const original = query.data?.cores.find(entry => entry.core.id === coreId);
      const granted = current?.cores.find(entry => entry.core.id === coreId);
      // 只绑定本Core的授权/分配修订，其他Core变化不释放当前页的草稿和原操作。
      return Boolean(current && original && granted && !query.error
        && JSON.stringify(original) === JSON.stringify(granted) && canUseCorePage(current, coreId, permissions));
    }
  };
}
