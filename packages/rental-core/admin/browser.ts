/** 一个 Rental Web 宿主一份 Zustand 会话、刷新运输与公共 QueryClient。
 * 原后台可传入既有缓存。独立后台通过同一工厂创建，业务身份只采纳原服务端响应。 */
import type { ChangePasswordRequest, LoginRequest } from "@rental-os/platform-contracts";
import { createAdminSessionQueries, type AdminRuntime } from "@rental-os/platform-admin/runtime";
import { createRentalAdminSessionApi } from "./browser-api";
import { createRentalAdminAuthStore } from "./browser-auth-store";
import { createRentalAdminHttpClient } from "./browser-http";

export interface RentalBrowserAdminSessionOptions {
  baseURL: string;
  queries?: ReturnType<typeof createAdminSessionQueries>;
}

export function createRentalBrowserAdminSession(options: RentalBrowserAdminSessionOptions) {
  const queries = options.queries ?? createAdminSessionQueries(
    () => Boolean(window.localStorage.getItem("rental_access_token")),
  );
  const transport = createRentalAdminHttpClient(options.baseURL, queries);
  const api = createRentalAdminSessionApi(transport.request);
  const auth = createRentalAdminAuthStore({ api, queries, onSessionRefreshed: transport.onSessionRefreshed });
  const { useAuthStore } = auth;
  const subscribe = (listener: () => void) => useAuthStore.subscribe(listener);
  const runtime: AdminRuntime = {
    getSession: useAuthStore.getState,
    subscribe,
    currentSessionEpoch: queries.currentSessionEpoch,
    currentSessionSignal: queries.currentSessionSignal,
    request: transport.request,
  };

  return {
    ...queries,
    ...transport,
    api,
    apiBaseURL: options.baseURL,
    useAuthStore,
    runtime,
    getSnapshot: useAuthStore.getState,
    subscribe,
    bootstrap: () => useAuthStore.getState().bootstrap(),
    login: (input: LoginRequest) => useAuthStore.getState().login(input.tenantCode, input.account, input.password),
    changePassword: (input: ChangePasswordRequest) => useAuthStore.getState().changePassword(input.currentPassword, input.newPassword),
    async signOut() { useAuthStore.getState().logout(); },
    invalidateBusinessScope() {
      queries.clearSessionQueryCache();
      useAuthStore.setState({});
    },
    dispose() {
      auth.dispose();
      queries.clearSessionQueryCache();
    },
  };
}

export type RentalBrowserAdminSession = ReturnType<typeof createRentalBrowserAdminSession>;
