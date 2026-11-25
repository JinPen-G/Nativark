/** Rental 浏览器凭据与空间投影，刷新、锁和请求取消沿公共 HTTP 实现。
 * 同文档消费者只接收原服务端刷新回执。宿主供给同一查询缓存与会话代次。 */
import type { LoginResponse } from "@rental-os/rental-core/auth-contracts";
import { createAdminHttpClient, type createAdminSessionQueries } from "@rental-os/platform-admin/runtime";

export function createRentalAdminHttpClient(baseURL: string, queries: ReturnType<typeof createAdminSessionQueries>) {
  const { clearSessionQueryCache, currentSessionEpoch, currentSessionSignal } = queries;
  const apiAssetOrigin = /^https?:\/\//.test(baseURL) ? new URL(baseURL).origin : "";
  const refreshListeners = new Set<(session: LoginResponse) => void>();
  function onSessionRefreshed(listener: (session: LoginResponse) => void) {
    refreshListeners.add(listener);
    return () => { refreshListeners.delete(listener); };
  }
  function storeRefreshedSession(session: LoginResponse) {
    const previousWorkspaceId = window.localStorage.getItem("rental_current_workspace");
    window.localStorage.setItem("rental_access_token", session.accessToken);
    window.localStorage.setItem("rental_refresh_token", session.refreshToken);
    window.localStorage.setItem("rental_tenant", JSON.stringify(session.tenant));
    window.localStorage.setItem("rental_user", JSON.stringify(session.user));
    window.localStorage.setItem("rental_workspaces", JSON.stringify(session.workspaces ?? []));
    if (session.currentWorkspaceId) window.localStorage.setItem("rental_current_workspace", session.currentWorkspaceId);
    else window.localStorage.removeItem("rental_current_workspace");
    if (previousWorkspaceId !== (session.currentWorkspaceId ?? null)) clearSessionQueryCache();
    // 原回执先提交给同文档会话，再通知 storage 投影消费者。
    for (const listener of refreshListeners) listener(session);
    window.dispatchEvent(new CustomEvent("rental-session-updated"));
  }

  const transport = createAdminHttpClient<LoginResponse>({ baseURL, refreshLockName: "rental-auth-refresh", session: {
    accessToken: () => window.localStorage.getItem("rental_access_token") ?? undefined,
    refreshToken: () => window.localStorage.getItem("rental_refresh_token") ?? undefined,
    tenant: () => {
      const raw = window.localStorage.getItem("rental_tenant");
      if (!raw) return undefined;
      try { return JSON.parse(raw) as { tenantId: string; tenantCode: string }; }
      catch { window.localStorage.removeItem("rental_tenant"); return undefined; }
    },
    currentSessionEpoch, currentSessionSignal, commitRefresh: storeRefreshedSession,
    expire: () => {
      ["rental_access_token", "rental_refresh_token", "rental_tenant", "rental_user", "rental_workspaces", "rental_current_workspace"]
        .forEach(key => window.localStorage.removeItem(key));
      clearSessionQueryCache(); window.dispatchEvent(new CustomEvent("rental-session-updated"));
      if (window.location.pathname !== "/login") window.location.assign("/login");
    },
  } });
  return { ...transport, apiAssetOrigin, onSessionRefreshed };
}
