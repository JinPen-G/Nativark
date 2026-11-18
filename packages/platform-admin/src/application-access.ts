/** 公共后台沿租户基础成员授权判可见性，当前Core角色不能替代公共管理权。
 * 服务端仍从当前账号和基础角色复核同一权限及完整租户范围。 */
import type { AuthUser } from "@rental-os/platform-contracts";

export function canManagePublicResource(user: AuthUser | undefined, audience: "saas" | "tenant", permission: string): boolean {
  if (!user) return false;
  if (audience === "saas") return user.isSaasAdmin === true
    && Boolean(user.permissions?.includes("*") || user.permissions?.includes(permission));
  const membership = user.tenantMembership;
  return user.isSaasAdmin !== true && Boolean(membership && (membership.isTenantAdmin
    || membership.dataScope === "all" && membership.permissions.includes(permission)));
}
