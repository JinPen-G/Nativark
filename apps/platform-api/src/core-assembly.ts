/** 公共宿主的单一Core应用工厂。默认零Core，选中实现/数据观察须在受控装配显式提供。 */
import { Module } from "@nestjs/common";
import { PlatformIdentityRepository, type PlatformAuthTransaction } from "@rental-os/platform-server";
import { CoreHostModule, CORE_HOST_APPLICATION, composePlatformCoreApplication, createEmptyCoreCatalogue,
  createPlatformCoreAudit, type CoreHostHttpApplication } from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "./database";

/** 只有目录选择零Core时可走此默认组合，任何未知Core/业务HTTP仍明确拒绝。 */
export function composePublicCoreApplication(database: PlatformDatabaseClient): CoreHostHttpApplication {
  const users = new PlatformIdentityRepository(database);
  return composePlatformCoreApplication({ database, users, catalogue: createEmptyCoreCatalogue(), audit: createPlatformCoreAudit(),
    term: {
      // 默认宿主没有业务Core；有Core的宿主必须提供实际统一订阅政策，不能把无配置当永久许可。
      async requireNewBusiness(_transaction: PlatformAuthTransaction, _tenantId: string) {
        throw new Error("当前零Core宿主不接受新业务，选中Core须提供实际订阅适配");
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
