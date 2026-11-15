/** 公共宿主的单一Core应用工厂。默认零Core，选中实现/数据观察须在受控装配显式提供。 */
import { ForbiddenException, Module } from "@nestjs/common";
import { PlatformIdentityRepository, readPublicSubscriptionTerm } from "@rental-os/platform-server";
import type { Prisma } from "../generated/client";
import { CoreHostModule, CORE_HOST_APPLICATION, composePlatformCoreApplication, createEmptyCoreCatalogue,
  createPlatformCoreAudit, type CoreHostHttpApplication } from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "./database";

/** 只有目录选择零Core时可走此默认组合，任何未知Core/业务HTTP仍明确拒绝。 */
export function composePublicCoreApplication(database: PlatformDatabaseClient): CoreHostHttpApplication {
  const users = new PlatformIdentityRepository(database);
  return composePlatformCoreApplication<Prisma.TransactionClient>({ database, users, catalogue: createEmptyCoreCatalogue(), audit: createPlatformCoreAudit(),
    term: {
      async requireNewBusiness(transaction, tenantId) {
        const term = await readPublicSubscriptionTerm(transaction, tenantId);
        if (!term.newBusinessAllowed) throw new ForbiddenException("租户订阅已到期，暂停新增Core业务");
      }
    }
  });
}

export const PUBLIC_CORE_APPLICATION = Symbol("public.core-application");
@Module({ imports: [PlatformDatabaseModule], providers: [{ provide: PUBLIC_CORE_APPLICATION,
  inject: [PlatformDatabaseClient], useFactory: composePublicCoreApplication }], exports: [PUBLIC_CORE_APPLICATION] })
class PublicCoreDependenciesModule {}

export const publicCoreModule = CoreHostModule.register({ imports: [PublicCoreDependenciesModule], inject: [PUBLIC_CORE_APPLICATION],
  useFactory: (application: CoreHostHttpApplication) => application });
export { CORE_HOST_APPLICATION };
