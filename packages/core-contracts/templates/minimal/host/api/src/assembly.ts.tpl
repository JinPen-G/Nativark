/** 只组合本 Core 与固定公共包；实际迁移账、物理结构和包摘要缺失时不进入业务。 */
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { createCoreDeployedCatalogue, createCoreTransactionCatalogues, type CoreDeploymentAvailability, type CorePlatformRemovalSource } from "@rental-os/core-host";
import { createMysqlCoreDeploymentObservation } from "@rental-os/core-host/mysql-deployment";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { composePlatformCoreApplication } from "@rental-os/platform-core-host";
import type { PlatformDatabaseClient, PublicDatabaseTransaction } from "@rental-os/platform-api/database";
import { createPublicCoreDependencies } from "@rental-os/platform-api/core-dependencies";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";
import { CORE_ID, createHttpContribution } from "{{PACKAGE_NAME}}";
import { composePlatformHost } from "{{PACKAGE_NAME}}/platform-host";
import { readPhysicalData } from "{{PACKAGE_NAME}}/data-plan";
import { isDeepStrictEqual } from "node:util";
import { requireDeploymentPackage } from "./deployment-package";
import { corePrismaMigrationName } from "@rental-os/core-contracts/deployment";

export function composeApplication(database: PlatformDatabaseClient, input: CoreDeploymentLock,
  options: { platformRemoval?: CorePlatformRemovalSource } = {}) {
  const lock = CoreDeploymentLockSchema.parse(input);
  const pin = lock.cores.find(core => core.manifest.id === CORE_ID);
  if (!pin || lock.cores.length !== 1 || lock.dataCapabilities?.length) throw new Error("本宿主须且仅选择 {{CORE_ID}}，不选择数据能力");
  const dependencies = createPublicCoreDependencies<PublicDatabaseTransaction>(database), plan = createPublicPlatformDataPlan();
  if (!isDeepStrictEqual(lock.platform.data, plan.data)) throw new Error("部署锁的公共数据基线与当前宿主不同");
  const { manifest } = requireDeploymentPackage(pin, lock.platform.versions);
  let catalogue: ReturnType<typeof createCoreDeployedCatalogue>;
  const http = createHttpContribution();
  const observation = (source: Pick<CoreHostSqlTransaction, "$queryRaw">) => createMysqlCoreDeploymentObservation({
    database: source, platform: plan, cores: [{ coreId: CORE_ID, data: manifest.data,
      migrationNames: manifest.data.migrations.map(migration => corePrismaMigrationName(CORE_ID, migration.id)), readPhysical: readPhysicalData }]
  });
  const forTransaction = createCoreTransactionCatalogues((tx: PublicDatabaseTransaction) =>
    createCoreDeployedCatalogue({ lock, registrations: [...catalogue.registrations.values()], http: [http], observations: observation(tx) }));
  const deploymentForTransaction = (tx: PublicDatabaseTransaction): CoreDeploymentAvailability => forTransaction(tx).availability;
  const core = composePlatformHost<PublicDatabaseTransaction>({ ...dependencies, deploymentForTransaction, deployment: {
    requireRegistered: id => catalogue.availability.requireRegistered(id),
    requireAvailable: (id, tenantId) => catalogue.availability.requireAvailable(id, tenantId)
  } });
  catalogue = createCoreDeployedCatalogue({ lock, registrations: [{ manifest, server: core.server }], http: [http], observations: observation(database) });
  return { core, application: composePlatformCoreApplication<PublicDatabaseTransaction>({ ...dependencies, catalogue, deploymentForTransaction,
    ...(options.platformRemoval ? { platformRemoval: options.platformRemoval } : {}) }) };
}
