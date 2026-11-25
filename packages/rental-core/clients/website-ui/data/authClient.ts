import {
  customerFetch,
  getRentalWebsiteHost,
  customerSessionGeneration,
  loadCustomerSession,
  logoutCustomerSession,
  switchCustomerWorkspace,
  subscribeCustomerSession,
  websiteFetch as fetch,
  websiteStorage,
} from "../host";
// 客户端会话与认证：调用 /api/client/v1/auth/* 与需要登录的接口。
// 令牌按租户隔离存储（每个租户官网是独立品牌，会话不跨租户），并在 401 时用 refresh token 自动续期一次。

import { CLIENT_V1 } from '../host';
import { createRentalWebsiteAccountClient, createRentalWebsiteAuthClient, createRentalWebsiteSessionClient } from '@rental-os/rental-core/clients/website';
import type { AiBookingHandoff, AiBookingSubmissionAcceptance, AiBookingSubmissionDecision, AiBookingSubmissionReceipt,
  AiBookingAcceptanceReadRequest, AiBookingAcceptanceReadResponse }
  from '@rental-os/shared';
import type { AiClientHostCapabilities } from '@rental-os/shared';

import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientQuotePreparationRequestSchema, aiClientQuotePreparationResponseSchema,
  aiClientQuotePreparationReadResponseSchema, aiClientQuoteConfirmationRequestSchema, aiClientQuoteResultReadResponseSchema,
  aiClientQuoteReadRequestSchema, type AiClientQuoteSelectionRef, type AiClientQuotePreparationRequest, type AiClientQuoteConfirmationRequest } from '@rental-os/shared';
import { aiClientQuoteBookingRequestSchema, aiClientQuoteBookingPreparationResponseSchema, aiClientQuoteBookingOperationResponseSchema,
  aiClientBookingReadRequestSchema, type AiClientBookingReadRef, type AiClientQuoteBookingRequest, type AiEntryActionDraft, aiEntryActionSchema, aiBookingDraftSchema, aiBookingCreateResponseSchema,
  aiBookingChoiceResponseSchema, aiBookingHandoffResponseSchema, aiBookingOperationReadResponseSchema } from '@rental-os/shared';

import { ClientTransportError } from "@rental-os/web-client";
import type { ClientMembershipSessionResponse } from '@rental-os/shared';
import { minimizeClientRecoveryStorage } from './clientRecoveryStorage';
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

export const authApi = createRentalWebsiteAuthClient({
  get clientV1() { return CLIENT_V1; },
  postPublic,
  get customerLogin() { return getRentalWebsiteHost().session.customerLogin; },
  logoutCustomerSession,
  minimizeRecovery: () => minimizeClientRecoveryStorage(websiteStorage()),
});

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

/** Current personal profile display only. Unlike command recovery, a profile
 * observation cannot survive token refresh or a changed principal projection.
 * The closure retains no data in storage and grants no profile edit permission. */
export function captureOwnProfileReadSession() {
  const owner = bridge, session = owner?.getSession();
  if (!owner || !session?.accessToken || session.customer.customerType !== 'personal'
    || !session.customer.customerId || !session.workspace?.workspaceCode) return null;
  const generation = customerSessionGeneration(owner.tenantCode);
  if (generation === 'unavailable') return null;
  const token = session.accessToken, customerId = session.customer.customerId, workspaceCode = session.workspace.workspaceCode;
  const principal = JSON.stringify({ customer: session.customer, workspace: session.workspace, workspaces: session.workspaces });
  return { tenantCode: owner.tenantCode, customerId, workspaceCode, current: () => {
    const latest = loadSession(owner.tenantCode), active = owner.getSession();
    return bridge === owner && active === session && active.accessToken === token
      && JSON.stringify({ customer: active.customer, workspace: active.workspace, workspaces: active.workspaces }) === principal
      && customerSessionGeneration(owner.tenantCode) === generation && latest?.accessToken === token
      && JSON.stringify({ customer: latest.customer, workspace: latest.workspace, workspaces: latest.workspaces }) === principal;
  } };
}

export type { OwnProfileReadView } from '@rental-os/rental-core/clients/website';

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

const accountApi = createRentalWebsiteAccountClient({
  get clientV1() { return CLIENT_V1; },
  authedJson,
  currentTenantCode: () => bridge?.tenantCode,
  switchCustomerWorkspace,
  captureOwnProfileReadSession,
  readOnce: async (path, init) => parse(await authedFetch(path, init, false)),
  error: (status, message) => new ClientTransportError(status, message),
});

/** 需要登录的接口。金额、库存、可用性均以服务端为准；前端不自行拼算最终价。 */
export const sessionApi = {
  async prepareClientQuote(input: AiClientQuotePreparationRequest) {
    const command = aiClientQuotePreparationRequestSchema.parse(input);
    const value = await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.prepareQuoteParameters}`, { method: 'POST', body: JSON.stringify(command) });
    return aiClientQuotePreparationResponseSchema.parse(value);
  },
  async readClientQuotePreparation(input: AiClientQuoteSelectionRef | AiClientQuotePreparationRequest) {
    const command = aiClientQuoteReadRequestSchema.parse(input);
    const value = await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.readQuotePreparationOperation}`, { method: 'POST', body: JSON.stringify(command) });
    return aiClientQuotePreparationReadResponseSchema.parse(value);
  },
  async confirmClientQuote(input: AiClientQuoteConfirmationRequest) {
    const command = aiClientQuoteConfirmationRequestSchema.parse(input);
    const value = await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.confirmQuoteParameters}`, { method: 'POST', body: JSON.stringify(command) });
    return aiClientQuoteResultReadResponseSchema.parse(value);
  },
  async readClientQuoteOriginal(input: AiClientQuoteConfirmationRequest) {
    const command = aiClientQuoteConfirmationRequestSchema.parse(input);
    const value = await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.readPreparedQuoteOriginal}`, { method: 'POST', body: JSON.stringify(command) });
    return aiClientQuoteResultReadResponseSchema.parse(value);
  },
  async prepareOriginalQuoteBooking(input: AiClientQuoteBookingRequest) {
    return aiClientQuoteBookingPreparationResponseSchema.parse(await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOriginalQuoteBooking}`,
      { method: 'POST', body: JSON.stringify(aiClientQuoteBookingRequestSchema.parse(input)) }));
  },
  async readOriginalQuoteBookingOperation(input: AiClientBookingReadRef | AiClientQuoteBookingRequest) {
    return aiClientQuoteBookingOperationResponseSchema.parse(await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.readOriginalQuoteBookingOperation}`,
      { method: 'POST', body: JSON.stringify(aiClientBookingReadRequestSchema.parse(input)) }));
  },
  async issueBookingAction(input: { materialRef: string; actionCode: 'CREATE_BOOKING_DRAFT' }) {
    return aiEntryActionSchema.parse(await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.issueAction}`, { method: 'POST', body: JSON.stringify(input) }));
  },
  async createBookingDraft(input: { action: AiEntryActionDraft; operationKey: string }) {
    return aiBookingCreateResponseSchema.parse(await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.createBookingDraft}`, { method: 'POST', body: JSON.stringify(input) }));
  },
  async readBookingDraft(input: { bookingDraftId: string }) {
    return aiBookingDraftSchema.parse(await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingDraft}`, { method: 'POST', body: JSON.stringify(input) }));
  },
  async chooseBookingDraft(input: { bookingDraftId: string; expectedRevision: number; inputFingerprint: string; operationKey: string; decision: 'continue_booking' }) {
    const value = aiBookingChoiceResponseSchema.parse(await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.chooseBookingDraft}`, { method: 'POST', body: JSON.stringify(input) }));
    if (!('draft' in value)) throw Error('booking_choice_changed'); return value;
  },
  async handoffBookingDraft(input: { action: AiEntryActionDraft; operationKey: string }) {
    return aiBookingHandoffResponseSchema.parse(await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.handoffBookingDraft}`, { method: 'POST', body: JSON.stringify(input) }));
  },
  async readBookingOperation(input: { operationKey: string }) {
    return aiBookingOperationReadResponseSchema.parse(await authedJson<unknown>(`/ai-native/entry/${AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingOperation}`, { method: 'POST', body: JSON.stringify(input) }));
  },
  async readBookingHostCapabilities(): Promise<AiClientHostCapabilities> {
    return parse(await authedFetch('/ai-native/entry/host-capabilities/read', { method: 'POST', body: '{}' }, false));
  },
  async readBookingHandoff(input: string | { handoffRef: string }): Promise<AiBookingHandoff> {
    const handoffRef = typeof input === 'string' ? input : input.handoffRef;
    return parse(await authedFetch('/ai-native/entry/booking-handoffs/read', { method: 'POST', body: JSON.stringify({ handoffRef }) }, false));
  },
  me: accountApi.me,
  switchWorkspace: accountApi.switchWorkspace,
  ...createRentalWebsiteSessionClient(authedJson),
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
  profile: accountApi.profile,
};
