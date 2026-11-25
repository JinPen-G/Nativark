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
  let refreshingToken: string | undefined;
  function refreshSession(refreshToken: string) {
    if (refreshPromise) return refreshPromise;
    const rotate = async () => {
      // 跨标签锁内复核，已经轮换的旧 token 不再提交第二次刷新。
      if (session.refreshToken() !== refreshToken) return undefined;
      const epoch = session.currentSessionEpoch();
      const response = await axios.post<ApiResult<T>>(`${baseURL}/auth/refresh`, { refreshToken }, { timeout: 12_000 });
      if (session.currentSessionEpoch() !== epoch || session.refreshToken() !== refreshToken) {
        // 服务端已经轮换，迟到凭据不能交给新身份，也不能作为有效孤儿会话遗留。
        await revokeCredential(response.data.data.refreshToken);
        return undefined;
      }
      session.commitRefresh(response.data.data);
      return response.data.data;
    };
    const pending: Promise<T | undefined> = (async () => navigator.locks
      ? await navigator.locks.request(refreshLockName, rotate) : await rotate())();
    refreshingToken = refreshToken;
    refreshPromise = pending.finally(() => { refreshPromise = undefined; refreshingToken = undefined; });
    return refreshPromise;
  }

  type TrackedRequest = InternalAxiosRequestConfig & {
    _authRetry?: boolean; _sessionEpoch?: number; _sessionAccessToken?: string; _sessionRefreshToken?: string;
  };
  http.interceptors.request.use(config => {
    const token = session.accessToken(), tenant = session.tenant();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    if (!config.signal) config.signal = session.currentSessionSignal();
    const tracked = config as TrackedRequest;
    tracked._sessionEpoch = session.currentSessionEpoch();
    tracked._sessionAccessToken = token; tracked._sessionRefreshToken = session.refreshToken();
    if (tenant?.tenantId) config.headers["x-tenant-id"] = tenant.tenantId;
    if (tenant?.tenantCode) config.headers["x-tenant-code"] = tenant.tenantCode;
    return config;
  });
  http.interceptors.response.use(response => response, async error => {
    const original = error?.config as TrackedRequest | undefined, callerSignal = original?.signal;
    const stale = () => callerSignal?.aborted || original?._sessionEpoch !== undefined && original._sessionEpoch !== session.currentSessionEpoch();
    const credentialsChanged = () => original?._sessionAccessToken !== session.accessToken()
      || original?._sessionRefreshToken !== session.refreshToken();
    if (stale()) return Promise.reject(error);
    const authEndpoint = original?.url?.includes("/auth/login") || original?.url?.includes("/auth/refresh");
    if (error?.response?.status === 401 && original && !original._authRetry && !authEndpoint) {
      const retry = (accessToken: string) => {
        const signal = callerSignal ? AbortSignal.any([callerSignal as AbortSignal, session.currentSessionSignal()]) : session.currentSessionSignal();
        if (signal.aborted) return Promise.reject(error);
        original.signal = signal; original.headers.Authorization = `Bearer ${accessToken}`;
        return http.request(original);
      };
      original._authRetry = true;
      // 同一主体已刷新时，迟到的旧401只用当前凭据重读一次，不再次轮换或退出新会话。
      if (credentialsChanged()) {
        const accessToken = session.accessToken();
        return accessToken ? retry(accessToken) : Promise.reject(error);
      }
      const refreshToken = original._sessionRefreshToken;
      if (refreshToken) {
        try {
          const refreshed = await refreshSession(refreshToken);
          if (stale()) return Promise.reject(error);
          const accessToken = refreshed?.accessToken ?? session.accessToken();
          if (!accessToken) throw error;
          return retry(accessToken);
        } catch {
          // 刷新失败由下方唯一清理点处理，跨标签已轮换者可沿新凭据继续。
        }
      }
    }
    if (stale()) return Promise.reject(error);
    if (error?.response?.status === 401 && original && !credentialsChanged()) session.expire();
    return Promise.reject(error);
  });

  async function request<Output>(path: string, options: AdminRequestOptions = {}): Promise<Output> {
    const { retryAuthentication, ...requestOptions } = options;
    const epoch = session.currentSessionEpoch(), originalSignal = session.currentSessionSignal();
    const signals = options.signal ? [options.signal, originalSignal] : [];
    const controller = options.signal ? new AbortController() : undefined;
    const abort = () => controller?.abort();
    for (const signal of signals) signal.addEventListener("abort", abort, { once: true });
    if (signals.some(signal => signal.aborted)) abort();
    try {
      const response = await http.request<ApiResult<Output>>({ url: path, method: requestOptions.method ?? "get", ...requestOptions,
        ...(retryAuthentication === false ? { _authRetry: true } : {}), signal: controller?.signal ?? originalSignal });
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
  /** 撤销只提交原刷新凭证，独立于本地退出时立即中止的业务请求。 */
  async function revokeCredential(refreshToken: string): Promise<{ loggedOut: boolean }> {
    const response = await axios.post<ApiResult<{ loggedOut: boolean }>>(
      `${baseURL}/auth/logout`, { refreshToken }, { timeout: 12_000 });
    return response.data.data;
  }
  async function revokeSession(refreshToken: string): Promise<{ loggedOut: boolean }> {
    const pending = refreshingToken === refreshToken ? refreshPromise : undefined;
    let refreshFailure: unknown, refreshFailed = false;
    // 先等已发出的原刷新完成，再取同一跨标签锁；不能持锁等待正在取锁的刷新。
    try { await pending; } catch (error) { refreshFailed = true; refreshFailure = error; }
    const revoke = () => revokeCredential(refreshToken);
    const result = navigator.locks ? await navigator.locks.request(refreshLockName, revoke) : await revoke();
    // 刷新失应答不能证明不存在后继会话，保留失败而非宣告服务端撤销完整成功。
    if (refreshFailed) throw refreshFailure;
    return result;
  }
  return { http, request, requestText, revokeSession };
}
