/** 公共消息沿原租户基础成员投影核可见性，范围和权限来源为 tenantMembership。 */
import type { AuthUser } from "@rental-os/platform-contracts";

export function hasTenantMessagingPermission(user: AuthUser | undefined,
  permission: "system:user:manage" | "system:integration:manage"): boolean {
  const access = user?.tenantMembership;
  if (!access || user?.isSaasAdmin) return false;
  if (access.isTenantAdmin) return true;
  return access.dataScope === "all" && (access.permissions.includes("*") || access.permissions.includes(permission));
}
