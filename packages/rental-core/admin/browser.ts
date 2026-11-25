/** 一个 Rental Web 宿主一份 Zustand 会话、刷新运输与公共 QueryClient。
 * 原后台可传入既有缓存。独立后台通过同一工厂创建，业务身份只采纳原服务端响应。 */
import axios from "axios";
import { createRentalClientChannelApi } from "./channels/client";
import type { AdminRequestOptions } from "@rental-os/platform-admin/runtime";
import type { ApiResult, ChangePasswordRequest, LoginRequest, ResetLocalDemoPasswordResult } from "@rental-os/platform-contracts";
import { createAdminSessionQueries, type AdminRuntime } from "@rental-os/platform-admin/runtime";
import { createRentalAdminSessionApi } from "./browser-api";
import { createRentalAdminAuthStore } from "./browser-auth-store";
import { createRentalAdminHttpClient } from "./browser-http";

export interface RentalBrowserAdminSessionOptions {
  baseURL: string;
  /** 原本机开发快捷入口，正式宿主默认不展示；服务端仍校验原环境和权限。 */
  loginDevelopment?: boolean;
  queries?: ReturnType<typeof createAdminSessionQueries>;
}

export function createRentalBrowserAdminSession(options: RentalBrowserAdminSessionOptions) {
  const queries = options.queries ?? createAdminSessionQueries(
    () => Boolean(window.localStorage.getItem("rental_access_token")),
  );
  const transport = createRentalAdminHttpClient(options.baseURL, queries);
  const api = createRentalAdminSessionApi(transport.request, transport.revokeSession);
  // 登录前只读网址租户的公开品牌；不携带旧会话凭据、不触发刷新。
  const publicHttp = axios.create({ baseURL: options.baseURL, timeout: 12_000, withCredentials: false,
    headers: { Authorization: null, "x-tenant-id": null, "x-tenant-code": null, "x-workspace-id": null } });
  const publicChannel = createRentalClientChannelApi(async <Output>(path: string, request?: AdminRequestOptions) =>
    (await publicHttp.request<ApiResult<Output>>({ url: path, method: "get", ...request })).data.data);
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
    loginDisplay: { apiAssetOrigin: transport.apiAssetOrigin, loadTenantBrand: publicChannel.getPublicBootstrap,
      development: options.loginDevelopment ? {
        accounts: [
          { label: "演示香港租户管理员", tenantCode: "demo", account: "admin" },
          { label: "演示深圳租户管理员", tenantCode: "demo2", account: "admin" },
          { label: "SaaS 平台管理员", tenantCode: "platform", account: "admin" },
        ],
        resetPassword: (data: { password: string }) => transport.request<ResetLocalDemoPasswordResult>("/auth/development/reset-demo-password", { method: "post", data, retryAuthentication: false }),
      } : undefined,
    },
    useAuthStore,
    runtime,
    getSnapshot: useAuthStore.getState,
    subscribe,
    bootstrap: () => useAuthStore.getState().bootstrap(),
    login: (input: LoginRequest) => useAuthStore.getState().login(input.tenantCode, input.account, input.password),
    changePassword: (input: ChangePasswordRequest) => useAuthStore.getState().changePassword(input.currentPassword, input.newPassword),
    signOut: () => useAuthStore.getState().logout(),
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
