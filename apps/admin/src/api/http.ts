import axios from "axios";
import type { ApiResult, LoginResponse } from "@store-rental/shared";
import type { InternalAxiosRequestConfig } from "axios";
import { currentSessionSignal } from "@/app/queryClient";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export const http = axios.create({ baseURL, timeout: 12_000 });

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
    const original = error?.config as (InternalAxiosRequestConfig & { _authRetry?: boolean }) | undefined;
    const isAuthEndpoint = original?.url?.includes("/auth/login") || original?.url?.includes("/auth/refresh");
    if (error?.response?.status === 401 && original && !original._authRetry && !isAuthEndpoint) {
      const refreshToken = window.localStorage.getItem("rental_refresh_token");
      if (refreshToken) {
        original._authRetry = true;
        try {
          const response = await axios.post<ApiResult<LoginResponse>>(`${baseURL}/auth/refresh`, { refreshToken });
          const session = response.data.data;
          window.localStorage.setItem("rental_access_token", session.accessToken);
          window.localStorage.setItem("rental_refresh_token", session.refreshToken);
          window.localStorage.setItem("rental_tenant", JSON.stringify(session.tenant));
          window.localStorage.setItem("rental_user", JSON.stringify(session.user));
          original.headers.Authorization = `Bearer ${session.accessToken}`;
          return http.request(original);
        } catch {
          // The canonical cleanup below handles an expired or revoked refresh token.
        }
      }
    }
    if (error?.response?.status === 401) {
      ["rental_access_token", "rental_refresh_token", "rental_tenant", "rental_user"]
        .forEach((key) => window.localStorage.removeItem(key));
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    return Promise.reject(error);
  }
);

export async function request<T>(path: string, options: { method?: "get" | "post" | "put" | "patch" | "delete"; data?: unknown; params?: unknown } = {}) {
  const response = await http.request<ApiResult<T>>({
    url: path,
    method: options.method ?? "get",
    data: options.data,
    params: options.params
  });
  return response.data.data;
}
