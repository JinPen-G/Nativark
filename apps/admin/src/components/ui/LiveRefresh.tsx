/** 原列表查询身份保留；共用控件与定时策略由公共前端包维护。 */
import { useAuthStore } from "@/features/auth/authStore";
export { LiveRefresh, useLiveRefresh } from "@rental-os/platform-admin/source/components/ui/LiveRefresh";

export function useListQueryIdentity() {
  return useAuthStore(state => JSON.stringify([state.tenant?.tenantId, state.currentWorkspaceId, state.user?.id,
    state.user?.isPlatformAdmin, state.user?.isSaasAdmin, state.user?.dataScope, state.user?.locationScope,
    state.user?.permissions && [...new Set(state.user.permissions)].sort(), state.user?.organizationId]));
}
