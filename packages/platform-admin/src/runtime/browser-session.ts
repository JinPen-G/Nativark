/** 无行业浏览器会话。只有原登录/刷新/上下文响应验证主体；本地 storage 变化立即失效并重读。
 * 缓存围栏先于主体切换，不把取消当业务回滚。宿主销毁必须释放 storage 监听。 */
import axios from "axios";
import type { ChangePasswordRequest, LoginRequest, PlatformLoginResponse, PlatformSessionContextResponse } from "@rental-os/platform-contracts";
import type { AdminRuntime, AdminSessionSnapshot } from "./index";
import { createAdminHttpClient } from "./browser-http";
import { createAdminSessionQueries } from "./session-queries";

interface BrowserSessionSnapshot extends AdminSessionSnapshot {
  ready: boolean;
  verificationError?: unknown;
}

export function createBrowserAdminSession({ baseURL, storageKey }: { baseURL: string; storageKey: string }) {
  const accessKey = `${storageKey}:access`, refreshKey = `${storageKey}:refresh`;
  let state: BrowserSessionSnapshot = { ready: false, sessionVerified: false };
  const listeners = new Set<() => void>();
  const queries = createAdminSessionQueries(() => Boolean(localStorage.getItem(accessKey)));
  let verification: Promise<void> | undefined;
  const emit = (next: BrowserSessionSnapshot) => { state = next; for (const listener of listeners) listener(); };
  const token = () => localStorage.getItem(accessKey) ?? undefined;
  const refreshToken = () => localStorage.getItem(refreshKey) ?? undefined;
  function clear() {
    queries.clearSessionQueryCache();
    localStorage.removeItem(accessKey); localStorage.removeItem(refreshKey);
    emit({ ready: true, sessionVerified: false });
  }
  function authority(context: PlatformSessionContextResponse | BrowserSessionSnapshot) {
    const user = context.user;
    return JSON.stringify([context.tenant?.tenantId, user?.id, user?.scope, user?.roleIds, user?.permissions,
      user?.isPlatformAdmin, user?.isSaasAdmin, user?.dataScope, user?.locationScope, user?.organizationId,
      user?.tenantMembership, user?.mustChangePassword]);
  }
  function accept(context: PlatformSessionContextResponse, receipt?: PlatformLoginResponse) {
    if (authority(state) !== authority(context)) queries.clearSessionQueryCache();
    if (receipt) { localStorage.setItem(accessKey, receipt.accessToken); localStorage.setItem(refreshKey, receipt.refreshToken); }
    emit({ ready: true, sessionVerified: true, tenant: context.tenant, user: context.user });
  }
  const transport = createAdminHttpClient<PlatformLoginResponse>({ baseURL, refreshLockName: `${storageKey}:refresh`, session: {
    accessToken: token, refreshToken, tenant: () => state.sessionVerified ? state.tenant : undefined,
    currentSessionEpoch: queries.currentSessionEpoch, currentSessionSignal: queries.currentSessionSignal,
    commitRefresh: receipt => accept(receipt, receipt), expire: clear
  } });
  const runtime: AdminRuntime = {
    getSession: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    currentSessionEpoch: queries.currentSessionEpoch, currentSessionSignal: queries.currentSessionSignal,
    request: transport.request
  };
  function bootstrap() {
    if (verification) return verification;
    if (!token()) { emit({ ready: true, sessionVerified: false }); return Promise.resolve(); }
    const epoch = queries.currentSessionEpoch(), original = token();
    const pending = (async () => {
      try {
        const context = await transport.request<PlatformSessionContextResponse>("/auth/session-context");
        if (epoch !== queries.currentSessionEpoch() || original !== token()) return;
        accept(context);
      } catch (error) {
        if (epoch !== queries.currentSessionEpoch() || original !== token()) return;
        emit({ ready: true, sessionVerified: false, verificationError: error });
      }
    })();
    const attempt = pending.finally(() => { if (verification === attempt) verification = undefined; });
    verification = attempt;
    return attempt;
  }
  async function login(input: LoginRequest) {
    const epoch = queries.currentSessionEpoch();
    const result = await transport.request<PlatformLoginResponse>("/auth/login", { method: "post", data: input });
    if (epoch !== queries.currentSessionEpoch()) throw new DOMException("会话已变化，请重新登录", "AbortError");
    queries.clearSessionQueryCache(); accept(result, result);
    return result;
  }
  async function changePassword(input: ChangePasswordRequest) {
    const epoch = queries.currentSessionEpoch();
    const result = await transport.request<PlatformLoginResponse>("/auth/change-password", { method: "post", data: input });
    if (epoch !== queries.currentSessionEpoch()) throw new DOMException("会话已变化，请核对原密码操作结果", "AbortError");
    queries.clearSessionQueryCache(); accept(result, result);
  }
  async function signOut() {
    const original = refreshToken();
    // 撤销使用原刷新凭证和独立请求，不被本地退出清缓存当场取消。
    const pending = original ? axios.post(`${baseURL}/auth/logout`, { refreshToken: original }, { timeout: 12_000 }) : Promise.resolve();
    clear(); await pending;
  }
  function stored(event: StorageEvent) {
    if (event.key !== null && event.key !== accessKey && event.key !== refreshKey) return;
    queries.clearSessionQueryCache(); verification = undefined;
    emit({ ready: false, sessionVerified: false });
    void bootstrap();
  }
  window.addEventListener("storage", stored);
  return { apiBaseURL: baseURL, runtime, ...queries, getSnapshot: () => state, subscribe: runtime.subscribe,
    bootstrap, login, changePassword, signOut,
    dispose() { window.removeEventListener("storage", stored); queries.clearSessionQueryCache(); listeners.clear(); } };
}
