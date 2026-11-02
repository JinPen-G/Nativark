/** Same-origin personal customer session owner shared by both Web applications.
 * Cross-realm refresh is locked; uncertain outcomes are never retried blindly. */
import type { ClientMembershipLoginRequest, ClientMembershipSessionResponse, ClientSmsLoginRequest } from "@rental-os/shared";
export type ClientSession = ClientMembershipSessionResponse;
export class ClientTransportError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); this.name = "ClientTransportError"; }
}
export const customerSessionKey = (tenantCode: string) => `rental-os-tenant-session:${tenantCode}`;
const markerKey = (tenantCode: string) => `${customerSessionKey(tenantCode)}:generation`;
const refreshKey = (tenantCode: string) => `${customerSessionKey(tenantCode)}:refresh-pending`;
const listeners = new Map<string, Set<() => void>>();
let subscribed = false;
function notify(tenantCode: string) { listeners.get(tenantCode)?.forEach(fn => fn()); }
function watchStorage() {
  if (subscribed) return;
  subscribed = true;
  window.addEventListener("storage", event => {
    for (const tenantCode of listeners.keys()) if ([customerSessionKey(tenantCode), markerKey(tenantCode), refreshKey(tenantCode)].includes(event.key ?? "")) notify(tenantCode);
  });
}
export function subscribeCustomerSession(tenantCode: string, notifyChange: () => void) {
  watchStorage();
  const set = listeners.get(tenantCode) ?? new Set(); set.add(notifyChange); listeners.set(tenantCode, set);
  return () => { set.delete(notifyChange); if (!set.size) listeners.delete(tenantCode); };
}
export function loadCustomerSession(tenantCode: string): ClientSession | null {
  try {
    const raw = localStorage.getItem(customerSessionKey(tenantCode));
    const value = raw ? JSON.parse(raw) : null;
    if (typeof value?.accessToken !== "string" || typeof value?.refreshToken !== "string" || !value.accessToken || !value.refreshToken
      || typeof value.customer?.customerId !== "string" || typeof value.customer?.displayName !== "string" || !Array.isArray(value.workspaces)) return null;
    return value;
  } catch { return null; }
}
export function customerSessionGeneration(tenantCode: string) {
  try { return localStorage.getItem(markerKey(tenantCode)) ?? "legacy"; } catch { return "unavailable"; }
}
function writeSession(tenantCode: string, session: ClientSession | null) {
  const generation = crypto.randomUUID();
  localStorage.setItem(markerKey(tenantCode), generation);
  if (session) localStorage.setItem(customerSessionKey(tenantCode), JSON.stringify(session));
  else localStorage.removeItem(customerSessionKey(tenantCode));
  localStorage.removeItem(refreshKey(tenantCode));
  notify(tenantCode);
}
async function sessionLock<T>(tenantCode: string, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return Promise.reject(new ClientTransportError(401, "当前浏览器无法安全衔接会话，请重新登录", "refresh_coordination_unavailable"));
  // Storage is shared by tenant, so every writer uses one lock independent of
  // relative/absolute API URL spelling. Login, logout and refresh all participate.
  return await navigator.locks.request(`rental-os:client-session:${tenantCode}`, action);
}
function normalizedApiBase(apiBase: string) {
  const url = new URL(apiBase, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.replace(/\/$/, "") !== "/api/client/v1" || url.search || url.hash) {
    throw new ClientTransportError(401, "客户会话只可用于本站已登记接口");
  }
  return url.pathname.replace(/\/$/, "");
}
function validSession(value: ClientSession) {
  return typeof value?.accessToken === "string" && Boolean(value.accessToken)
    && typeof value.refreshToken === "string" && Boolean(value.refreshToken)
    && typeof value.customer?.customerId === "string" && Boolean(value.customer.customerId)
    && typeof value.customer.displayName === "string" && Array.isArray(value.workspaces);
}
export function customerLogin(tenantCode: string, apiBase: string, path: "/auth/login", body: ClientMembershipLoginRequest): Promise<ClientSession>;
export function customerLogin(tenantCode: string, apiBase: string, path: "/auth/sms-login", body: ClientSmsLoginRequest): Promise<ClientSession>;
export function customerLogin(tenantCode: string, apiBase: string, path: "/auth/login" | "/auth/sms-login", body: ClientMembershipLoginRequest | ClientSmsLoginRequest) {
  const base = normalizedApiBase(apiBase);
  if (body.tenantCode !== tenantCode) return Promise.reject(new ClientTransportError(401, "登录商户与当前入口不一致"));
  return sessionLock(tenantCode, async () => {
    const next = await customerPublicPost<ClientSession>(base, path, body);
    if (!validSession(next)) throw new ClientTransportError(401, "客户登录响应无效");
    writeSession(tenantCode, next);
    return next;
  });
}
export function switchCustomerWorkspace(tenantCode: string, apiBase: string, workspaceCode: string) {
  const base = normalizedApiBase(apiBase), generation = customerSessionGeneration(tenantCode);
  return sessionLock(tenantCode, async () => {
    const current = loadCustomerSession(tenantCode);
    if (!current || customerSessionGeneration(tenantCode) !== generation || localStorage.getItem(refreshKey(tenantCode))) {
      throw new ClientTransportError(401, "客户会话已变化或刷新结果待核对");
    }
    const response = await fetch(`${base}/auth/switch-workspace`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${current.accessToken}` }, body: JSON.stringify({ workspaceCode }) });
    const next = await parseCustomerResponse<ClientSession>(response);
    if (!validSession(next) || next.customer.customerId !== current.customer.customerId || next.workspace?.workspaceCode !== workspaceCode) {
      throw new ClientTransportError(401, "切换空间响应无效");
    }
    writeSession(tenantCode, next);
    return next;
  });
}
export function logoutCustomerSession(tenantCode: string, apiBase: string) {
  const base = normalizedApiBase(apiBase), generation = customerSessionGeneration(tenantCode);
  return sessionLock(tenantCode, async () => {
    if (customerSessionGeneration(tenantCode) !== generation) throw new ClientTransportError(401, "客户身份已变化，请核对当前账号后退出");
    // Read after any pending refresh committed: R0 logout cannot revoke its R1 successor.
    const session = loadCustomerSession(tenantCode);
    const unresolved = Boolean(localStorage.getItem(refreshKey(tenantCode)));
    let confirmed = !session;
    try {
      if (session) await customerPublicPost(base, "/auth/logout", { refreshToken: session.refreshToken });
      confirmed = true;
    } catch { /* Local logout is still applied; no server revocation is inferred. */ }
    writeSession(tenantCode, null);
    if (!confirmed || unresolved) {
      localStorage.setItem(refreshKey(tenantCode), "logout_unknown");
      throw new ClientTransportError(401, "本机已退出，服务端会话撤销结果仍需核对", "logout_unknown");
    }
  });
}
function sameOwner(tenantCode: string, generation: string, session: ClientSession) {
  const current = loadCustomerSession(tenantCode);
  return customerSessionGeneration(tenantCode) === generation && current?.refreshToken === session.refreshToken && current.customer.customerId === session.customer.customerId;
}
export async function refreshCustomerSession(tenantCode: string, apiBase: string, original: ClientSession, expectedGeneration = customerSessionGeneration(tenantCode)) {
  const base = normalizedApiBase(apiBase), generation = expectedGeneration;
  return sessionLock(tenantCode, async () => {
    const current = loadCustomerSession(tenantCode);
    if (!current || customerSessionGeneration(tenantCode) !== generation) throw new ClientTransportError(401, "客户会话已退出或变化");
    if (current.refreshToken !== original.refreshToken) {
      if (current.customer.customerId !== original.customer.customerId || current.workspace?.workspaceCode !== original.workspace?.workspaceCode) {
        throw new ClientTransportError(401, "客户身份或服务空间已变化");
      }
      return current;
    }
    if (!sameOwner(tenantCode, generation, original)) throw new ClientTransportError(401, "客户会话已变化");
    if (localStorage.getItem(refreshKey(tenantCode))) throw new ClientTransportError(401, "会话刷新结果待核对，请重新登录", "refresh_unknown");
    // A durable dispatch marker survives tab closure. There is no TTL/retry inference.
    localStorage.setItem(refreshKey(tenantCode), generation);
    let response: Response;
    try { response = await fetch(`${base}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ refreshToken: original.refreshToken }) }); }
    catch { throw new ClientTransportError(401, "会话刷新结果待核对，请重新登录", "refresh_unknown"); }
    if (!sameOwner(tenantCode, generation, original)) throw new ClientTransportError(401, "客户会话已变化");
    if (response.status >= 500 || response.status === 408) throw new ClientTransportError(401, "会话刷新结果待核对，请重新登录", "refresh_unknown");
    const next = await parseCustomerResponse<ClientSession>(response);
    if (!validSession(next) || !sameOwner(tenantCode, generation, original) || next.customer?.customerId !== original.customer.customerId || next.workspace?.workspaceCode !== original.workspace?.workspaceCode) {
      throw new ClientTransportError(401, "客户会话已变化");
    }
    // Refresh retains the owner generation; login/logout always replace it.
    localStorage.setItem(customerSessionKey(tenantCode), JSON.stringify(next));
    localStorage.removeItem(refreshKey(tenantCode));
    notify(tenantCode);
    return next;
  });
}

export async function customerFetch(tenantCode: string, apiBase: string, path: string, init: RequestInit = {}, allowReadRetry = (init.method ?? "GET").toUpperCase() === "GET") {
  const base = normalizedApiBase(apiBase);
  const original = loadCustomerSession(tenantCode);
  const generation = customerSessionGeneration(tenantCode);
  const request = (session: ClientSession | null) => {
    const headers = new Headers(init.headers); headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (session) headers.set("Authorization", `Bearer ${session.accessToken}`);
    return fetch(`${base}${path}`, { ...init, headers });
  };
  let response = await request(original);
  const current = loadCustomerSession(tenantCode);
  if (original && (customerSessionGeneration(tenantCode) !== generation || current?.customer.customerId !== original.customer.customerId || current.workspace?.workspaceCode !== original.workspace?.workspaceCode)) {
    throw new ClientTransportError(401, "客户会话已变化");
  }
  if (response.status === 401 && allowReadRetry && original) {
    const next = await refreshCustomerSession(tenantCode, apiBase, original, generation);
    const refreshedGeneration = customerSessionGeneration(tenantCode);
    response = await request(next);
    if (!sameOwner(tenantCode, refreshedGeneration, next)) throw new ClientTransportError(401, "客户会话已变化");
  }
  return response;
}

export async function parseCustomerResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ClientTransportError(response.status, Array.isArray(body.message) ? body.message.join("；") : body.message || `请求失败（${response.status}）`, body.code);
  return body?.data ?? body;
}
export async function customerPublicPost<T>(apiBase: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return parseCustomerResponse(await fetch(`${apiBase}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal }));
}
