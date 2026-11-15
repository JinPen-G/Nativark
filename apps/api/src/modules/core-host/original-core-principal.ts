/** 原Core管理的兼容出口；公共签名/角色锁与租户状态由唯一平台身份围栏复验。 */
export { PlatformPrincipalAuthority as OriginalCorePrincipalAuthority } from "@rental-os/platform-server/principal";
export type { PlatformPrincipalLease as OriginalCorePrincipalLease } from "@rental-os/platform-server/principal";
