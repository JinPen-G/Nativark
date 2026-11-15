/** 公共宿主的单一Core应用工厂。默认零Core，选中实现/数据观察须在受控装配显式提供。 */
import { Module } from "@nestjs/common";
import type { Prisma } from "../generated/client";
import { CoreHostModule, CORE_HOST_APPLICATION, composePlatformCoreApplication, createEmptyCoreCatalogue,
  type CoreHostHttpApplication } from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "./database";
import { createPublicCoreDependencies } from "./core-dependencies";

/** 只有目录选择零Core时可走此默认组合，任何未知Core/业务HTTP仍明确拒绝。 */
export function composePublicCoreApplication(database: PlatformDatabaseClient): CoreHostHttpApplication {
  return composePlatformCoreApplication<Prisma.TransactionClient>({ ...createPublicCoreDependencies(database), catalogue: createEmptyCoreCatalogue() });
}

export const PUBLIC_CORE_APPLICATION = Symbol("public.core-application");
@Module({ imports: [PlatformDatabaseModule], providers: [{ provide: PUBLIC_CORE_APPLICATION,
  inject: [PlatformDatabaseClient], useFactory: composePublicCoreApplication }], exports: [PUBLIC_CORE_APPLICATION] })
class PublicCoreDependenciesModule {}

export const publicCoreModule = CoreHostModule.register({ imports: [PublicCoreDependenciesModule], inject: [PUBLIC_CORE_APPLICATION],
  useFactory: (application: CoreHostHttpApplication) => application });
export { CORE_HOST_APPLICATION };
