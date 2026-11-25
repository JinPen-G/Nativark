/** 原公共管理可见性。页面维护门禁消费当前会话，服务端仍复验主体和完整范围。 */
import type { AuthUser } from "@rental-os/platform-contracts";

export const PLATFORM_SETTINGS_ROUTES = {
  organizations: { path: "/settings/organizations", permission: "system:user:manage" },
  security: { path: "/platform/system", permission: "system:params:manage" }
} as const;

export function canReadOrganizations(user: AuthUser | undefined): boolean {
  return Boolean(user && !user.isSaasAdmin && (user.isPlatformAdmin
    || user.permissions?.includes("*") || user.permissions?.includes(PLATFORM_SETTINGS_ROUTES.organizations.permission)));
}

export function canWriteOrganizations(user: AuthUser | undefined): boolean {
  return canReadOrganizations(user) && Boolean(user?.isPlatformAdmin || user?.permissions?.includes("*") || user?.dataScope === "all")
    && user?.locationScope?.mode !== "selected";
}

export function canReadSecurityBaseline(user: AuthUser | undefined): boolean {
  return Boolean(user && (!user.isSaasAdmin && user.isPlatformAdmin
    || user.permissions?.includes("*") || user.permissions?.includes(PLATFORM_SETTINGS_ROUTES.security.permission)));
}

export function canWriteSecurityBaseline(user: AuthUser | undefined): boolean {
  return user?.isSaasAdmin === true && canReadSecurityBaseline(user);
}
