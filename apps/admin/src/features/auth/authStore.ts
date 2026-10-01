import type { AuthUser, BusinessWorkspace, LoginResponse, RentalCapability, TenantContext } from "@rental-os/shared";
import { create } from "zustand";
import { api } from "@/api/platform";
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
  login: (tenantCode: string, account: string, password: string) => Promise<LoginResponse>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  setTenantThemeColor: (themeColor?: string) => void;
  /** 账户级管理后台主题色（跟随登录账户，与租户品牌色独立）。保存后立即换肤。 */
  setAccountThemeColor: (themeColor?: string) => void;
  setTenantBranding: (branding: Pick<TenantContext, "brandName" | "brandLogoUrl" | "faviconUrl" | "themeColor" | "adminCornerRadius" | "adminContainerRadius" | "adminButtonRadius" | "adminInputRadius">) => void;
  logout: () => void;
  hasPermission: (permission?: string) => boolean;
  hasTenantMembershipPermission: (permission?: string) => boolean;
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
    return result;
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
  setTenantThemeColor(themeColor) {
    const current = get().tenant;
    if (!current) return;
    const tenant = { ...current, themeColor: themeColor?.trim() || undefined };
    window.localStorage.setItem(keys.tenant, JSON.stringify(tenant));
    set({ tenant });
    window.dispatchEvent(new CustomEvent("rental-session-updated"));
  },
  setAccountThemeColor(themeColor) {
    const current = get().user;
    if (!current) return;
    const user = { ...current, accountThemeColor: themeColor?.trim() || undefined };
    window.localStorage.setItem(keys.user, JSON.stringify(user));
    set({ user });
    window.dispatchEvent(new CustomEvent("rental-session-updated"));
  },
  setTenantBranding(branding) {
    const current = get().tenant;
    if (!current) return;
    const tenant = {
      ...current,
      brandName: branding.brandName?.trim() || undefined,
      brandLogoUrl: branding.brandLogoUrl?.trim() || undefined,
      faviconUrl: branding.faviconUrl?.trim() || undefined,
      themeColor: branding.themeColor?.trim() || undefined,
      adminCornerRadius: branding.adminCornerRadius,
      adminContainerRadius: branding.adminContainerRadius,
      adminButtonRadius: branding.adminButtonRadius,
      adminInputRadius: branding.adminInputRadius
    };
    window.localStorage.setItem(keys.tenant, JSON.stringify(tenant));
    set({ tenant });
    window.dispatchEvent(new CustomEvent("rental-session-updated"));
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
    // SaaS 平台管理员只拿到跨租户的平台能力：租户管理，以及公共官方日历来源注册表
    // （需求 4.5.8）。与后端 hasAnyPermission 同一口径，否则菜单会把有权访问的页面藏掉。
    if (user.isSaasAdmin) {
      return permission.startsWith("system:tenant:") || permission.startsWith("system:calendar-source:") || permission === "system:demo-request:view";
    }
    return Boolean(user.isPlatformAdmin || user.permissions?.includes("*") || user.permissions?.includes(permission));
  },
  hasTenantMembershipPermission(permission) {
    const user = get().user;
    const access = user?.tenantMembership;
    if (!access || user?.isSaasAdmin) return false;
    if (access.isTenantAdmin) return true;
    return access.dataScope === "all" && (!permission || access.permissions.includes("*") || access.permissions.includes(permission));
  },
  hasCapability(capability) {
    if (!capability) return true;
    const capabilities = get().tenant?.capabilities;
    // 品类能力是经营入口的许可信息；缺失只能说明会话尚未完成或数据不完整，
    // 不能据此展示本不该进入的能力入口。
    if (!capabilities) return false;
    return capabilities.includes(capability);
  }
}));

function syncSessionFromStorage() {
  const nextWorkspaceId = window.localStorage.getItem(keys.currentWorkspaceId) ?? undefined;
  const previousWorkspaceId = useAuthStore.getState().currentWorkspaceId;
  if (previousWorkspaceId !== nextWorkspaceId) clearSessionQueryCache();
  setAuthStateFromStorage(useAuthStore, nextWorkspaceId);
}

function setAuthStateFromStorage(store: typeof useAuthStore, currentWorkspaceId?: string) {
  store.setState({
    token: window.localStorage.getItem(keys.token) ?? undefined,
    tenant: read<TenantContext>(keys.tenant),
    user: read<AuthUser>(keys.user),
    workspaces: read<BusinessWorkspace[]>(keys.workspaces) ?? [],
    currentWorkspaceId
  });
}

// refresh 可能由任一请求触发；storage 事件覆盖多标签页，CustomEvent 覆盖
// 同一标签页内由 axios 拦截器触发的静默刷新。
window.addEventListener("rental-session-updated", syncSessionFromStorage);
window.addEventListener("storage", (event) => {
  if (Object.values(keys).includes(event.key as string)) syncSessionFromStorage();
});
