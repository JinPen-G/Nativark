// 客户端会话与认证：调用 /api/client/v1/auth/* 与需要登录的接口。
// 令牌按租户隔离存储（每个租户官网是独立品牌，会话不跨租户），并在 401 时用 refresh token 自动续期一次。

import { API_BASE } from './apiClient';
import type { AiBookingHandoff, AiBookingSubmissionAcceptance, AiBookingSubmissionDecision, AiBookingSubmissionReceipt,
  AiBookingAcceptanceReadRequest, AiBookingAcceptanceReadResponse }
  from '../../../../packages/shared/src/ai-booking-draft';
import type { AiClientHostCapabilities, EnterpriseOwnRentalPolicy, EnterpriseBookingApprovalView, EnterpriseApprovalOriginalResult, EnterpriseOrderOriginalResult } from '@rental-os/shared';

const CLIENT_V1 = `${API_BASE}/api/client/v1`;

import { customerFetch, customerLogin, customerSessionGeneration, loadCustomerSession, logoutCustomerSession, switchCustomerWorkspace, subscribeCustomerSession, ClientTransportError } from '@rental-os/web-client';
import type { ClientMembershipSessionResponse, EnterpriseExtensionEligibility, EnterpriseExtensionApprovalView, EnterpriseExtensionOriginalResult } from '@rental-os/shared';
export type ClientSession = ClientMembershipSessionResponse;

export interface WorkspaceRef {
  workspaceCode: string;
  workspaceName: string;
  categoryCode: string;
  membershipStatus?: string;
  isDefault?: boolean;
}

export const loadSession = loadCustomerSession;
export { subscribeCustomerSession };

export { ClientTransportError as AuthError };

async function parse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join('；') : (body?.message || `请求失败（${response.status}）`);
    throw new ClientTransportError(response.status, message, body?.code);
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
    return customerLogin(input.tenantCode, CLIENT_V1, '/auth/sms-login', input);
  },
  passwordLogin(input: { tenantCode: string; loginIdentifier: string; password: string }) {
    return customerLogin(input.tenantCode, CLIENT_V1, '/auth/login', input);
  },
  register(input: {
    tenantCode: string; name: string; phone: string; password: string; verificationToken: string;
    idempotencyKey: string; consent: { userAgreementVersion: string; privacyPolicyVersion: string; agreedAt: string };
  }) {
    return postPublic<{ result: string; customerId: string; membershipStatus: string }>('/auth/register', input);
  },
  logout(tenantCode: string) {
    return logoutCustomerSession(tenantCode, CLIENT_V1);
  },
};

// ---- 登录态请求层 ----
// AuthContext 订阅共用会话；安全 GET 可续期一次，业务写入不自动重发。
// 刷新失应答保留原派发标记，不把未知结果推断为登出或未执行。

interface AuthBridge {
  tenantCode: string;
  getSession: () => ClientSession | null;
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

/** Enterprise commands survive token refresh, but never account/workspace generation changes. */
export function captureEnterpriseHostSession() {
  const owner = bridge, session = owner?.getSession();
  if (!owner || !session?.accessToken || session.customer.customerType !== 'personal' || !session.workspace?.workspaceCode) return null;
  const generation = customerSessionGeneration(owner.tenantCode), customerId = session.customer.customerId, workspaceCode = session.workspace.workspaceCode;
  if (generation === 'unavailable') return null;
  return { tenantCode: owner.tenantCode, customerId, workspaceCode, generation,
    identity: JSON.stringify([owner.tenantCode, generation, customerId, workspaceCode]),
    operationScope: JSON.stringify([owner.tenantCode, customerId, workspaceCode]),
    current: () => {
      const latest = loadSession(owner.tenantCode);
      return bridge === owner && customerSessionGeneration(owner.tenantCode) === generation
        && Boolean(latest?.accessToken) && latest?.customer.customerType === 'personal'
        && latest.customer.customerId === customerId && latest.workspace?.workspaceCode === workspaceCode;
    } };
}

export function configureAuthBridge(next: AuthBridge | null): void {
  bridge = next;
}

async function authedFetch(path: string, init: RequestInit, retry = true): Promise<Response> {
  const owner = bridge;
  if (!owner?.tenantCode) throw new ClientTransportError(401, '请先登录当前商户');
  const response = await customerFetch(owner.tenantCode, CLIENT_V1, path, init, retry && (init.method ?? 'GET').toUpperCase() === 'GET');
  if (bridge !== owner) throw new ClientTransportError(401, '客户会话已变化');
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
    const owner = bridge;
    if (!owner?.tenantCode) throw new ClientTransportError(401, '请先登录当前商户');
    return switchCustomerWorkspace(owner.tenantCode, CLIENT_V1, workspaceCode);
  },
  /** 登录态目录：含履约地点、履约模式与型号（用于下单时取 locationId / fulfillmentMode）。 */
  catalog() { return authedJson<Record<string, any>>('/catalog'); },
  availability(payload: unknown) { return authedJson<Record<string, unknown>>('/availability', { method: 'POST', body: JSON.stringify(payload) }); },
  enterpriseRentalPolicies() { return authedJson<EnterpriseOwnRentalPolicy[]>('/enterprise/my-rental-policies'); },
  enterpriseApprovals() { return authedJson<EnterpriseBookingApprovalView[]>('/enterprise/my-approvals'); },
  enterpriseCommand<T>(path: string, payload: unknown) { return authedJson<T>(`/enterprise/${path}`, { method: 'POST', body: JSON.stringify(payload) }); },
  enterpriseOperation(key: string) { return authedJson<{ state: string; result?: Record<string, unknown> }>(`/enterprise/operations/${encodeURIComponent(key)}`); },
  enterpriseExtensionEligibility(orderId: string) { return authedJson<EnterpriseExtensionEligibility>(`/enterprise/orders/${encodeURIComponent(orderId)}/extension-eligibility`); },
  enterpriseExtensionApprovals() { return authedJson<EnterpriseExtensionApprovalView[]>('/enterprise/my-extension-approvals'); },
  enterpriseExtensionResult(id: string) { return authedJson<EnterpriseExtensionOriginalResult>(`/enterprise/extension-approvals/${encodeURIComponent(id)}/result`); },
  enterpriseApprovalResult(id: string) { return authedJson<EnterpriseApprovalOriginalResult>(`/enterprise/approvals/${encodeURIComponent(id)}/result`); },
  enterpriseOrderOriginal(quoteId: string, key: string) { return authedJson<EnterpriseOrderOriginalResult>(`/enterprise/quotes/${encodeURIComponent(quoteId)}/order-operations/${encodeURIComponent(key)}`); },
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
