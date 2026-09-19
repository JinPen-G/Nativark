import type { ClientMembershipSessionResponse } from "@rental-os/shared";
import { Emitter } from "./events";
import { STORAGE_KEYS, clearPrivateStorage, readStorage, writeStorage } from "./storage";

/**
 * 客户端会话（本人身份 + 当前服务上下文）。
 *
 * 设计要点：
 * - 令牌只保存在小程序本机存储，绝不进分享参数、日志或剪贴板。
 * - “当前服务”（经营空间）是服务端会话的一部分：切换服务必须经服务端换发令牌，
 *   本地只记录结果，并把 contextVersion +1，让切换前发出的读取在返回时被丢弃。
 * - 会员身份是租户级的：切服务不会重新入会，membershipStatus 对所有服务相同。
 */
export interface SessionCustomer {
  customerId: string;
  customerType: "personal" | "corporate";
  displayName: string;
  loginIdentifierMasked: string;
}

export interface SessionService {
  code: string;
  name: string;
  categoryCode: string;
  membershipStatus: string;
  isDefault?: boolean;
}

export interface SessionState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  customer: SessionCustomer;
  services: SessionService[];
  serviceCode: string;
  /** 本人是否已在本租户绑定微信身份（小程序内微信支付需要）。刷新响应未带该字段时沿用本人上一值。 */
  wechatBound: boolean;
  savedAt: number;
}

export type SessionEvent =
  | { type: "signed-in"; reason: string }
  | { type: "signed-out"; reason: string }
  | { type: "service-changed"; serviceCode: string; reason: string }
  | { type: "refreshed" };

export const sessionEvents = new Emitter<SessionEvent>();

let state: SessionState | undefined;
let restored = false;
let contextVersionCounter = 1;

function restore(): void {
  if (restored) return;
  restored = true;
  const stored = readStorage<SessionState>(STORAGE_KEYS.session);
  if (stored && stored.accessToken && stored.refreshToken && stored.customer && stored.serviceCode) {
    state = stored;
  }
}

function persist(): void {
  if (state) writeStorage(STORAGE_KEYS.session, state);
}

export function currentSession(): SessionState | undefined {
  restore();
  return state;
}

export function isSignedIn(): boolean {
  return Boolean(currentSession());
}

export function accessToken(): string {
  return currentSession()?.accessToken ?? "";
}

export function refreshToken(): string {
  return currentSession()?.refreshToken ?? "";
}

export function currentService(): SessionService | undefined {
  const session = currentSession();
  if (!session) return undefined;
  return session.services.find((row) => row.code === session.serviceCode);
}

export function currentServiceCode(): string {
  return currentSession()?.serviceCode ?? "";
}

export function membershipStatus(): string | undefined {
  return currentService()?.membershipStatus ?? currentSession()?.services[0]?.membershipStatus;
}

/** 当前上下文版本；工作空间范围的请求在发出时记录它，返回时若已变化则整体丢弃响应。 */
export function contextVersion(): number {
  return contextVersionCounter;
}

export function bumpContext(_reason: string): number {
  contextVersionCounter += 1;
  return contextVersionCounter;
}

function toServices(response: ClientMembershipSessionResponse): SessionService[] {
  return response.workspaces.map((row) => ({
    code: row.workspaceCode,
    name: row.workspaceName,
    categoryCode: row.categoryCode,
    membershipStatus: row.membershipStatus,
    isDefault: (row as { isDefault?: boolean }).isDefault
  }));
}

/**
 * 保存服务端返回的会话。当前服务优先取响应里服务端绑定的 workspace；旧服务端未返回时才用调用方
 * 传入的 serviceCode（且必须在服务端列表中），不能把用户“想切到”的服务提前写进来。
 */
export function saveSession(response: ClientMembershipSessionResponse, serviceCode: string, reason: string): SessionState {
  restore();
  const previous = state;
  const services = toServices(response);
  const bound = response.workspace?.workspaceCode;
  const resolvedService = (bound && services.some((row) => row.code === bound) ? bound : undefined)
    ?? services.find((row) => row.code === serviceCode)?.code
    ?? services[0]?.code
    ?? serviceCode;
  state = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt: Date.now() + Math.max(60, response.expiresIn) * 1000,
    customer: {
      customerId: response.customer.customerId,
      customerType: response.customer.customerType,
      displayName: response.customer.displayName,
      loginIdentifierMasked: response.customer.loginIdentifierMasked
    },
    services,
    serviceCode: resolvedService,
    wechatBound: response.wechatBound ?? (previous && previous.customer.customerId === response.customer.customerId ? previous.wechatBound : false),
    savedAt: Date.now()
  };
  persist();
  writeStorage(STORAGE_KEYS.lastService, resolvedService);
  const customerChanged = !previous || previous.customer.customerId !== state.customer.customerId;
  const serviceChanged = !previous || previous.serviceCode !== state.serviceCode;
  if (customerChanged) {
    bumpContext(reason);
    sessionEvents.emit({ type: "signed-in", reason });
  } else if (serviceChanged) {
    bumpContext(reason);
    sessionEvents.emit({ type: "service-changed", serviceCode: state.serviceCode, reason });
  } else {
    sessionEvents.emit({ type: "refreshed" });
  }
  return state;
}

/** 退出/失效：清空本人私有缓存（会话、草稿、幂等键），商户公开信息保留。 */
export function clearSession(reason: string): void {
  restore();
  const had = Boolean(state);
  state = undefined;
  clearPrivateStorage();
  bumpContext(reason);
  if (had) sessionEvents.emit({ type: "signed-out", reason });
}

export function isWechatBound(): boolean {
  return Boolean(currentSession()?.wechatBound);
}

/** 绑定微信成功后本地置位，供入口显示“已绑定”；下次会话刷新会以服务端事实为准。 */
export function markWechatBound(): void {
  restore();
  if (!state || state.wechatBound) return;
  state = { ...state, wechatBound: true };
  persist();
  sessionEvents.emit({ type: "refreshed" });
}

export function lastServiceCode(): string | undefined {
  return readStorage<string>(STORAGE_KEYS.lastService);
}

/** 仅供测试：重置内存态。 */
export function resetSessionForTest(): void {
  state = undefined;
  restored = false;
  contextVersionCounter = 1;
}
