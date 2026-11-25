/** 公共订阅延续原租户权限及SaaS办理身份。服务端Guard仍逐请求建立可信主体。 */
import type { AuthUser } from "@rental-os/platform-contracts";

export type SubscriptionPermission = "rental-os:subscription:view" | "rental-os:subscription:manage"
  | "system:tenant:subscription:manage";

export function hasSubscriptionPermission(user: AuthUser | undefined, permission: SubscriptionPermission): boolean {
  if (!user) return false;
  if (user.isSaasAdmin) return permission === "system:tenant:subscription:manage";
  if (permission === "system:tenant:subscription:manage") return false;
  return Boolean(user.isPlatformAdmin || user.permissions?.includes("*") || user.permissions?.includes(permission));
}
