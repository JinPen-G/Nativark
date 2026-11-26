/** 只在组合层选择 CRM；公共平台保持零行业依赖。
 * 绑定 HTTP 与初始化解析器使用同一运行时，构造完成前不处理请求或查询数据库。 */
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { corePrismaMigrationName } from "@rental-os/core-contracts/deployment";
import { createCoreDeployedCatalogue, createCoreTransactionCatalogues, type CoreDeploymentAvailability } from "@rental-os/core-host";
import { createMysqlCoreDeploymentObservation } from "@rental-os/core-host/mysql-deployment";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import {
  composePlatformCoreAdmission, composePlatformCoreBindings, composePlatformCoreManagement,
  composePlatformCoreManagementReads, createPlatformCoreCatalogueReader, composePlatformCoreSessionReader,
  composePlatformCoreScopeReader, composePlatformCoreHttpAccess, composePlatformCorePackageAssembly,
  createPlatformCorePackageAudit, type CoreHostHttpApplication
} from "@rental-os/platform-core-host";
import type { PlatformDatabaseClient, PublicDatabaseTransaction } from "@rental-os/platform-api/database";
import { createPublicCoreDependencies } from "@rental-os/platform-api/core-dependencies";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";
import { createCrmHttpContribution } from "@rental-os/crm-core";
import { composeCrmPlatformHost } from "@rental-os/crm-core/platform-host";
import { readCrmPhysicalData } from "@rental-os/crm-core/mysql";
import { isDeepStrictEqual } from "node:util";
import { requireCrmDeploymentPackage } from "./deployment-package";
import { selectCrmDeployment } from "./configuration";

export type CrmCorePackageOptions = Pick<
  Parameters<typeof composePlatformCorePackageAssembly<PublicDatabaseTransaction>>[0],
  "storageDirectory" | "localArtifacts" | "deployment" | "materials" | "fetcher" | "now"
>;

export function composeCrmApplication(database: PlatformDatabaseClient, input: CoreDeploymentLock,
  packageOptions: CrmCorePackageOptions = {}) {
  const lock = CoreDeploymentLockSchema.parse(input), pin = selectCrmDeployment(lock);
  const dependencies = createPublicCoreDependencies<PublicDatabaseTransaction>(database);
  const platformPlan = createPublicPlatformDataPlan();
  if (!isDeepStrictEqual(lock.platform.data, platformPlan.data))
    throw new Error("CRM 部署锁的公共数据基线与当前宿主不一致");
  const { manifest } = requireCrmDeploymentPackage(pin, lock.platform.versions);
  const http = createCrmHttpContribution();
  let catalogue: ReturnType<typeof createCoreDeployedCatalogue>;
  let bindings: ReturnType<typeof composePlatformCoreBindings<PublicDatabaseTransaction>>;
  const observation = (source: Pick<CoreHostSqlTransaction, "$queryRaw">) =>
    createMysqlCoreDeploymentObservation({ database: source, platform: platformPlan,
      cores: [{ coreId: manifest.id, data: manifest.data,
        migrationNames: manifest.data.migrations.map(migration => corePrismaMigrationName(manifest.id, migration.id)),
        readPhysical: readCrmPhysicalData }] });
  const transactionCatalogues = createCoreTransactionCatalogues((transaction: PublicDatabaseTransaction) =>
    createCoreDeployedCatalogue({ lock, registrations: [...catalogue.registrations.values()],
      http: [http], observations: observation(transaction) }));
  const deploymentForTransaction = (transaction: PublicDatabaseTransaction): CoreDeploymentAvailability =>
    transactionCatalogues(transaction).availability;
  const crm = composeCrmPlatformHost<PublicDatabaseTransaction>({ ...dependencies, deploymentForTransaction,
    deployment: {
      requireRegistered: coreId => catalogue.availability.requireRegistered(coreId),
      requireAvailable: (coreId, tenantId) => catalogue.availability.requireAvailable(coreId, tenantId)
    },
    resolveTransaction: (handle, scope) => {
      if (!bindings) throw new Error("CRM 绑定运行时尚未完成装配");
      return bindings.resolveTransaction(handle, scope);
    }
  });
  catalogue = createCoreDeployedCatalogue({ lock, registrations: [{ manifest, server: crm.server }],
    http: [http], observations: observation(database) });
  const shared = { ...dependencies, deployment: catalogue.availability, deploymentForTransaction };
  const selected = { ...dependencies, catalogue, deploymentForTransaction };
  bindings = composePlatformCoreBindings({ ...shared, registrations: catalogue.registrations });
  // 细粒度正式工厂避免再构造第二个绑定运行时；其句柄不能跨实例解析。
  const application: CoreHostHttpApplication = {
    management: {
      admission: composePlatformCoreAdmission(shared), management: composePlatformCoreManagement(shared),
      bindings, registered: createPlatformCoreCatalogueReader(selected), reads: composePlatformCoreManagementReads(shared)
    },
    session: composePlatformCoreSessionReader(selected),
    scope: composePlatformCoreScopeReader({ ...shared, catalogue }), http: catalogue.http,
    authorizeHttp: composePlatformCoreHttpAccess(selected)
  };
  return { crm, application, packages: composePlatformCorePackageAssembly<PublicDatabaseTransaction>({
    ...packageOptions, database: dependencies.database, users: dependencies.users, catalogue,
    audit: createPlatformCorePackageAudit<PublicDatabaseTransaction>()
  }) };
}
