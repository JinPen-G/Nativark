/** 公共后台的可见性口径与原公共管理服务一致；服务端仍复核当前主体和完整数据范围。 */
import type { AuthUser } from "@rental-os/platform-contracts";

export function canManagePublicResource(user: AuthUser | undefined, audience: "saas" | "tenant", permission: string): boolean {
  if (!user) return false;
  if (audience === "saas") return user.isSaasAdmin === true
    && Boolean(user.permissions?.includes("*") || user.permissions?.includes(permission));
  return user.isSaasAdmin !== true && (user.isPlatformAdmin === true
    || user.dataScope === "all" && Boolean(user.permissions?.includes(permission)));
}
