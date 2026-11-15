/** 公共Core依赖单源：同一真实数据库/账号、原统一期限及同事务审计；不装配具体业务。 */
import { ForbiddenException } from "@nestjs/common";
import { PlatformIdentityRepository, readPublicSubscriptionTerm } from "@rental-os/platform-server";
import { createPlatformCoreAudit } from "@rental-os/platform-core-host";
import type { Prisma } from "../generated/client";
import type { PlatformDatabaseClient } from "./database";

export function createPublicCoreDependencies(database: PlatformDatabaseClient) {
  return { database, users: new PlatformIdentityRepository(database), audit: createPlatformCoreAudit<Prisma.TransactionClient>(),
    term: { async requireNewBusiness(transaction: Prisma.TransactionClient, tenantId: string) {
      const term = await readPublicSubscriptionTerm(transaction, tenantId);
      if (!term.newBusinessAllowed) throw new ForbiddenException("租户订阅已到期，暂停新增Core业务");
    } }
  };
}
