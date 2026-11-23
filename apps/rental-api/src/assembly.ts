/** 独立 Rental 宿主的同实例组合。无 AI 的 161 模型闭包不导入 AI Runtime；
 * enabled 组合由独立入口提供已核完整数据包和实际参加者。构造不连接、预热、迁移或挂载 HTTP。
 * 运行部署仍须实际固定包、原 Prisma 账与物理观察，源码目录不代替已准备发行。 */
import { ForbiddenException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { isDeepStrictEqual } from "node:util";
import * as shared from "@rental-os/shared";
import { CoreDeploymentLockSchema, type CoreDeploymentLock, type CorePlatformDataCapabilityRelease, type CoreRemovalAssessment } from "@rental-os/core-contracts";
import { createCoreDeployedCatalogue, createCoreTransactionCatalogues, type CoreDeployedCatalogue } from "@rental-os/core-host";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { createMysqlCoreDeploymentObservation, type CoreMysqlDataPlan } from "@rental-os/core-host/mysql-deployment";
import { createMysqlCoreDeploymentAdmission } from "@rental-os/core-host/mysql-deployment-admission";
import { createPublicCoreDependencies } from "@rental-os/platform-api/core-dependencies";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";
import { composePlatformCoreApplication, composePlatformCorePackageAssembly, createPlatformCorePackageAudit,
  createPlatformCorePackageAssemblyHttpAccess, createPlatformCoreHttpAccess } from "@rental-os/platform-core-host";
import { readPublicSubscriptionTerm } from "@rental-os/platform-server/subscription-reader";
import { readBoundedMedia } from "@rental-os/platform-server/media";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { createRentalApplication, type RentalApplication, type RentalApplicationParticipants } from "@rental-os/rental-core/application";
import { createRentalHttpApplications } from "@rental-os/rental-core/application-http";
import { createRentalPlatformApplications } from "@rental-os/rental-core/application-platform";
import { createRentalApplicationAccess, createRentalRecoveryAuthority, createRentalMemberAuthority } from "@rental-os/rental-core/application-access";
import { createRentalPublicApplicationAccess, createRentalPaymentCallbackAccess } from "@rental-os/rental-core/application-public-access";
import { createRentalWorkerAuthority } from "@rental-os/rental-core/application-worker-authority";
import { createRentalFileCleanupAuthority, type RentalFileCleanupAuthorityDependencies } from "@rental-os/rental-core/application-file-cleanup-authority";
import { composeRentalPlatformHost } from "@rental-os/rental-core/platform-host";
import { composeRentalCoreSessionReader } from "@rental-os/rental-core/core-session";
import { createRentalAuthorization, type RentalAuthorizationGuard } from "@rental-os/rental-core/http-auth";
import { createRentalCustomerManagementApplication, type RentalCustomerManagementApplication } from "@rental-os/rental-core/customer-management";
import { createRentalWorkspaceManagementApplication } from "@rental-os/rental-core/workspace-management";
import type { RentalDatabaseClient, RentalDatabaseTransaction } from "./database";
import { requireRentalDeploymentPackage } from "./deployment-package";
import { RentalApplicationLifecycle } from "./lifecycle";
import { rentalHostLegacyApiRoutes } from "./openapi";
import { createRentalCorePackageSources } from "./core-package-sources";
import { prepareRentalAdditionalCores, type RentalHostCoreSetup } from "./additional-cores";
import { createRentalCoreRemovalSource } from "./core-removal-source";

/** 仅受控宿主装配可提供；请求、Core 包清单和环境变量不能注入运行参加者。 */
export interface RentalHostAiSetup<Binding> {
  dataPlan: CoreMysqlDataPlan;
  /** 已选能力的原完整安装包读取器；无 AI 宿主不导入能力实现。 */
  readDataPackages(): readonly { root: string; release: CorePlatformDataCapabilityRelease }[];
  fileCleanupKnowledge: NonNullable<RentalFileCleanupAuthorityDependencies["knowledge"]>;
  participants: RentalApplicationParticipants;
  /** 从实际 AI Controller/handler 闭集生成；只保留原结果/控制入口，新工作仍在原事务检查。 */
  deploymentContinuation(method: string, path: string): boolean;
  /** 同一已选数据库内读取原 AI 任务及历史依赖；未选择 AI 不证明旧数据不存在。 */
  removalDependencies: { read(coreId: string): Promise<{ complete: boolean; blockers: CoreRemovalAssessment["blockers"] }> };
  bind(input: { rental: RentalApplication; guard: RentalAuthorizationGuard;
    customers: RentalCustomerManagementApplication }): Binding;
}

/** 正式宿主返回契约只引用各包已公开的工厂/应用类型。由消费者继续推断整个
 * Rental 服务图会把包内恢复票据等私有类型展开成不可导入的 dist 路径。 */
export interface RentalHostAssembly<Binding = unknown, Additional = unknown> {
  readonly rental: RentalApplication;
  readonly catalogue: CoreDeployedCatalogue;
  readonly core: ReturnType<typeof composePlatformCoreApplication>;
  readonly packages: ReturnType<typeof composePlatformCorePackageAssembly>;
  readonly authorization: ReturnType<typeof createRentalAuthorization>;
  readonly guard: RentalAuthorizationGuard;
  readonly access: ReturnType<typeof createRentalApplicationAccess>;
  readonly publicAccess: ReturnType<typeof createRentalPublicApplicationAccess>;
  readonly callbackAccess: ReturnType<typeof createRentalPaymentCallbackAccess>;
  readonly aiAccess: ReturnType<typeof createRentalApplicationAccess> | undefined;
  readonly ai: Binding | undefined;
  readonly additionalCores: ReadonlyMap<string, Additional>;
  readonly http: ReturnType<typeof createRentalHttpApplications>;
  readonly extensions: { auth: RentalApplication["auth"]; subscriptions: RentalApplication["subscriptions"] };
  readonly customers: RentalCustomerManagementApplication;
  readonly workspaces: ReturnType<typeof createRentalWorkspaceManagementApplication>;
  readonly platform: ReturnType<typeof createRentalPlatformApplications>;
  readonly payments: { runtime: RentalApplication["integrations"]["payments"];
    statements: RentalApplication["integrations"]["statements"]; core: RentalApplication["primary"]["core"] };
  readonly jobs: RentalApplication["integrations"]["ledger"];
  readonly notifications: RentalApplication["integrations"]["ledger"];
  readonly lifecycle: RentalApplicationLifecycle;
}

export function composeRentalApplication<Binding = never, Additional = unknown>(input: {
  database: RentalDatabaseClient;
  configuration: ConfigService;
  lock: CoreDeploymentLock;
  /** 静态宿主显式选择的租户 Core；缺实际固定包/数据观察/HTTP 合同即拒绝整组。 */
  additionalCores?: readonly RentalHostCoreSetup<Additional>[];
} & ({ aiMode: "disabled"; ai?: never } | { aiMode: "enabled"; ai: RentalHostAiSetup<Binding> })): RentalHostAssembly<Binding, Additional> {
  const lock = CoreDeploymentLockSchema.parse(input.lock);
  if (input.aiMode === "disabled" && (input.ai || (lock.dataCapabilities?.length ?? 0) > 0)) {
    throw new Error("当前无 AI 组合不能消费已选择的可选数据能力");
  }
  if (input.aiMode !== "disabled" && (input.aiMode !== "enabled" || !input.ai
    || lock.dataCapabilities?.length !== 1 || lock.dataCapabilities[0].id !== "ai-native"
    || !isDeepStrictEqual(lock.dataCapabilities[0].data, input.ai.dataPlan.data)))
    throw new Error("启用 AI 须提供同一固定数据包的实际参加者和物理观察");
  const pin = lock.cores.find(core => core.manifest.id === "rental");
  if (!pin) throw new Error("本 Rental 宿主组合必须选择 Rental Core");
  const additional = prepareRentalAdditionalCores(lock, input.additionalCores ?? []);
  const rentalPackage = requireRentalDeploymentPackage(pin, lock.platform.versions);
  const platformPlan = createPublicPlatformDataPlan(rentalPackage.dataPlan.publicForeignKeys);
  if (!isDeepStrictEqual(lock.platform.data, platformPlan.data)) throw new Error("部署锁公共基线与当前宿主不一致");
  const { database, configuration } = input;
  const dependencies = createPublicCoreDependencies<RentalDatabaseTransaction>(database);
  const observation = (reader: Pick<CoreHostSqlTransaction, "$queryRaw">) => createMysqlCoreDeploymentObservation({
    database: reader, platform: platformPlan,
    cores: [{ ...rentalPackage.dataPlan, coreId: rentalPackage.manifest.id },
      ...additional.map(item => ({ ...item.dataPlan, coreId: item.coreId }))],
    ...(input.aiMode === "enabled" ? { dataCapabilities: [{ ...input.ai.dataPlan, capabilityId: "ai-native" }] } : {})
  });
  let catalogue: CoreDeployedCatalogue;
  // 所有回调只在同步组合完成后才会消费；缺观察时原 catalogue 明确拒绝，不提供准备态放行。
  const catalogueForTransaction = createCoreTransactionCatalogues((transaction: Pick<CoreHostSqlTransaction, "$queryRaw">) => createCoreDeployedCatalogue({
    lock, registrations: [...catalogue.registrations.values()], http: additional.map(item => item.http),
    observations: observation(transaction)
  }));
  const deploymentForTransaction = (transaction: Pick<CoreHostSqlTransaction, "$queryRaw">) => catalogueForTransaction(transaction).availability;
  const admissionForTransaction = createMysqlCoreDeploymentAdmission;
  const rental = createRentalApplication({ database, configuration, aiMode: input.aiMode,
    fileCleanupAuthority: createRentalFileCleanupAuthority({ deploymentForTransaction,
      ...(input.aiMode === "enabled" ? { knowledge: input.ai.fileCleanupKnowledge } : {}) }),
    participants: input.aiMode === "enabled" ? input.ai.participants : { readInspectionMedia: readBoundedMedia },
    workerAuthority: foundation => createRentalWorkerAuthority<RentalDatabaseTransaction>({
      database, term: dependencies.term, configuration: foundation.coreConfiguration, deploymentForTransaction, admissionForTransaction
    })
  });
  const platformHost = composeRentalPlatformHost<RentalDatabaseTransaction>({ database,
    users: rental.authSource, configuration: rental.foundation.coreConfiguration, term: dependencies.term,
    deploymentForTransaction,
    deployment: {
      requireRegistered: coreId => catalogue.availability.requireRegistered(coreId),
      requireAvailable: (coreId, tenantId) => catalogue.availability.requireAvailable(coreId, tenantId)
    }
  });
  const bound = additional.map(item => ({ item, value: item.bind({ database, users: rental.authSource,
    audit: dependencies.audit, term: dependencies.term, deploymentForTransaction, deployment: {
      requireRegistered: coreId => catalogue.availability.requireRegistered(coreId),
      requireAvailable: (coreId, tenantId) => catalogue.availability.requireAvailable(coreId, tenantId)
    } }) }));
  const additionalBindings = new Map(bound.map(({ item, value }) => [item.coreId, value.binding]));
  catalogue = createCoreDeployedCatalogue({ lock,
    registrations: [{ manifest: rentalPackage.manifest, server: platformHost.server },
      ...bound.map(({ item, value }) => ({ manifest: item.manifest, server: value.server }))],
    http: additional.map(item => item.http), observations: observation(database) });
  const core = composePlatformCoreApplication({ ...dependencies, users: rental.authSource, catalogue, deploymentForTransaction,
    authorizeContainer: platformHost.authorizeContainer,
    platformRemoval: createRentalCoreRemovalSource({ database,
      readAdmission: coreId => database.$transaction(async transaction =>
        (await admissionForTransaction(transaction).readCurrent(coreId)).state, { isolationLevel: "ReadCommitted" }),
      ...(input.aiMode === "enabled" ? { aiDependencies: input.ai.removalDependencies } : {}) }) });
  core.session = composeRentalCoreSessionReader({ database, authSource: rental.authSource, catalogue });
  const packages = composePlatformCorePackageAssembly({ database, users: rental.authSource, catalogue,
    audit: createPlatformCorePackageAudit<RentalDatabaseTransaction>(),
    storageDirectory: configuration.get<string>("CORE_PACKAGE_STORAGE_ROOT"),
    legacyApiRoutes: { rental: rentalHostLegacyApiRoutes() },
    ...createRentalCorePackageSources({ configuration, lock,
      rentalPackage: () => requireRentalDeploymentPackage(pin, lock.platform.versions),
      additionalCorePackages: additional,
      observe: () => observation(database).read(),
      ...(input.aiMode === "enabled" ? { dataCapabilities: input.ai.readDataPackages } : {}) }) });
  const coreHttp = createPlatformCorePackageAssemblyHttpAccess(packages, createPlatformCoreHttpAccess(core));
  const authorization = createRentalAuthorization(shared);
  const guard = new authorization.Guard(rental.auth, rental.foundation.capabilities, rental.client.auth,
    rental.client.rateLimit, database, rental.subscriptions);
  const accessInput = { database, authorization, admissionForTransaction,
    memberAuthority: createRentalMemberAuthority({ auth: rental.auth, authorization }),
    recoveryAuthority: createRentalRecoveryAuthority({ auth: rental.auth, clientAuth: rental.client.auth,
      corporateHistory: { access: rental.enterprise.access, orders: rental.enterprise.orders },
      originalHistory: { files: rental.integrations.fileAccess, approvals: rental.enterprise.approvals,
        extensions: rental.enterprise.extensions, exchanges: rental.enterprise.exchanges,
        management: rental.enterprise.management } }),
    managementAuthority: new PlatformPrincipalAuthority({ findUserById: (id, tx) =>
      rental.authSource.findUserById(id, tx) }),
    term: { async requireNewBusiness(transaction: RentalDatabaseTransaction, tenantId: string) {
      const term = await readPublicSubscriptionTerm(transaction, tenantId);
      if (!term.newBusinessAllowed) throw new ForbiddenException("租户订阅已到期，暂停新增 Core 业务");
    } }
  };
  const access = createRentalApplicationAccess({ ...accessInput, deploymentForTransaction });
  // AI 的数据准入只作用于实际 AI 请求，普通 Rental 不因可选能力未就绪而停业。
  // 两个范围复用同一数据库、Auth/ClientAuth、Guard 和原 Tenant/Core 锁；不能嵌套或相互借用。
  const aiAccess = input.aiMode === "enabled" ? createRentalApplicationAccess({ ...accessInput,
    deploymentContinuation: input.ai.deploymentContinuation,
    deploymentForTransaction: transaction => {
      const current = catalogueForTransaction(transaction);
      return { requireRegistered: current.availability.requireRegistered,
        async requireAvailable(coreId, tenantId) {
          await current.availability.requireAvailable(coreId, tenantId);
          await current.requireDataCapabilityAvailable("ai-native");
        } };
    } }) : undefined;
  const publicAccess = createRentalPublicApplicationAccess({ database, authorization, deploymentForTransaction, admissionForTransaction });
  const callbackAccess = createRentalPaymentCallbackAccess({ database, deploymentForTransaction });
  const customers = createRentalCustomerManagementApplication(rental);
  const ai = input.aiMode === "enabled" ? input.ai.bind({ rental, guard, customers }) : undefined;
  return Object.freeze({ rental, catalogue, core, packages, authorization, guard, access, publicAccess, callbackAccess, aiAccess, ai,
    // 隔离映射副本；调用者不能通过修改目录映射替换已注册服务或另一 Core 的绑定。
    get additionalCores(): ReadonlyMap<string, Additional> { return new Map(additionalBindings); },
    http: createRentalHttpApplications(rental, { guard }),
    extensions: { auth: rental.auth, subscriptions: rental.subscriptions },
    customers,
    workspaces: createRentalWorkspaceManagementApplication(rental),
    platform: createRentalPlatformApplications(rental, { core, coreHttp, legacyGuard: guard }),
    payments: { runtime: rental.integrations.payments, statements: rental.integrations.statements, core: rental.primary.core },
    jobs: rental.integrations.ledger, notifications: rental.integrations.ledger,
    lifecycle: new RentalApplicationLifecycle(rental, () => database.$disconnect(),
      configuration.get<string>("DATABASE_CONNECT_ON_START") === "true" ? () => database.$connect() : undefined) });
}
