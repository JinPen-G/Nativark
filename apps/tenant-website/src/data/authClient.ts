// 客户端会话与认证：调用 /api/client/v1/auth/* 与需要登录的接口。
// 令牌按租户隔离存储（每个租户官网是独立品牌，会话不跨租户），并在 401 时用 refresh token 自动续期一次。

import { API_BASE } from './apiClient';
import type { AiBookingHandoff, AiBookingSubmissionAcceptance, AiBookingSubmissionDecision, AiBookingSubmissionReceipt,
  AiBookingAcceptanceReadRequest, AiBookingAcceptanceReadResponse }
  from '../../../../packages/shared/src/ai-booking-draft';
import type { AiClientHostCapabilities } from '@rental-os/shared';

const CLIENT_V1 = `${API_BASE}/api/client/v1`;

export interface ClientSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  customer: { id?: string; name?: string; phone?: string; [k: string]: unknown };
  workspaces: WorkspaceRef[];
  workspace?: WorkspaceRef;
  wechatBound?: boolean;
}

export interface WorkspaceRef {
  workspaceCode: string;
  workspaceName: string;
  categoryCode: string;
  membershipStatus?: string;
  isDefault?: boolean;
}

const storeKey = (tenantCode: string) => `rental-os-tenant-session:${tenantCode}`;

export function loadSession(tenantCode: string): ClientSession | null {
  try {
    const raw = window.localStorage.getItem(storeKey(tenantCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClientSession;
    return parsed?.accessToken && parsed?.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(tenantCode: string, session: ClientSession | null): void {
  try {
    if (session) window.localStorage.setItem(storeKey(tenantCode), JSON.stringify(session));
    else window.localStorage.removeItem(storeKey(tenantCode));
  } catch {
    // 隐私模式等场景下 localStorage 不可用；仅内存态失效，不阻断使用。
  }
}

export class AuthError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'AuthError';
  }
}

async function parse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join('；') : (body?.message || `请求失败（${response.status}）`);
    throw new AuthError(response.status, message, body?.code);
  }
  return body?.data ?? body;
}

/** 不带鉴权的 POST（登录/注册/验证码等公开入口）。 */
async function postPublic<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${CLIENT_V1}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  return parse(response) as Promise<T>;
}

export const authApi = {
  /** 发送用途化验证码（登录/注册）；开发环境返回 developmentCode 便于联调。 */
  createChallenge(input: { tenantCode: string; identifier: string; purpose: 'login' | 'registration'; idempotencyKey: string }) {
    return postPublic<{ challengeId: string; developmentCode?: string; maskedDestination: string; retryAfterSeconds?: number }>(
      '/auth/challenges', { ...input, method: 'sms' },
    );
  },
  verifyChallenge(challengeId: string, code: string) {
    return postPublic<{ verificationToken: string }>(`/auth/registration/challenges/${encodeURIComponent(challengeId)}/verify`, { code });
  },
  smsLogin(input: { tenantCode: string; loginIdentifier: string; verificationToken: string }) {
    return postPublic<ClientSession>('/auth/sms-login', input);
  },
  passwordLogin(input: { tenantCode: string; loginIdentifier: string; password: string }) {
    return postPublic<ClientSession>('/auth/login', input);
  },
  register(input: {
    tenantCode: string; name: string; phone: string; password: string; verificationToken: string;
    idempotencyKey: string; consent: { userAgreementVersion: string; privacyPolicyVersion: string; agreedAt: string };
  }) {
    return postPublic<{ result: string; customerId: string; membershipStatus: string }>('/auth/register', input);
  },
  refresh(refreshToken: string) {
    return postPublic<ClientSession>('/auth/refresh', { refreshToken });
  },
  logout(refreshToken: string) {
    return postPublic<unknown>('/auth/logout', { refreshToken }).catch(() => undefined);
  },
};

// ---- 登录态请求层 ----
// AuthContext 注册当前会话读写器；authedFetch 注入 Bearer，401 时用 refreshToken 续期一次并重试，
// 续期失败则清空会话（视为登出）并抛出，由页面引导重新登录。

interface AuthBridge {
  getSession: () => ClientSession | null;
  setSession: (session: ClientSession | null) => void;
}

let bridge: AuthBridge | null = null;

export function captureBookingHostSession() {
  const owner = bridge, session = owner?.getSession();
  const customerId = session?.customer?.customerId, workspaceCode = session?.workspace?.workspaceCode;
  if (!owner || !session?.accessToken || typeof customerId !== 'string' || !customerId
    || session.customer.customerType !== 'personal' || !workspaceCode) return null;
  const token = session.accessToken;
  return { customerId, workspaceCode, current: () => bridge === owner && owner.getSession() === session
    && session.accessToken === token && session.customer.customerId === customerId
    && session.customer.customerType === 'personal' && session.workspace?.workspaceCode === workspaceCode };
}

export function configureAuthBridge(next: AuthBridge | null): void {
  bridge = next;
}

// 单飞刷新：并发 401 只发起一次 refresh，其余复用同一 Promise。
// refresh token 是一次性轮换的，重复用同一个会被服务端判为失效并误登出。
let refreshInFlight: Promise<ClientSession> | null = null;

function ensureRefreshed(refreshToken: string): Promise<ClientSession> {
  if (!refreshInFlight) {
    refreshInFlight = authApi.refresh(refreshToken)
      .then(next => { bridge?.setSession(next); return next; })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function authedFetch(path: string, init: RequestInit, retry = true): Promise<Response> {
  const session = bridge?.getSession() ?? null;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (session?.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`);
  const response = await fetch(`${CLIENT_V1}${path}`, { ...init, headers });
  if (response.status === 401 && retry && session?.refreshToken) {
    try {
      await ensureRefreshed(session.refreshToken);
      return authedFetch(path, init, false);
    } catch {
      bridge?.setSession(null);
    }
  }
  return response;
}

async function authedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return parse(await authedFetch(path, init)) as Promise<T>;
}

/** 需要登录的接口。金额、库存、可用性均以服务端为准；前端不自行拼算最终价。 */
export const sessionApi = {
  async readBookingHostCapabilities(): Promise<AiClientHostCapabilities> {
    return parse(await authedFetch('/ai-native/entry/host-capabilities/read', { method: 'POST', body: '{}' }, false));
  },
  async readBookingHandoff(input: string | { handoffRef: string }): Promise<AiBookingHandoff> {
    const handoffRef = typeof input === 'string' ? input : input.handoffRef;
    return parse(await authedFetch('/ai-native/entry/booking-handoffs/read', { method: 'POST', body: JSON.stringify({ handoffRef }) }, false));
  },
  me() { return authedJson<Record<string, unknown>>('/auth/me'); },
  switchWorkspace(workspaceCode: string) {
    return authedJson<ClientSession>('/auth/switch-workspace', { method: 'POST', body: JSON.stringify({ workspaceCode }) });
  },
  /** 登录态目录：含履约地点、履约模式与型号（用于下单时取 locationId / fulfillmentMode）。 */
  catalog() { return authedJson<Record<string, any>>('/catalog'); },
  availability(payload: unknown) { return authedJson<Record<string, unknown>>('/availability', { method: 'POST', body: JSON.stringify(payload) }); },
  createQuote(payload: unknown) { return authedJson<Record<string, unknown>>('/quotes', { method: 'POST', body: JSON.stringify(payload) }); },
  getQuote(id: string) { return authedJson<Record<string, unknown>>(`/quotes/${encodeURIComponent(id)}`); },
  async readBookingAcceptance(input: AiBookingAcceptanceReadRequest): Promise<AiBookingAcceptanceReadResponse> {
    return parse(await authedFetch('/ai-native/entry/booking-submissions/acceptance/read',
      { method: 'POST', body: JSON.stringify(input) }, false));
  },
  async acceptBookingSubmission(input: { handoffRef: string }): Promise<AiBookingSubmissionAcceptance> {
    return parse(await authedFetch('/ai-native/entry/booking-submissions/accept', { method: 'POST', body: JSON.stringify(input) }, false));
  },
  async submitAcceptedBooking(input: AiBookingSubmissionDecision): Promise<AiBookingSubmissionReceipt> {
    // Late authorization failures do not prove the original business call was absent.
    return parse(await authedFetch('/ai-native/entry/booking-submissions/submit',
      { method: 'POST', body: JSON.stringify(input) }, false)) as Promise<AiBookingSubmissionReceipt>;
  },
  readBookingSubmission(input: { acceptanceRef: string }) {
    return authedJson<AiBookingSubmissionReceipt>('/ai-native/entry/booking-submissions/read', { method: 'POST', body: JSON.stringify(input) });
  },
  createOrder(payload: unknown, idempotencyKey: string) {
    return authedJson<Record<string, unknown>>('/orders', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(payload) });
  },
  myOrders(params: { page?: number; pageSize?: number } = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
    return authedJson<{ items: any[]; page: number; pageSize: number; total: number }>(`/my/orders${q ? `?${q}` : ''}`);
  },
  order(id: string) { return authedJson<Record<string, any>>(`/orders/${encodeURIComponent(id)}`); },
  paymentCapabilities() { return authedJson<{ methods?: string[]; [k: string]: unknown }>('/payment/capabilities'); },
  addresses() { return authedJson<Record<string, unknown>>('/profile/addresses'); },
  saveAddress(payload: unknown) { return authedJson<Record<string, unknown>>('/profile/addresses', { method: 'PUT', body: JSON.stringify(payload) }); },
  deleteAddress(id: string) { return authedJson<unknown>(`/profile/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  coupons() { return authedJson<Record<string, unknown>>('/coupons'); },
  notifications(params: { page?: number; pageSize?: number } = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
    return authedJson<Record<string, unknown>>(`/notifications${q ? `?${q}` : ''}`);
  },
  createPaymentIntent(orderId: string, payload: Record<string, unknown>, idempotencyKey: string) {
    // idempotencyKey 是请求体必填字段（后端 DTO 从 body 读取）；同时带同名请求头，双保险。
    return authedJson<Record<string, any>>(`/orders/${encodeURIComponent(orderId)}/payment-intents`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ ...payload, idempotencyKey }) });
  },
};
