/** 平台管理员从当前受控注册读取Core元数据，原主体与权限在返回前复核。 */
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "./ports";
import { coreRegisteredSummary } from "@rental-os/core-contracts";
import { CoreAccessError, type CoreDeployedCatalogue } from "@rental-os/core-host";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";

function canReadCatalogue(user: SystemUserRow): boolean {
  return user.isSaasAdmin === true && (user.permissions.includes("*") || user.permissions.includes("system:tenant:manage"));
}

export function createPlatformCoreCatalogueReader<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  catalogue: CoreDeployedCatalogue;
}) {
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  return () => input.database.$transaction(async (transaction: Tx) => {
    const principal = principals.current();
    const lease = await principals.lock(transaction, principal, principal.tenantId);
    if (!canReadCatalogue(lease.user)) throw new CoreAccessError("denied", "当前身份缺少SaaS Core目录管理权限");
    const result = [...input.catalogue.registrations.values()].map(registration => coreRegisteredSummary(registration.manifest));
    if (!canReadCatalogue(await lease.revalidate())) throw new CoreAccessError("denied", "Core目录读取时权限已变化");
    return result;
  }, { isolationLevel: "ReadCommitted" });
}
