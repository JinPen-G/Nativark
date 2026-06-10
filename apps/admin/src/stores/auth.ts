import { defineStore } from "pinia";
import type { AuthUser, LoginRequest, TenantContext } from "@rimo/shared";
import { login as loginApi } from "../api/client";

const tokenKey = "rimo_access_token";
const tenantKey = "rimo_tenant";
const userKey = "rimo_user";

function readJson<T>(key: string): T | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    accessToken: window.localStorage.getItem(tokenKey) ?? "",
    tenant: readJson<TenantContext>(tenantKey),
    user: readJson<AuthUser>(userKey)
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.accessToken && state.user),
    isPlatformAdmin: (state) => Boolean(state.user?.isPlatformAdmin),
    permissionCodes: (state) => state.user?.permissions ?? []
  },
  actions: {
    async login(payload: LoginRequest) {
      const response = await loginApi(payload);
      this.accessToken = response.accessToken;
      this.tenant = response.tenant;
      this.user = response.user;
      window.localStorage.setItem(tokenKey, response.accessToken);
      window.localStorage.setItem(tenantKey, JSON.stringify(response.tenant));
      window.localStorage.setItem(userKey, JSON.stringify(response.user));
      return response;
    },
    logout() {
      this.accessToken = "";
      this.tenant = null;
      this.user = null;
      window.localStorage.removeItem(tokenKey);
      window.localStorage.removeItem(tenantKey);
      window.localStorage.removeItem(userKey);
    },
    hasPermission(code?: string) {
      if (!code) {
        return true;
      }
      if (!this.user) {
        return true;
      }
      return Boolean(
        this.user.isPlatformAdmin ||
          this.user.permissions?.includes("*") ||
          this.user.permissions?.includes(code)
      );
    },
    hasAnyPermission(codes: string[]) {
      if (codes.length === 0) {
        return true;
      }
      if (!this.user) {
        return true;
      }
      return Boolean(
        this.user.isPlatformAdmin ||
          this.user.permissions?.includes("*") ||
          codes.some((code) => this.user?.permissions?.includes(code))
      );
    }
  }
});
