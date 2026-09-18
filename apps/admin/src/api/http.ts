/**
 * 统一 axios 实例与 `request<T>()`：挂鉴权头 / 租户头 / 会话中止信号，401 时轮换令牌并重试，
 * 并把 `{ data, requestId }` 信封解开只返回业务数据。所有 api 文件都应经由这里发请求。
 */
import axios from "axios";
import type { ApiResult, LoginResponse } from "@rental-os/shared";
import type { InternalAxiosRequestConfig } from "axios";
import { clearSessionQueryCache, currentSessionSignal } from "@/app/queryClient";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export const http = axios.create({ baseURL, timeout: 12_000 });

let refreshPromise: Promise<LoginResponse | undefined> | undefined;

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
  window.dispatchEvent(new CustomEvent("rental-session-updated"));
}

function refreshSession(refreshToken: string): Promise<LoginResponse | undefined> {
  if (!refreshPromise) {
    const rotate = async () => {
      // 等到跨标签锁后再次检查：若 token 已变化，说明另一个标签已经完成轮换，
      // 本页直接采用其会话，不再用已撤销的旧 token 发第二次请求。
      if (window.localStorage.getItem("rental_refresh_token") !== refreshToken) return undefined;
      const response = await axios.post<ApiResult<LoginResponse>>(`${baseURL}/auth/refresh`, { refreshToken });
      const session = response.data.data;
      // 写 storage 必须在锁内完成；否则锁一释放，下一标签仍可能读到旧 token。
      storeRefreshedSession(session);
      return session;
    };
    const locks = navigator.locks;
    // 用 async 包一层让类型收敛：`LockManager.request` 的 DOM 类型不会解开回调返回的
    // Promise，直接赋值得到的是 `Promise<Promise<T>>`；await 一次即折叠为 T。
    const pending: Promise<LoginResponse | undefined> = (async () =>
      locks ? await locks.request("rental-auth-refresh", rotate) : await rotate())();
    // 先存局部再赋值：`.finally` 的回调会把 refreshPromise 置回 undefined，
    // 直接 `return refreshPromise` 会被 TS 判为可能 undefined。
    refreshPromise = pending.finally(() => {
      refreshPromise = undefined;
    });
    return refreshPromise;
  }
  return refreshPromise;
}

http.interceptors.request.use((config) => {
  const token = window.localStorage.getItem("rental_access_token");
  const tenantRaw = window.localStorage.getItem("rental_tenant");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // SPACE-05：给每个请求挂上当前会话的中止信号。
  //
  // 切换经营空间时会中止上一代信号，于是那一刻仍在飞行中的请求当场失败，
  // 不会在新空间落地。只靠 queryClient.cancelQueries() 不够——它管不到
  // 直接走 axios 的调用（表单提交、命令式拉取）。
  //
  // 调用方已显式传 signal 时不覆盖：那是更精细的控制，不该被这里夺走。
  if (!config.signal) config.signal = currentSessionSignal();
  if (tenantRaw) {
    try {
      const tenant = JSON.parse(tenantRaw) as { tenantId?: string; tenantCode?: string };
      if (tenant.tenantId) config.headers["x-tenant-id"] = tenant.tenantId;
      if (tenant.tenantCode) config.headers["x-tenant-code"] = tenant.tenantCode;
    } catch {
      window.localStorage.removeItem("rental_tenant");
    }
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error?.config as (InternalAxiosRequestConfig & { _authRetry?: boolean; _authRefreshToken?: string }) | undefined;
    const isAuthEndpoint = original?.url?.includes("/auth/login") || original?.url?.includes("/auth/refresh");
    if (error?.response?.status === 401 && original && !original._authRetry && !isAuthEndpoint) {
      const refreshToken = window.localStorage.getItem("rental_refresh_token");
      if (refreshToken) {
        original._authRetry = true;
        original._authRefreshToken = refreshToken;
        try {
          const session = await refreshSession(refreshToken);
          const accessToken = session?.accessToken ?? window.localStorage.getItem("rental_access_token");
          if (!accessToken) throw error;
          // 会话可能由本页或另一个标签更新；重试一律挂当前代 signal。
          original.signal = currentSessionSignal();
          original.headers.Authorization = `Bearer ${accessToken}`;
          return http.request(original);
        } catch {
          // 真正的刷新失败交给下面的 canonical cleanup；跨标签落败不会进入这里，
          // 因为它会在锁内观察到已轮换 token 并直接采用。
        }
      }
    }
    if (error?.response?.status === 401) {
      // 仅当失败时使用的 refresh token 仍是当前 token 才能清理。另一个标签页
      // 可能已先完成轮换并写入新会话，盲删会把成功标签页一起登出。
      const failedRefreshToken = original?._authRefreshToken;
      if (!failedRefreshToken || failedRefreshToken === window.localStorage.getItem("rental_refresh_token")) {
        ["rental_access_token", "rental_refresh_token", "rental_tenant", "rental_user", "rental_workspaces", "rental_current_workspace"]
        .forEach((key) => window.localStorage.removeItem(key));
        if (window.location.pathname !== "/login") window.location.assign("/login");
      }
    }
    return Promise.reject(error);
  }
);

export async function request<T>(path: string, options: { method?: "get" | "post" | "put" | "patch" | "delete"; data?: unknown; params?: unknown; headers?: Record<string, string> } = {}) {
  const response = await http.request<ApiResult<T>>({
    url: path,
    method: options.method ?? "get",
    data: options.data,
    params: options.params,
    headers: options.headers
  });
  return response.data.data;
}

/**
 * REPORT-01B：取原始文本响应（CSV 导出）。
 *
 * 与 `request()` 分开而不是加一个 flag：`request()` 的契约是「返回 `{ data }`
 * 信封里的业务对象」，而导出返回的就是文件正文本身。混在一个函数里会让
 * 返回类型变成 `T | string`，每个调用点都要再判一次。
 *
 * 走同一个 `http` 实例，因此鉴权头、令牌刷新与错误处理与其他接口完全一致。
 */
export async function requestText(path: string, params?: unknown) {
  const response = await http.request<string>({
    url: path,
    method: "get",
    params,
    responseType: "text",
    // 拦截器默认按 JSON 解析；导出必须原样拿到文本，否则 CSV 会被解析坏。
    transformResponse: [(body: unknown) => String(body ?? "")]
  });
  return response.data;
}
