/** 公共Core依赖单源：同一真实数据库/账号、原统一期限及同事务审计；不装配具体业务。 */
import { ForbiddenException } from "@nestjs/common";
import { PlatformIdentityRepository, readPublicSubscriptionTerm } from "@rental-os/platform-server";
import { createPlatformCoreAudit } from "@rental-os/platform-core-host";
import type { PlatformCoreTransaction } from "@rental-os/platform-core-host";
import type { PlatformAuthDataStore } from "@rental-os/platform-server/auth-store";
import type { PublicSubscriptionReader } from "@rental-os/platform-server/subscription-reader";
import type { PlatformManagementTransaction } from "@rental-os/platform-server/management-store";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { Prisma } from "../generated/client";

export type PublicCoreTransaction = PlatformCoreTransaction & PublicSubscriptionReader
  & Pick<PlatformManagementTransaction, "operationLog">;

/** 组合宿主保留自己的事务类型；公共策略只依赖实际读取/审计端口，不约束其完整生成模型。 */
export function createPublicCoreDependencies<Tx extends PublicCoreTransaction = Prisma.TransactionClient>(
  database: PlatformAuthDataStore & CoreHostSqlClient<Tx> & Pick<Tx, "$queryRaw">) {
  return { database, users: new PlatformIdentityRepository(database), audit: createPlatformCoreAudit<Tx>(),
    term: { async requireNewBusiness(transaction: Tx, tenantId: string) {
      const term = await readPublicSubscriptionTerm(transaction, tenantId);
      if (!term.newBusinessAllowed) throw new ForbiddenException("租户订阅已到期，暂停新增Core业务");
    } }
  };
}
