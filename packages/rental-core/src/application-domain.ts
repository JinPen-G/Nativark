/** Rental 核心应用组合：原配置/事实仓储、品类、能力、容量、资金和同一对核心/报价服务。
 * 外部身份、客户政策、文件与通知由宿主显式提供；构造不启服务、计时器或自动初始化业务。 */
import { getRequestIdentity, getRequestDataScope, getRequestLocationIds, getRequestUserId } from "@rental-os/platform-server/request-identity";
import { createRentalApplicationRepositories, type RentalRepositoryDatabase,
  type RentalRepositoryTransaction, type RentalRepositoryEvents } from "./application-repositories";
import { createRentalPrimaryApplications, type RentalPrimaryDependencies, type RentalPrimaryTransaction } from "./mysql-primary-application";
import { RentalCategoryResolver, type RentalCategoryStore } from "./category-runtime";
import { WorkspaceCapabilityRepository, type WorkspaceCapabilityStore, type WorkspaceCapabilityTransaction } from "./workspace-capability-repository";
import { WorkspaceCapabilityService } from "./workspace-capabilities";
import { CapabilityHookRepository, type CapabilityHookAuditStore, type CapabilityHookAuditTransaction } from "./capability-audit";
import { CapabilityHookRuntime } from "./capability-runtime";
import { registerRentalCapabilityHooks } from "./capabilities";
import { RentalServiceCapacityService, type RentalServiceCapacityStorage } from "./mysql-service-capacity";
import { RentalFundingService, type RentalFundingStorage } from "./mysql-funding";
import { RentalOrderReceivableRepository, type RentalOrderReceivableStorage, type RentalOrderReceivableTransaction } from "./mysql-order-receivables";
import { requestRentalOrderVisibilityWhere } from "./mysql-core-facts";
import { lockActiveCategoryBinding } from "./mysql-category-write";
import { resolveScopeWorkspaceId } from "./mysql-workspace-scope";
import type { RentalSnapshotConfig } from "./mysql-state";

export type RentalDomainTransaction = RentalRepositoryTransaction & RentalPrimaryTransaction
  & WorkspaceCapabilityTransaction & RentalOrderReceivableTransaction & CapabilityHookAuditTransaction;

export type RentalDomainDatabase<Tx extends RentalDomainTransaction> = RentalRepositoryDatabase<Tx>
  & RentalPrimaryDependencies<Tx>["database"] & RentalCategoryStore & WorkspaceCapabilityStore<Tx>
  & CapabilityHookAuditStore & RentalServiceCapacityStorage<Tx> & RentalFundingStorage<Tx>
  & RentalOrderReceivableStorage<Tx>;

export type RentalDomainDependencies<Tx extends RentalDomainTransaction> = Pick<RentalPrimaryDependencies<Tx>,
  "memberships" | "files" | "corporateSettlement" | "enterprisePolicies" | "notifications" | "secrets" | "notificationDraftRetention">
  & { database: RentalDomainDatabase<Tx>; configuration: RentalSnapshotConfig; events?: RentalRepositoryEvents<Tx> };

/** 先建立资金和事实实例，供客户/企业参加者复用，随后再组合核心与报价，避免循环构造。 */
export function createRentalDomainFoundation<Tx extends RentalDomainTransaction>(input: {
  database: RentalDomainDatabase<Tx>; configuration: RentalSnapshotConfig; events?: RentalRepositoryEvents<Tx>;
}) {
  const { database } = input;
  const repositories = createRentalApplicationRepositories<Tx>(input);
  const categories = new RentalCategoryResolver(database);
  const capabilityRepository = new WorkspaceCapabilityRepository<Tx>(database, {
    currentWorkspaceId: tenantId => resolveScopeWorkspaceId(database, tenantId),
    readWorkspaceScope: (tenantId, workspaceId, transaction) => (transaction ?? database).businessWorkspace.findFirst({
      where: { tenantId, id: workspaceId }, include: { category: { select: { defaultCapabilities: true } } }
    }),
    readWorkspaceRunMode: (tenantId, workspaceId) => database.businessWorkspace.findFirst({
      where: { tenantId, id: workspaceId }, select: { runMode: true }
    }),
    resolveCategory: (tenantId, workspaceId) => categories.forWorkspace(tenantId, workspaceId),
    lockCategoryBinding: (transaction, tenantId, workspaceId, expected) =>
      lockActiveCategoryBinding(transaction, tenantId, workspaceId, expected)
  });
  const capabilities = new WorkspaceCapabilityService<Tx>(capabilityRepository);
  const capabilityAudits = new CapabilityHookRepository(database);
  const capabilityHooks = new CapabilityHookRuntime<Tx>(capabilities, capabilityAudits);
  const serviceCapacities = new RentalServiceCapacityService<Tx>(database, { getRequestIdentity, resolveWorkspaceId: resolveScopeWorkspaceId });
  const receivables = new RentalOrderReceivableRepository<Tx>(database);
  const funding = new RentalFundingService<Tx>(database, {
    getRequestIdentity,
    requestRentalOrderVisibilityWhere: () => requestRentalOrderVisibilityWhere({ getRequestDataScope, getRequestLocationIds, getRequestUserId })
  }, receivables);
  // 对每个应用实例只登记一次正式Hook；无业务读写，且早于宿主开放HTTP或启动worker。
  registerRentalCapabilityHooks(capabilityHooks);
  return Object.freeze({ ...repositories, categories, capabilityRepository,
    capabilities, capabilityAudits, capabilityHooks, serviceCapacities, receivables, funding });
}

export function createRentalDomainApplication<Tx extends RentalDomainTransaction>(input: RentalDomainDependencies<Tx>) {
  const foundation = createRentalDomainFoundation<Tx>(input);
  return Object.freeze({ ...foundation, ...createRentalPrimaryApplications<Tx>({ ...input, ...foundation }) });
}

export type RentalDomainFoundation<Tx extends RentalDomainTransaction> = ReturnType<typeof createRentalDomainFoundation<Tx>>;
export type RentalDomainApplication<Tx extends RentalDomainTransaction> = ReturnType<typeof createRentalDomainApplication<Tx>>;
