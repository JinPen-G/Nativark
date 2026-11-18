/** 原租户工具可见性。字典和编号各用原权限，范围由所属租户配置决定。 */
import type { AuthUser } from "@rental-os/platform-contracts";

export const PLATFORM_TOOLS_ROUTE = "/platform/tools";
export function canManagePlatformDictionaries(user: AuthUser | undefined) {
  return Boolean(user && !user.isSaasAdmin && (user.isPlatformAdmin || user.permissions?.includes("*")
    || user.permissions?.includes("system:dictionary:manage")));
}
export function canManagePlatformNumberRules(user: AuthUser | undefined) {
  return Boolean(user && !user.isSaasAdmin && (user.isPlatformAdmin || user.permissions?.includes("*")
    || user.permissions?.includes("system:number-rule:manage")));
}
export function canManagePlatformTools(user: AuthUser | undefined) {
  return canManagePlatformDictionaries(user) || canManagePlatformNumberRules(user);
}
