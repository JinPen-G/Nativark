/** 示例宿主只选择工单Core，公共实现通过正式出口复用；实际版本/来源由显式部署锁提供。 */
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { createCoreDeployedCatalogue } from "@rental-os/core-host";
import { createMysqlCoreDeploymentObservation } from "@rental-os/core-host/mysql-deployment";
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

export function composeTicketsApplication(database: PlatformDatabaseClient, input: CoreDeploymentLock,
  packageOptions: TicketsCorePackageOptions = {}) {
  const lock = CoreDeploymentLockSchema.parse(input);
  const pin = lock.cores.find(core => core.manifest.id === "example-tickets");
  if (!pin || lock.cores.length !== 1 || lock.dataCapabilities?.length)
    throw new Error("本示范宿主须且仅选择 example-tickets Core，不选择数据能力");
  const dependencies = createPublicCoreDependencies<PublicDatabaseTransaction>(database), platformPlan = createPublicPlatformDataPlan();
  if (!isDeepStrictEqual(lock.platform.data, platformPlan.data)) throw new Error("部署锁的公共数据基线与当前宿主不一致");
  const { manifest } = requireTicketsDeploymentPackage(pin, lock.platform.versions);
  let catalogue: ReturnType<typeof createCoreDeployedCatalogue>;
  const tickets = composeTicketsPlatformHost<PublicDatabaseTransaction>({ ...dependencies, deployment: {
    requireRegistered: coreId => catalogue.availability.requireRegistered(coreId),
    requireAvailable: (coreId, tenantId) => catalogue.availability.requireAvailable(coreId, tenantId)
  } });
  const observations = createMysqlCoreDeploymentObservation({ database, platform: platformPlan,
    cores: [{ coreId: manifest.id, data: manifest.data,
      migrationNames: manifest.data.migrations.map(migration => corePrismaMigrationName(manifest.id, migration.id)), readPhysical: readTicketsPhysicalData }] });
  catalogue = createCoreDeployedCatalogue({ lock, registrations: [{ manifest, server: tickets.server }],
    http: [createTicketsHttpContribution()], observations });
  const { platformReference, ...options } = packageOptions;
  const sources = createTicketsCorePackageSources({ lock, storageDirectory: options.storageDirectory,
    platformReference, observe: () => observations.read() });
  return {
    tickets,
    application: composePlatformCoreApplication<PublicDatabaseTransaction>({ ...dependencies, catalogue }),
    packages: composePlatformCorePackageAssembly<PublicDatabaseTransaction>({
      ...options, deployment: options.deployment ?? sources.deployment, materials: options.materials ?? sources.materials,
      database: dependencies.database, users: dependencies.users, catalogue,
      audit: createPlatformCorePackageAudit<PublicDatabaseTransaction>()
    })
  };
}
