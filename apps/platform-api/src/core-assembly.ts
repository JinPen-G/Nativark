/** 公共宿主的单一Core应用工厂。默认零Core，选中实现/数据观察须在受控装配显式提供。 */
import { Module, ServiceUnavailableException } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { dirname, join, resolve } from "node:path";
import type { TenantIntegrationBusinessParticipant } from "@rental-os/platform-server/integration-store";
import { SecretBox } from "@rental-os/platform-server/secret-box";
import { assertFileProviderCanDisable, assertFileProviderIdentityChange } from "@rental-os/platform-server/file-integration-dependencies";
import type { Prisma } from "../generated/client";
import { CoreHostModule, CORE_HOST_APPLICATION, CorePackageAssemblyModule, CORE_PACKAGE_ASSEMBLY,
  composePlatformCoreApplication, composePlatformCorePackageAssembly, createEmptyCoreCatalogue,
  createPlatformCorePackageAudit, createPlatformCorePackageArchiveIndexSource,
  createPublicCorePackageDeploymentSources, type CoreHostHttpApplication } from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "./database";
import { createPublicCoreDependencies } from "./core-dependencies";
import { createPublicPlatformDataPlan } from "./platform-data";

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
export function composePublicCoreApplication(database: PlatformDatabaseClient,
  dependencies = createPublicCoreDependencies<Prisma.TransactionClient>(database)): CoreHostHttpApplication {
  return composePlatformCoreApplication<Prisma.TransactionClient>({ ...dependencies, catalogue: publicCoreCatalogue });
}

type PublicCoreDependencies = ReturnType<typeof createPublicCoreDependencies<Prisma.TransactionClient>>;
const PUBLIC_CORE_DEPENDENCIES = Symbol("public.core-dependencies");
export const PUBLIC_CORE_APPLICATION = Symbol("public.core-application");
@Module({ imports: [PlatformDatabaseModule], providers: [
  { provide: PUBLIC_CORE_DEPENDENCIES, inject: [PlatformDatabaseClient],
    useFactory: (database: PlatformDatabaseClient) => createPublicCoreDependencies<Prisma.TransactionClient>(database) },
  { provide: PUBLIC_CORE_APPLICATION, inject: [PlatformDatabaseClient, PUBLIC_CORE_DEPENDENCIES],
    useFactory: composePublicCoreApplication }
], exports: [PUBLIC_CORE_APPLICATION, PUBLIC_CORE_DEPENDENCIES] })
class PublicCoreDependenciesModule {}

export const publicCoreModule = CoreHostModule.register({ imports: [PublicCoreDependenciesModule], inject: [PUBLIC_CORE_APPLICATION],
  useFactory: (application: CoreHostHttpApplication) => application });

/** 默认宿主共用原数据库和当前账号，启动锁及本地包来自配置，实际模块目录由当前运行入口固定。 */
export const publicCorePackagesModule = CorePackageAssemblyModule.register({
  imports: [PublicCoreDependenciesModule, ConfigModule], inject: [PUBLIC_CORE_DEPENDENCIES, ConfigService],
  useFactory: (dependencies: PublicCoreDependencies, config: ConfigService) => {
    const storageDirectory = config.get<string>("CORE_PACKAGE_STORAGE_ROOT");
    const localArtifacts = storageDirectory ? createPlatformCorePackageArchiveIndexSource({
      directory: join(storageDirectory, "archives")
    }) : undefined;
    const runtimeEntries = new Map([
      ["packages/platform-contracts", require.resolve("@rental-os/platform-contracts")],
      ["packages/core-contracts", require.resolve("@rental-os/core-contracts")],
      ["packages/core-host", require.resolve("@rental-os/core-host")],
      ["packages/platform-server", require.resolve("@rental-os/platform-server")],
      ["packages/platform-core-host", require.resolve("@rental-os/platform-core-host")],
      ["apps/platform-api", require.resolve("./platform-data")]
    ]);
    const sources = createPublicCorePackageDeploymentSources({
      database: dependencies.database, artifacts: localArtifacts,
      lockFile: config.get<string>("CORE_DEPLOYMENT_LOCK_FILE"),
      platformReference: config.get<string>("CORE_PLATFORM_PACKAGE_REFERENCE"),
      platformDirectory: resolve(__dirname, "../../.."),
      runtimeDirectories: new Map([...runtimeEntries].map(([directory, entry]) => [directory, dirname(dirname(entry))])),
      runtimeEntries,
      platformData: createPublicPlatformDataPlan
    });
    return composePlatformCorePackageAssembly({
      database: dependencies.database, users: dependencies.users, catalogue: publicCoreCatalogue,
      audit: createPlatformCorePackageAudit<Prisma.TransactionClient>(),
      // 活动底座观察沿上方只读归档器；管理链由装配提供带私有来源复权的同索引适配。
      storageDirectory, sourceVault: new SecretBox(config), ...sources
    });
  }
});
export { CORE_HOST_APPLICATION, CORE_PACKAGE_ASSEMBLY };
