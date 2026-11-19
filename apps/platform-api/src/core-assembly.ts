/** 公共宿主的单一Core应用工厂。默认零Core，选中实现/数据观察须在受控装配显式提供。 */
import { Module, ServiceUnavailableException } from "@nestjs/common";
import type { TenantIntegrationBusinessParticipant } from "@rental-os/platform-server/integration-store";
import { assertFileProviderCanDisable, assertFileProviderIdentityChange } from "@rental-os/platform-server/file-integration-dependencies";
import type { Prisma } from "../generated/client";
import { CoreHostModule, CORE_HOST_APPLICATION, composePlatformCoreApplication, createEmptyCoreCatalogue,
  type CoreHostHttpApplication } from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "./database";
import { createPublicCoreDependencies } from "./core-dependencies";

const publicCoreCatalogue = createEmptyCoreCatalogue();

/** 与默认公共Core应用共用实际空目录。零Core仍须核公共文件事实，业务外部事实另由所选Core提供。 */
function requireNoCoreIntegrationDependencies() {
  if (publicCoreCatalogue.registrations.size !== 0) throw new ServiceUnavailableException("已装配Core须提供其原外部事实依赖核验");
}

export const publicIntegrationBusiness: TenantIntegrationBusinessParticipant = {
  async settlementCurrency() { requireNoCoreIntegrationDependencies(); return undefined; },
  async assertCanDisableProvider(transaction, tenantId, capability, provider) {
    requireNoCoreIntegrationDependencies();
    if (capability === "file") await assertFileProviderCanDisable(transaction, tenantId, provider);
  },
  async assertProviderIdentityChange(transaction, tenantId, capability, provider) {
    requireNoCoreIntegrationDependencies();
    if (capability === "file") await assertFileProviderIdentityChange(transaction, tenantId, provider);
  }
};

/** 只有目录选择零Core时可走此默认组合，任何未知Core/业务HTTP仍明确拒绝。 */
export function composePublicCoreApplication(database: PlatformDatabaseClient): CoreHostHttpApplication {
  return composePlatformCoreApplication<Prisma.TransactionClient>({ ...createPublicCoreDependencies<Prisma.TransactionClient>(database), catalogue: publicCoreCatalogue });
}

export const PUBLIC_CORE_APPLICATION = Symbol("public.core-application");
@Module({ imports: [PlatformDatabaseModule], providers: [{ provide: PUBLIC_CORE_APPLICATION,
  inject: [PlatformDatabaseClient], useFactory: composePublicCoreApplication }], exports: [PUBLIC_CORE_APPLICATION] })
class PublicCoreDependenciesModule {}

export const publicCoreModule = CoreHostModule.register({ imports: [PublicCoreDependenciesModule], inject: [PUBLIC_CORE_APPLICATION],
  useFactory: (application: CoreHostHttpApplication) => application });
export { CORE_HOST_APPLICATION };
