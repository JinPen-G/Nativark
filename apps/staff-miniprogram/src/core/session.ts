import type { LoginResponse, SessionContextResponse } from "@rental-os/shared";
import { Emitter } from "./events";
import { STORAGE_KEYS, clearPrivateStorage, readStorage, removeStorage, writeStorage } from "./storage";

/**
 * 员工会话（租户运营账号 + 当前经营空间）。
 *
 * 设计要点：
 * - 身份就是租户运营账号，与 Web 后台同一套账号与权限；令牌只保存在本机存储，绝不进分享参数或日志。
 * - “当前经营空间”是服务端会话的一部分：切换必须经 /auth/switch-workspace 换发令牌，本地只记录结果，
 *   并把 contextVersion +1，让切换前发出的读取在返回时被丢弃。
 * - 权限集合来自服务端（会话上下文），小程序只据此渲染入口；服务端仍独立校验。
 */
export interface SessionTenant {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
}

export interface SessionUser {
  id: string;
  account: string;
  displayName: string;
  roleNames: string[];
  /** 当前空间的有效权限码；平台管理员或 fixedAllPermissions 为 ["*"]。 */
  permissions: string[];
  dataScope: string;
  /** 租户级（跨空间）权限与范围：会员/证件审核等租户级动作以此判定。 */
  tenantPermissions: string[];
  tenantDataScope: string;
  isTenantAdmin: boolean;
  mustChangePassword: boolean;
}

export interface SessionWorkspace {
  id: string;
  code: string;
  name: string;
  categoryCode: string;
  status: string;
  isDefault: boolean;
  runMode?: string;
}

export interface SessionState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tenant: SessionTenant;
  user: SessionUser;
  workspaces: SessionWorkspace[];
  currentWorkspaceId: string;
  savedAt: number;
}

export type SessionEvent =
  | { type: "signed-in"; reason: string }
  | { type: "signed-out"; reason: string }
  | { type: "workspace-changed"; workspaceId: string; reason: string }
  | { type: "refreshed" };

export const sessionEvents = new Emitter<SessionEvent>();

let state: SessionState | undefined;
let restored = false;
let contextVersionCounter = 1;

function restore(): void {
  if (restored) return;
  restored = true;
  const stored = readStorage<SessionState>(STORAGE_KEYS.session);
  if (stored && stored.accessToken && stored.refreshToken && stored.user && stored.tenant) state = stored;
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

export function currentWorkspaceId(): string {
  return currentSession()?.currentWorkspaceId ?? "";
}

export function currentWorkspace(): SessionWorkspace | undefined {
  const session = currentSession();
  if (!session) return undefined;
  return session.workspaces.find((row) => row.id === session.currentWorkspaceId);
}

/** 当前上下文版本；空间范围的请求在发出时记录它，返回时若已变化则整体丢弃响应。 */
export function contextVersion(): number {
  return contextVersionCounter;
}

export function bumpContext(_reason: string): number {
  contextVersionCounter += 1;
  return contextVersionCounter;
}

/* ---------------- 权限 ---------------- */

function hasCode(codes: string[] | undefined, code: string): boolean {
  if (!codes) return false;
  return codes.includes("*") || codes.includes(code);
}

/** 当前空间是否持有任一权限码（无权限时按钮不显示，服务端仍会拒绝）。 */
export function can(...codes: string[]): boolean {
  const user = currentSession()?.user;
  if (!user) return false;
  return codes.some((code) => hasCode(user.permissions, code));
}

/** 租户级动作（会员/证件审核等）：需对应权限 + 租户级全量数据范围，或租户管理员。 */
export function canTenant(...codes: string[]): boolean {
  const user = currentSession()?.user;
  if (!user) return false;
  if (user.isTenantAdmin) return true;
  if (user.tenantDataScope !== "all") return false;
  return codes.some((code) => hasCode(user.tenantPermissions, code));
}

/* ---------------- 保存 / 更新 / 清除 ---------------- */

function toUser(response: Pick<LoginResponse, "user">): SessionUser {
  const user = response.user;
  const membership = user.tenantMembership;
  const permissions = user.isPlatformAdmin ? ["*"] : (user.permissions ?? []);
  return {
    id: user.id,
    account: user.account,
    displayName: user.displayName,
    roleNames: user.roleNames ?? [],
    permissions,
    dataScope: user.dataScope ?? "",
    tenantPermissions: membership?.permissions ?? permissions,
    tenantDataScope: membership?.dataScope ?? user.dataScope ?? "",
    isTenantAdmin: Boolean(membership?.isTenantAdmin || user.isPlatformAdmin),
    mustChangePassword: Boolean(user.mustChangePassword)
  };
}

function toWorkspaces(rows: LoginResponse["workspaces"]): SessionWorkspace[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    categoryCode: row.categoryCode,
    status: row.status,
    isDefault: row.isDefault,
    runMode: row.runMode
  }));
}

/**
 * 保存登录 / 刷新 / 切换空间的响应。
 * 切换空间的响应里 refreshToken 为空串（会话本身没换），此时沿用旧的 refreshToken。
 */
export function saveSession(response: LoginResponse, reason: string): SessionState {
  restore();
  const previous = state;
  const workspaces = toWorkspaces(response.workspaces);
  const current = response.currentWorkspaceId ?? previous?.currentWorkspaceId ?? workspaces.find((row) => row.isDefault)?.id ?? workspaces[0]?.id ?? "";
  state = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken || previous?.refreshToken || "",
    expiresAt: Date.now() + Math.max(60, response.expiresIn) * 1000,
    tenant: { tenantId: response.tenant.tenantId, tenantCode: response.tenant.tenantCode, tenantName: response.tenant.tenantName },
    user: toUser(response),
    workspaces: workspaces.length ? workspaces : previous?.workspaces ?? [],
    currentWorkspaceId: current,
    savedAt: Date.now()
  };
  persist();
  writeStorage(STORAGE_KEYS.lastTenantCode, state.tenant.tenantCode);
  const userChanged = !previous || previous.user.id !== state.user.id || previous.tenant.tenantId !== state.tenant.tenantId;
  const workspaceChanged = !previous || previous.currentWorkspaceId !== state.currentWorkspaceId;
  if (userChanged) {
    bumpContext(reason);
    sessionEvents.emit({ type: "signed-in", reason });
  } else if (workspaceChanged) {
    bumpContext(reason);
    sessionEvents.emit({ type: "workspace-changed", workspaceId: state.currentWorkspaceId, reason });
  } else {
    sessionEvents.emit({ type: "refreshed" });
  }
  return state;
}

/** 用会话上下文刷新权限、空间列表与当前空间（进入空间后调用，权限变化即时生效）。 */
export function applySessionContext(context: SessionContextResponse): SessionState | undefined {
  restore();
  if (!state) return undefined;
  const workspaces = toWorkspaces(context.workspaces);
  const previousWorkspace = state.currentWorkspaceId;
  state = {
    ...state,
    tenant: { tenantId: context.tenant.tenantId, tenantCode: context.tenant.tenantCode, tenantName: context.tenant.tenantName },
    user: toUser(context),
    workspaces: workspaces.length ? workspaces : state.workspaces,
    currentWorkspaceId: context.currentWorkspaceId ?? state.currentWorkspaceId,
    savedAt: Date.now()
  };
  persist();
  if (previousWorkspace !== state.currentWorkspaceId) {
    bumpContext("context");
    sessionEvents.emit({ type: "workspace-changed", workspaceId: state.currentWorkspaceId, reason: "context" });
  } else {
    sessionEvents.emit({ type: "refreshed" });
  }
  return state;
}

/** 退出/失效：清空本人私有缓存（会话、扫码记录、草稿）。 */
export function clearSession(reason: string): void {
  restore();
  const had = Boolean(state);
  if (state) removeStorage(`${STORAGE_KEYS.scanHistory}:${state.tenant.tenantId}:${state.user.id}`);
  state = undefined;
  clearPrivateStorage();
  bumpContext(reason);
  if (had) sessionEvents.emit({ type: "signed-out", reason });
}

export function lastTenantCode(): string {
  return readStorage<string>(STORAGE_KEYS.lastTenantCode) ?? "";
}

/** 仅供测试：重置内存态。 */
export function resetSessionForTest(): void {
  state = undefined;
  restored = false;
  contextVersionCounter = 1;
}
