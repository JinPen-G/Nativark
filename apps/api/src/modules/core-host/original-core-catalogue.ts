/** 平台管理员从当前受控注册读取Core元数据，原主体与权限在返回前复核。 */
import type { Prisma } from "@prisma/client";
import { coreRegisteredSummary } from "@rental-os/core-contracts";
import { CoreAccessError, type CoreDeployedCatalogue } from "@rental-os/core-host";
import type { SystemUserRow } from "@rental-os/shared";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import { OriginalCorePrincipalAuthority } from "./original-core-principal";

function canReadCatalogue(user: SystemUserRow): boolean {
  return user.isSaasAdmin === true && (user.permissions.includes("*") || user.permissions.includes("system:tenant:manage"));
}

export function createOriginalCoreCatalogueReader(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  catalogue: CoreDeployedCatalogue;
}) {
  const principals = new OriginalCorePrincipalAuthority(input.users);
  return () => input.database.$transaction(async (transaction: Prisma.TransactionClient) => {
    const principal = principals.current();
    const lease = await principals.lock(transaction, principal, principal.tenantId);
    if (!canReadCatalogue(lease.user)) throw new CoreAccessError("denied", "当前身份缺少SaaS Core目录管理权限");
    const result = [...input.catalogue.registrations.values()].map(registration => coreRegisteredSummary(registration.manifest));
    if (!canReadCatalogue(await lease.revalidate())) throw new CoreAccessError("denied", "Core目录读取时权限已变化");
    return result;
  }, { isolationLevel: "ReadCommitted" });
}
