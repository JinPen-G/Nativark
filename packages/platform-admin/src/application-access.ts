/** 公共后台沿租户基础成员授权判可见性，当前Core角色不能替代公共管理权。
 * 服务端仍从当前账号和基础角色复核同一权限及完整租户范围。 */
import type { AuthUser } from "@rental-os/platform-contracts";

export function canManagePublicResource(user: AuthUser | undefined, audience: "saas" | "tenant", permission: string): boolean {
  if (!user) return false;
  if (audience === "saas") {
    if (!user.isSaasAdmin) return false;
    // 与原后台 hasPermission 一致；SaaS 通配角色不进入租户账号、角色和组织页。
    if (permission === "system:params:manage" || permission === "system:ai-provider:view"
      || permission === "system:ai-provider:manage" || permission.startsWith("system:rental-category:"))
      return Boolean(user.permissions?.includes("*") || user.permissions?.includes(permission));
    return permission.startsWith("system:tenant:") || permission.startsWith("system:calendar-source:")
      || permission === "system:demo-request:view";
  }
  const membership = user.tenantMembership;
  return user.isSaasAdmin !== true && Boolean(membership && (membership.isTenantAdmin
    || membership.dataScope === "all" && (membership.permissions.includes("*") || membership.permissions.includes(permission))));
}
