/** 沿原租户集成的明确权限或*语义。可见性不扩大服务端的数据或维护权限。 */
import type { AuthUser } from "@rental-os/platform-contracts";

export const TENANT_INTEGRATIONS_ROUTE = { path: "/tenant/integrations", permission: "system:integration:manage" } as const;

export function hasTenantIntegrationPermission(user: AuthUser | undefined): boolean {
  return Boolean(user && !user.isSaasAdmin
    && (user.isPlatformAdmin || user.permissions?.includes("*") || user.permissions?.includes(TENANT_INTEGRATIONS_ROUTE.permission)));
}
