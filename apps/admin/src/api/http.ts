/** 原 Rental 宿主的凭据/空间投影，HTTP 刷新与取消由公共实现单源维护。 */
import type { LoginResponse } from "@rental-os/shared";
import { createAdminHttpClient } from "@rental-os/platform-admin/runtime";
import { clearSessionQueryCache, currentSessionEpoch, currentSessionSignal } from "@/app/queryClient";
const baseURL = import.meta.env.VITE_API_BASE_URL ?? "/api";
export const apiAssetOrigin = /^https?:\/\//.test(baseURL) ? new URL(baseURL).origin : "";
const refreshListeners = new Set<(session: LoginResponse) => void>();
export function onSessionRefreshed(listener: (session: LoginResponse) => void) {
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
  // Same-document consumers commit the original server receipt, not a cache-derived authorization claim.
  for (const listener of refreshListeners) listener(session);
  window.dispatchEvent(new CustomEvent("rental-session-updated"));
}

export const { http, request, requestText } = createAdminHttpClient<LoginResponse>({ baseURL, refreshLockName: "rental-auth-refresh", session: {
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
  }
}});
