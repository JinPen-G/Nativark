/** 独立 Rental 宿主的同实例组合。当前闭包只接受显式 disabled 的 161 模型选择。
 * 构造不连接、预热、迁移或挂载 HTTP；旧直接写入的 Core 复核接齐前不能作为完整启动入口。
 * 运行部署仍须实际固定包、原 Prisma 账与物理观察，源码目录不代替已准备发行。 */
import { ForbiddenException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { isDeepStrictEqual } from "node:util";
import * as shared from "@rental-os/shared";
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { createCoreDeployedCatalogue, type CoreDeployedCatalogue } from "@rental-os/core-host";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { createMysqlCoreDeploymentObservation } from "@rental-os/core-host/mysql-deployment";
import { createPublicCoreDependencies } from "@rental-os/platform-api/core-dependencies";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";
import { composePlatformCoreApplication } from "@rental-os/platform-core-host";
import { readPublicSubscriptionTerm } from "@rental-os/platform-server/subscription-reader";
import { readBoundedMedia } from "@rental-os/platform-server/media";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { createRentalApplication } from "@rental-os/rental-core/application";
import { createRentalHttpApplications } from "@rental-os/rental-core/application-http";
import { createRentalPlatformApplications } from "@rental-os/rental-core/application-platform";
import { createRentalApplicationAccess } from "@rental-os/rental-core/application-access";
import { createRentalPublicApplicationAccess, createRentalPaymentCallbackAccess } from "@rental-os/rental-core/application-public-access";
import { createRentalWorkerAuthority } from "@rental-os/rental-core/application-worker-authority";
import { composeRentalPlatformHost } from "@rental-os/rental-core/platform-host";
import { composeRentalCoreSessionReader } from "@rental-os/rental-core/core-session";
import { createRentalAuthorization } from "@rental-os/rental-core/http-auth";
import { createRentalCustomerManagementApplication } from "@rental-os/rental-core/customer-management";
import { createRentalWorkspaceManagementApplication } from "@rental-os/rental-core/workspace-management";
import type { RentalDatabaseClient, RentalDatabaseTransaction } from "./database";
import { requireRentalDeploymentPackage } from "./deployment-package";
import { RentalApplicationLifecycle } from "./lifecycle";

export function composeRentalApplication(input: {
  database: RentalDatabaseClient;
  configuration: ConfigService;
  lock: CoreDeploymentLock;
  aiMode: "disabled";
}) {
  if (input.aiMode !== "disabled") throw new Error("启用 AI 须使用明确锁定的可选能力、247 模型及实际参加者组合");
  const lock = CoreDeploymentLockSchema.parse(input.lock);
  // 可选数据合同由公共宿主管理；此组合不默默忽略已选择的能力，也不从未知形状降级到无 AI。
  if ("dataCapabilities" in lock && (!Array.isArray(lock.dataCapabilities) || lock.dataCapabilities.length)) {
    throw new Error("当前无 AI 组合不能消费已选择的可选数据能力");
  }
  const pin = lock.cores.find(core => core.manifest.id === "rental");
  if (!pin || lock.cores.length !== 1) throw new Error("本 Rental 宿主组合须且仅须选择 Rental Core");
  const rentalPackage = requireRentalDeploymentPackage(pin, lock.platform.versions);
  const platformPlan = createPublicPlatformDataPlan(rentalPackage.dataPlan.publicForeignKeys);
  if (!isDeepStrictEqual(lock.platform.data, platformPlan.data)) throw new Error("部署锁公共基线与当前宿主不一致");
  const { database, configuration } = input;
  const dependencies = createPublicCoreDependencies<RentalDatabaseTransaction>(database);
  const observation = (reader: Pick<CoreHostSqlTransaction, "$queryRaw">) => createMysqlCoreDeploymentObservation({
    database: reader, platform: platformPlan,
    cores: [{ ...rentalPackage.dataPlan, coreId: rentalPackage.manifest.id }]
  });
  let catalogue: CoreDeployedCatalogue;
  // 所有回调只在同步组合完成后才会消费；缺观察时原 catalogue 明确拒绝，不提供准备态放行。
  const deploymentForTransaction = (transaction: Pick<CoreHostSqlTransaction, "$queryRaw">) => createCoreDeployedCatalogue({
    lock, registrations: [...catalogue.registrations.values()], observations: observation(transaction)
  }).availability;
  const rental = createRentalApplication({ database, configuration, aiMode: input.aiMode,
    participants: { readInspectionMedia: readBoundedMedia },
    workerAuthority: foundation => createRentalWorkerAuthority<RentalDatabaseTransaction>({
      database, term: dependencies.term, configuration: foundation.coreConfiguration, deploymentForTransaction
    })
  });
  const platformHost = composeRentalPlatformHost<RentalDatabaseTransaction>({ database,
    users: rental.authSource, configuration: rental.foundation.coreConfiguration, term: dependencies.term,
    deployment: {
      requireRegistered: coreId => catalogue.availability.requireRegistered(coreId),
      requireAvailable: (coreId, tenantId) => catalogue.availability.requireAvailable(coreId, tenantId)
    }
  });
  catalogue = createCoreDeployedCatalogue({ lock,
    registrations: [{ manifest: rentalPackage.manifest, server: platformHost.server }], observations: observation(database) });
  const core = composePlatformCoreApplication({ ...dependencies, catalogue,
    authorizeContainer: platformHost.authorizeContainer });
  core.session = composeRentalCoreSessionReader({ database, authSource: rental.authSource, catalogue });
  const authorization = createRentalAuthorization(shared);
  const guard = new authorization.Guard(rental.auth, rental.foundation.capabilities, rental.client.auth,
    rental.client.rateLimit, database, rental.subscriptions);
  const access = createRentalApplicationAccess({ database, authorization, deploymentForTransaction,
    managementAuthority: new PlatformPrincipalAuthority({ findUserById: (id, tx) =>
      rental.authSource.findUserById(id, tx) }),
    term: { async requireNewBusiness(transaction, tenantId) {
      const term = await readPublicSubscriptionTerm(transaction, tenantId);
      if (!term.newBusinessAllowed) throw new ForbiddenException("租户订阅已到期，暂停新增 Core 业务");
    } }
  });
  const publicAccess = createRentalPublicApplicationAccess({ database, authorization, deploymentForTransaction });
  const callbackAccess = createRentalPaymentCallbackAccess({ database, deploymentForTransaction });
  return Object.freeze({ rental, catalogue, core, authorization, guard, access, publicAccess, callbackAccess,
    http: createRentalHttpApplications(rental, { guard }),
    extensions: { auth: rental.auth, subscriptions: rental.subscriptions },
    customers: createRentalCustomerManagementApplication(rental),
    workspaces: createRentalWorkspaceManagementApplication(rental),
    platform: createRentalPlatformApplications(rental, { core, legacyGuard: guard }),
    payments: { runtime: rental.integrations.payments, statements: rental.integrations.statements, core: rental.primary.core },
    jobs: rental.integrations.ledger, notifications: rental.integrations.ledger,
    lifecycle: new RentalApplicationLifecycle(rental, () => database.$disconnect(),
      configuration.get<string>("DATABASE_CONNECT_ON_START") === "true" ? () => database.$connect() : undefined) });
}

export type RentalHostAssembly = ReturnType<typeof composeRentalApplication>;
