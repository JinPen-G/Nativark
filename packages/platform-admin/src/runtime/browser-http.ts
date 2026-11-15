/** 浏览器 HTTP 单源。保留原刷新锁、取消和代次顺序，凭据存储/会话投影由宿主管理。
 * 401 后只轮换原刷新会话一次；网络或业务错误不重试写入，不推断 unknown 已回滚。 */
import axios, { type InternalAxiosRequestConfig } from "axios";
import type { ApiResult, PlatformLoginResponse, TenantIdentity } from "@rental-os/platform-contracts";
import type { AdminRequestOptions } from "./index";

export interface BrowserSessionPort<T extends PlatformLoginResponse> {
  accessToken: () => string | undefined;
  refreshToken: () => string | undefined;
  tenant: () => Pick<TenantIdentity, "tenantId" | "tenantCode"> | undefined;
  currentSessionEpoch: () => number;
  currentSessionSignal: () => AbortSignal;
  commitRefresh: (session: T) => void;
  expire: () => void;
}

export function createAdminHttpClient<T extends PlatformLoginResponse>({ baseURL, session, refreshLockName }: {
  baseURL: string; session: BrowserSessionPort<T>; refreshLockName: string;
}) {
  const http = axios.create({ baseURL, timeout: 12_000 });
  let refreshPromise: Promise<T | undefined> | undefined;
  function refreshSession(refreshToken: string) {
    if (refreshPromise) return refreshPromise;
    const rotate = async () => {
      // 跨标签锁内复核，已经轮换的旧 token 不再提交第二次刷新。
      if (session.refreshToken() !== refreshToken) return undefined;
      const epoch = session.currentSessionEpoch();
      const response = await axios.post<ApiResult<T>>(`${baseURL}/auth/refresh`, { refreshToken });
      if (session.currentSessionEpoch() !== epoch || session.refreshToken() !== refreshToken) return undefined;
      session.commitRefresh(response.data.data);
      return response.data.data;
    };
    const pending: Promise<T | undefined> = (async () => navigator.locks
      ? await navigator.locks.request(refreshLockName, rotate) : await rotate())();
    refreshPromise = pending.finally(() => { refreshPromise = undefined; });
    return refreshPromise;
  }

  type TrackedRequest = InternalAxiosRequestConfig & { _authRetry?: boolean; _authRefreshToken?: string; _sessionEpoch?: number };
  http.interceptors.request.use(config => {
    const token = session.accessToken(), tenant = session.tenant();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    if (!config.signal) config.signal = session.currentSessionSignal();
    (config as TrackedRequest)._sessionEpoch = session.currentSessionEpoch();
    if (tenant?.tenantId) config.headers["x-tenant-id"] = tenant.tenantId;
    if (tenant?.tenantCode) config.headers["x-tenant-code"] = tenant.tenantCode;
    return config;
  });
  http.interceptors.response.use(response => response, async error => {
    const original = error?.config as TrackedRequest | undefined, callerSignal = original?.signal;
    const stale = () => callerSignal?.aborted || original?._sessionEpoch !== undefined && original._sessionEpoch !== session.currentSessionEpoch();
    if (stale()) return Promise.reject(error);
    const authEndpoint = original?.url?.includes("/auth/login") || original?.url?.includes("/auth/refresh");
    if (error?.response?.status === 401 && original && !original._authRetry && !authEndpoint) {
      const refreshToken = session.refreshToken();
      if (refreshToken) {
        original._authRetry = true; original._authRefreshToken = refreshToken;
        try {
          const refreshed = await refreshSession(refreshToken);
          if (stale()) return Promise.reject(error);
          const accessToken = refreshed?.accessToken ?? session.accessToken();
          if (!accessToken) throw error;
          const signal = callerSignal ? AbortSignal.any([callerSignal as AbortSignal, session.currentSessionSignal()]) : session.currentSessionSignal();
          if (signal.aborted) return Promise.reject(error);
          original.signal = signal; original.headers.Authorization = `Bearer ${accessToken}`;
          return http.request(original);
        } catch {
          // 刷新失败由下方唯一清理点处理，跨标签已轮换者可沿新凭据继续。
        }
      }
    }
    if (stale()) return Promise.reject(error);
    if (error?.response?.status === 401 && (!original?._authRefreshToken || original._authRefreshToken === session.refreshToken())) session.expire();
    return Promise.reject(error);
  });

  async function request<Output>(path: string, options: AdminRequestOptions = {}): Promise<Output> {
    const epoch = session.currentSessionEpoch(), originalSignal = session.currentSessionSignal();
    const signals = options.signal ? [options.signal, originalSignal] : [];
    const controller = options.signal ? new AbortController() : undefined;
    const abort = () => controller?.abort();
    for (const signal of signals) signal.addEventListener("abort", abort, { once: true });
    if (signals.some(signal => signal.aborted)) abort();
    try {
      const response = await http.request<ApiResult<Output>>({ url: path, method: options.method ?? "get", ...options, signal: controller?.signal ?? originalSignal });
      if (originalSignal.aborted || controller?.signal.aborted || session.currentSessionEpoch() !== epoch)
        throw new DOMException("原响应不能写入已变化的会话", "AbortError");
      return response.data.data;
    } finally {
      for (const signal of signals) signal.removeEventListener("abort", abort);
    }
  }
  async function requestText(path: string, params?: unknown) {
    const response = await http.request<string>({ url: path, method: "get", params, responseType: "text",
      transformResponse: [(body: unknown) => String(body ?? "")] });
    return response.data;
  }
  return { http, request, requestText };
}
