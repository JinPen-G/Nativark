import type { AuthUser, BusinessWorkspace, RentalCapability, TenantContext } from "@store-rental/shared";
import { create } from "zustand";
import { api } from "@/api/rental";
import { clearSessionQueryCache } from "@/app/queryClient";

const keys = {
  token: "rental_access_token",
  refreshToken: "rental_refresh_token",
  tenant: "rental_tenant",
  user: "rental_user",
  workspaces: "rental_workspaces",
  currentWorkspaceId: "rental_current_workspace"
};

function read<T>(key: string): T | undefined {
  const raw = window.localStorage.getItem(key);
  if (!raw) return undefined;
  try { return JSON.parse(raw) as T; } catch { return undefined; }
}

function persistSession(
  tenant: TenantContext,
  user: AuthUser,
  workspaces?: BusinessWorkspace[],
  currentWorkspaceId?: string
) {
  window.localStorage.setItem(keys.tenant, JSON.stringify(tenant));
  window.localStorage.setItem(keys.user, JSON.stringify(user));
  window.localStorage.setItem(keys.workspaces, JSON.stringify(workspaces ?? []));
  if (currentWorkspaceId) window.localStorage.setItem(keys.currentWorkspaceId, currentWorkspaceId);
  else window.localStorage.removeItem(keys.currentWorkspaceId);
}

interface AuthState {
  ready: boolean;
  token?: string;
  tenant?: TenantContext;
  user?: AuthUser;
  /** SPACE-05：该账号可进入的经营空间。无空间的平台管理租户为空数组。 */
  workspaces: BusinessWorkspace[];
  currentWorkspaceId?: string;
  bootstrap: () => Promise<void>;
  login: (tenantCode: string, account: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  logout: () => void;
  hasPermission: (permission?: string) => boolean;
  hasCapability: (capability?: RentalCapability) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ready: false,
  token: window.localStorage.getItem(keys.token) ?? undefined,
  tenant: read<TenantContext>(keys.tenant),
  user: read<AuthUser>(keys.user),
  workspaces: read<BusinessWorkspace[]>(keys.workspaces) ?? [],
  currentWorkspaceId: window.localStorage.getItem(keys.currentWorkspaceId) ?? undefined,
  async bootstrap() {
    const token = window.localStorage.getItem(keys.token);
    if (!token) { set({ ready: true }); return; }
    try {
      const context = await api.sessionContext();
      // 空间变了也要清缓存：同一租户内切换空间后，业务数据整套都不一样。
      // 只比 tenantId 会让「刷新前在 A 空间、服务端会话已是 B 空间」的情况
      // 保留 A 空间的查询缓存。
      const previousWorkspaceId = get().currentWorkspaceId;
      if (
        (get().tenant?.tenantId && get().tenant?.tenantId !== context.tenant.tenantId) ||
        (previousWorkspaceId && previousWorkspaceId !== context.currentWorkspaceId)
      ) {
        clearSessionQueryCache();
      }
      persistSession(context.tenant, context.user, context.workspaces, context.currentWorkspaceId);
      set({
        ready: true,
        token,
        tenant: context.tenant,
        user: context.user,
        workspaces: context.workspaces ?? [],
        currentWorkspaceId: context.currentWorkspaceId
      });
    } catch {
      get().logout();
      set({ ready: true });
    }
  },
  async login(tenantCode, account, password) {
    const result = await api.login({ tenantCode, account, password });
    clearSessionQueryCache();
    window.localStorage.setItem(keys.token, result.accessToken);
    window.localStorage.setItem(keys.refreshToken, result.refreshToken);
    persistSession(result.tenant, result.user, result.workspaces, result.currentWorkspaceId);
    set({
      ready: true,
      token: result.accessToken,
      tenant: result.tenant,
      user: result.user,
      workspaces: result.workspaces ?? [],
      currentWorkspaceId: result.currentWorkspaceId
    });
  },

  /**
   * SPACE-05：切换当前经营空间。
   *
   * 顺序要紧：**先**清查询缓存再写入新会话。反过来的话，清缓存与组件重渲染
   * 之间有一个窗口，期间组件已按新空间渲染却读到旧空间的缓存数据，
   * 表现为"切换后短暂显示上一个空间的订单"。
   *
   * 服务端会重新校验成员资格与空间状态，无权或已停用会抛错；
   * 这里不吞异常，交给调用方提示，避免界面显示已切换而服务端其实拒绝了。
   */
  async switchWorkspace(workspaceId) {
    const result = await api.switchWorkspace({ workspaceId });
    clearSessionQueryCache();
    window.localStorage.setItem(keys.token, result.accessToken);
    // 切换复用同一会话，refreshToken 不变，因此响应里为空串——不能覆盖已存的那个。
    if (result.refreshToken) window.localStorage.setItem(keys.refreshToken, result.refreshToken);
    persistSession(result.tenant, result.user, result.workspaces ?? get().workspaces, result.currentWorkspaceId);
    set({
      token: result.accessToken,
      tenant: result.tenant,
      user: result.user,
      workspaces: result.workspaces ?? get().workspaces,
      currentWorkspaceId: result.currentWorkspaceId
    });
  },
  async changePassword(currentPassword, newPassword) {
    const result = await api.changePassword({ currentPassword, newPassword });
    clearSessionQueryCache();
    window.localStorage.setItem(keys.token, result.accessToken);
    window.localStorage.setItem(keys.refreshToken, result.refreshToken);
    persistSession(result.tenant, result.user, result.workspaces, result.currentWorkspaceId);
    set({
      ready: true,
      token: result.accessToken,
      tenant: result.tenant,
      user: result.user,
      workspaces: result.workspaces ?? [],
      currentWorkspaceId: result.currentWorkspaceId
    });
  },
  logout() {
    const refreshToken = window.localStorage.getItem(keys.refreshToken);
    if (refreshToken) void api.logout({ refreshToken }).catch(() => undefined);
    clearSessionQueryCache();
    Object.values(keys).forEach((key) => window.localStorage.removeItem(key));
    set({ token: undefined, tenant: undefined, user: undefined, workspaces: [], currentWorkspaceId: undefined });
  },
  hasPermission(permission) {
    if (!permission) return true;
    const user = get().user;
    if (!user) return false;
    if (user.isSaasAdmin) return permission.startsWith("system:tenant:");
    return Boolean(user.isPlatformAdmin || user.permissions?.includes("*") || user.permissions?.includes(permission));
  },
  hasCapability(capability) {
    if (!capability) return true;
    const capabilities = get().tenant?.capabilities;
    if (!capabilities) return true;
    return capabilities.includes(capability);
  }
}));
