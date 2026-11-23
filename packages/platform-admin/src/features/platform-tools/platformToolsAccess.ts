/** 原租户工具可见性。各工具保留原权限，文件及业务范围由服务端再次裁定。 */
import type { AuthUser } from "@rental-os/platform-contracts";
import { hasTenantMessagingPermission } from "../messaging/messagingAccess";

export const PLATFORM_TOOLS_ROUTE = "/platform/tools";
export function canManagePlatformDictionaries(user: AuthUser | undefined) {
  return Boolean(user && !user.isSaasAdmin && (user.isPlatformAdmin || user.permissions?.includes("*")
    || user.permissions?.includes("system:dictionary:manage")));
}
export function canManagePlatformNumberRules(user: AuthUser | undefined) {
  return Boolean(user && !user.isSaasAdmin && (user.isPlatformAdmin || user.permissions?.includes("*")
    || user.permissions?.includes("system:number-rule:manage")));
}
export function canManagePlatformInfrastructure(user: AuthUser | undefined) {
  return hasTenantMessagingPermission(user, "system:integration:manage");
}
/** 筛选预设是已登录租户用户的自助设置，不因此新增页面导航权限。 */
export function canManagePlatformFilterPresets(user: AuthUser | undefined) {
  return Boolean(user?.id && user.tenantId && !user.isSaasAdmin);
}
export function canManagePlatformTools(user: AuthUser | undefined) {
  return canManagePlatformDictionaries(user) || canManagePlatformNumberRules(user) || canManagePlatformInfrastructure(user);
}
