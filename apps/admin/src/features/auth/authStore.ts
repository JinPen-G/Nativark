import type { AuthUser, RentalCapability, TenantContext } from "@store-rental/shared";
import { create } from "zustand";
import { api } from "@/api/rental";

const keys = {
  token: "rental_access_token",
  refreshToken: "rental_refresh_token",
  tenant: "rental_tenant",
  user: "rental_user"
};

function read<T>(key: string): T | undefined {
  const raw = window.localStorage.getItem(key);
  if (!raw) return undefined;
  try { return JSON.parse(raw) as T; } catch { return undefined; }
}

interface AuthState {
  ready: boolean;
  token?: string;
  tenant?: TenantContext;
  user?: AuthUser;
  bootstrap: () => Promise<void>;
  login: (tenantCode: string, account: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => void;
  hasPermission: (permission?: string) => boolean;
  hasCapability: (capability?: RentalCapability) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ready: false,
  token: window.localStorage.getItem(keys.token) ?? undefined,
  tenant: read<TenantContext>(keys.tenant),
  user: read<AuthUser>(keys.user),
  async bootstrap() {
    const token = window.localStorage.getItem(keys.token);
    if (!token) { set({ ready: true }); return; }
    try {
      const context = await api.sessionContext();
      window.localStorage.setItem(keys.tenant, JSON.stringify(context.tenant));
      window.localStorage.setItem(keys.user, JSON.stringify(context.user));
      set({ ready: true, token, tenant: context.tenant, user: context.user });
    } catch {
      get().logout();
      set({ ready: true });
    }
  },
  async login(tenantCode, account, password) {
    const result = await api.login({ tenantCode, account, password });
    window.localStorage.setItem(keys.token, result.accessToken);
    window.localStorage.setItem(keys.refreshToken, result.refreshToken);
    window.localStorage.setItem(keys.tenant, JSON.stringify(result.tenant));
    window.localStorage.setItem(keys.user, JSON.stringify(result.user));
    set({ ready: true, token: result.accessToken, tenant: result.tenant, user: result.user });
  },
  async changePassword(currentPassword, newPassword) {
    const result = await api.changePassword({ currentPassword, newPassword });
    window.localStorage.setItem(keys.token, result.accessToken);
    window.localStorage.setItem(keys.refreshToken, result.refreshToken);
    window.localStorage.setItem(keys.tenant, JSON.stringify(result.tenant));
    window.localStorage.setItem(keys.user, JSON.stringify(result.user));
    set({ ready: true, token: result.accessToken, tenant: result.tenant, user: result.user });
  },
  logout() {
    const refreshToken = window.localStorage.getItem(keys.refreshToken);
    if (refreshToken) void api.logout({ refreshToken }).catch(() => undefined);
    Object.values(keys).forEach((key) => window.localStorage.removeItem(key));
    set({ token: undefined, tenant: undefined, user: undefined });
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
