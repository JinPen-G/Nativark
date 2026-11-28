/** 示例宿主只选择工单Core，公共实现通过正式出口复用；实际版本/来源由显式部署锁提供。 */
import { CoreDeploymentLockSchema, coreDeploymentHostVersions, type CoreDeploymentLock, type CoreHttpContribution } from "@rental-os/core-contracts";
import { createCoreDeployedCatalogue, createCoreTransactionCatalogues, type CoreDeploymentAvailability } from "@rental-os/core-host";
import { createMysqlCoreDeploymentObservation, type CoreMysqlDataPlan } from "@rental-os/core-host/mysql-deployment";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import {
  composePlatformCoreApplication, composePlatformCorePackageAssembly, createPlatformCorePackageAudit
} from "@rental-os/platform-core-host";
import type { PlatformDatabaseClient, PublicDatabaseTransaction } from "@rental-os/platform-api/database";
import { createPublicCoreDependencies } from "@rental-os/platform-api/core-dependencies";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";
import { createTicketsHttpContribution } from "@rental-os/example-tickets-core";
import { composeTicketsPlatformHost } from "@rental-os/example-tickets-core/platform-host";
import { readTicketsPhysicalData } from "@rental-os/example-tickets-core/mysql";
import { isDeepStrictEqual } from "node:util";
import { requireTicketsDeploymentPackage } from "./deployment-package";
import { createTicketsCorePackageSources } from "./core-package-sources";
import { corePrismaMigrationName } from "@rental-os/core-contracts/deployment";

export type TicketsCorePackageOptions = Pick<
  Parameters<typeof composePlatformCorePackageAssembly<PublicDatabaseTransaction>>[0],
  "storageDirectory" | "localArtifacts" | "deployment" | "materials" | "fetcher" | "now"
> & { platformReference?: string };

/** 仅受控启动源码提供可选贡献；包或请求字段不能指定实现。 */
export interface TicketsOptionalCapabilities {
  http: CoreHttpContribution;
  data: readonly (CoreMysqlDataPlan & { capabilityId: string })[];
  files: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
  /** 本Core选装数据的完整观察，不能替换清单或略过原迁移。 */
  coreData?: CoreMysqlDataPlan;
}

export function composeTicketsApplication(database: PlatformDatabaseClient, input: CoreDeploymentLock,
  packageOptions: TicketsCorePackageOptions = {}, selected?: TicketsOptionalCapabilities) {
  const lock = CoreDeploymentLockSchema.parse(input);
  const pin = lock.cores.find(core => core.manifest.id === "example-tickets");
  if (!pin || lock.cores.length !== 1 || (lock.dataCapabilities?.length ?? 0) !== (selected?.data.length ?? 0)
    || (selected?.data ?? []).some(plan => !lock.dataCapabilities?.some(release => release.id === plan.capabilityId && isDeepStrictEqual(release.data, plan.data))))
    throw new Error("本示范宿主须选择同一工单包及显式装配的数据能力");
  const dependencies = createPublicCoreDependencies<PublicDatabaseTransaction>(database), platformPlan = createPublicPlatformDataPlan();
  if (!isDeepStrictEqual(lock.platform.data, platformPlan.data)) throw new Error("部署锁的公共数据基线与当前宿主不一致");
  const { manifest } = requireTicketsDeploymentPackage(pin, coreDeploymentHostVersions(lock));
  if (selected?.coreData && (!isDeepStrictEqual(selected.coreData.data, manifest.data)
    || !isDeepStrictEqual(selected.coreData.migrationNames, manifest.data.migrations.map(m => corePrismaMigrationName(manifest.id, m.id)))))
    throw new Error("工单选装数据观察须完整对应已核包中的原迁移链");
  let catalogue: ReturnType<typeof createCoreDeployedCatalogue>;
  const http = selected?.http ?? createTicketsHttpContribution();
  const observation = (source: Pick<CoreHostSqlTransaction, "$queryRaw">) =>
    createMysqlCoreDeploymentObservation({ database: source, platform: platformPlan,
      cores: [{ coreId: manifest.id, ...(selected?.coreData ?? { data: manifest.data,
        migrationNames: manifest.data.migrations.map(migration => corePrismaMigrationName(manifest.id, migration.id)),
        readPhysical: readTicketsPhysicalData }) }], ...(selected ? { dataCapabilities: selected.data } : {}) });
  const catalogueForTransaction = createCoreTransactionCatalogues((transaction: PublicDatabaseTransaction) =>
    createCoreDeployedCatalogue({ lock, registrations: [...catalogue.registrations.values()],
      http: [http], observations: observation(transaction) }));
  const deploymentForTransaction = (transaction: PublicDatabaseTransaction): CoreDeploymentAvailability =>
    catalogueForTransaction(transaction).availability;
  const tickets = composeTicketsPlatformHost<PublicDatabaseTransaction>({ ...dependencies, deploymentForTransaction, deployment: {
    requireRegistered: coreId => catalogue.availability.requireRegistered(coreId),
    requireAvailable: (coreId, tenantId) => catalogue.availability.requireAvailable(coreId, tenantId)
  } });
  const observations = observation(database);
  catalogue = createCoreDeployedCatalogue({ lock, registrations: [{ manifest, server: tickets.server }],
    http: [http], observations });
  const { platformReference, ...options } = packageOptions;
  const sources = createTicketsCorePackageSources({ lock, storageDirectory: options.storageDirectory,
    platformReference, dataCapabilities: selected?.files, observe: () => observations.read(),
    observeInTransaction: transaction => observation(transaction).read() });
  return {
    tickets,
    // 此处固定为createCoreDeployedCatalogue的数据库级观察，第二参数不参与它的数据检查；不构造业务主体。
    requireCoreDataAvailable: (transaction: Pick<CoreHostSqlTransaction, "$queryRaw">) =>
      createCoreDeployedCatalogue({ lock, registrations: [...catalogue.registrations.values()], http: [http],
        observations: observation(transaction) }).availability.requireAvailable(manifest.id, ""),
    requireDataCapabilityAvailable: (capabilityId: string, transaction: Pick<CoreHostSqlTransaction, "$queryRaw">) =>
      createCoreDeployedCatalogue({ lock, registrations: [...catalogue.registrations.values()], http: [http],
        observations: observation(transaction) }).requireDataCapabilityAvailable(capabilityId),
    application: composePlatformCoreApplication<PublicDatabaseTransaction>({ ...dependencies, catalogue, deploymentForTransaction }),
    packages: composePlatformCorePackageAssembly<PublicDatabaseTransaction>({
      ...options, deployment: options.deployment ?? sources.deployment, materials: options.materials ?? sources.materials,
      database: dependencies.database, users: dependencies.users, catalogue,
      audit: createPlatformCorePackageAudit<PublicDatabaseTransaction>()
    })
  };
}
