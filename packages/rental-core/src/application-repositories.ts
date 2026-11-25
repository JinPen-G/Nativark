/** Rental 标准应用的仓储组合：同一数据库、Auth/ALS、品类锁与事务事件。
 * 只构造原仓储，不初始化空间、连接数据库或恢复快照；宿主继续负责请求授权和生命周期。 */
import {
  getRequestDataScope, getRequestIdentity, getRequestLocationIds, getRequestStaffLocationIds,
  getRequestTenantId, getRequestUserId, getRequestWorkspaceId, staffLocationWhere
} from "@rental-os/platform-server/request-identity";
import { enabledOrganizationSubtreeIds } from "@rental-os/platform-server/organization-location-scope";
import { RentalCoreConfigRepository, type RentalCoreConfigurationStorage,
  type RentalCoreConfigurationTransaction, type RentalCoreConfigurationContacts } from "./mysql-core-configuration";
import { RentalBusinessConfigRepository, type RentalBusinessConfigurationStorage,
  type RentalBusinessConfigurationTransaction } from "./mysql-business-configuration";
import { RentalCoreFactRepository, requestRentalOrderVisibilityWhere } from "./mysql-core-facts";
import type { RentalCoreFactStorage, RentalCoreFactTransaction, RentalCoreFactContacts } from "./core-fact-storage";
import { RentalBusinessFactRepository, createRentalQuoteConfigurationReader } from "./mysql-business-facts";
import type { RentalBusinessFactStorage, RentalBusinessFactTransaction, RentalBusinessFactContacts } from "./business-fact-storage";
import { RentalStateRepository, type RentalSnapshotStore, type RentalSnapshotConfig,
  type RentalSnapshotTransaction } from "./mysql-state";
import { RentalIdempotencyRepository, type RentalIdempotencyTransaction } from "./mysql-idempotency";
import { RentalIdempotentActionService, type RentalActionTransactionStore } from "./mysql-idempotent-actions";
import { assertScopedWrite, resolveScopeWorkspaceId } from "./mysql-workspace-scope";
import { lockActiveCategoryBinding } from "./mysql-category-write";

export type RentalRepositoryTransaction = RentalCoreConfigurationTransaction & RentalBusinessConfigurationTransaction
  & RentalCoreFactTransaction & RentalBusinessFactTransaction & RentalSnapshotTransaction & RentalIdempotencyTransaction;

/** 生成客户端留在宿主；此交集仅描述这些原仓储实际使用的私有数据库能力。 */
export type RentalRepositoryDatabase<Tx extends RentalRepositoryTransaction> = RentalCoreConfigurationStorage<Tx>
  & RentalBusinessConfigurationStorage<Tx> & RentalCoreFactStorage<Tx> & RentalBusinessFactStorage<Tx>
  & RentalSnapshotStore<Tx> & RentalIdempotencyTransaction & RentalActionTransactionStore<Tx>;

export interface RentalRepositoryEvents<Tx extends RentalRepositoryTransaction> {
  openingConfiguration?: RentalCoreConfigurationContacts<Tx>["openingConfiguration"];
  inspection?: NonNullable<RentalCoreFactContacts<Tx>["events"]>["inspection"];
  notification?: NonNullable<RentalBusinessFactContacts<Tx>["events"]>["notification"];
}

export function createRentalApplicationRepositories<Tx extends RentalRepositoryTransaction>(input: {
  database: RentalRepositoryDatabase<Tx>;
  configuration: RentalSnapshotConfig;
  events?: RentalRepositoryEvents<Tx>;
}) {
  if (!input.database || !input.configuration || typeof input.configuration.get !== "function") {
    throw new Error("Rental 仓储装配需要同一真实数据库与配置读取器");
  }
  const { database, configuration, events } = input;
  // 绑定原参加者，避免抽取方法时丢失其 this；事件失败继续导致原事务回滚。
  const openingConfiguration = events?.openingConfiguration?.bind(events);
  const inspection = events?.inspection?.bind(events);
  const notification = events?.notification?.bind(events);
  const coreConfiguration = new RentalCoreConfigRepository<Tx>(database, {
    getRequestTenantId, getRequestWorkspaceId, getRequestStaffLocationIds, staffLocationWhere,
    resolveWorkspaceId: resolveScopeWorkspaceId, assertScopedWrite, openingConfiguration
  });
  const businessConfiguration = new RentalBusinessConfigRepository<Tx>(database, {
    getRequestTenantId, getRequestWorkspaceId, getRequestIdentity,
    resolveWorkspaceId: resolveScopeWorkspaceId, assertScopedWrite, openingConfiguration,
    lockCategoryBinding: (transaction, tenantId, workspaceId, expected, categoryCode) =>
      lockActiveCategoryBinding(transaction, tenantId, workspaceId, expected, categoryCode)
  });
  const orderVisibilityWhere = () => requestRentalOrderVisibilityWhere({
    getRequestDataScope, getRequestLocationIds, getRequestUserId
  });
  const coreFacts = new RentalCoreFactRepository<Tx>(database, {
    getRequestDataScope, getRequestIdentity, getRequestLocationIds, getRequestUserId, getRequestWorkspaceId,
    resolveWorkspaceId: resolveScopeWorkspaceId, enabledOrganizationSubtreeIds,
    ...(inspection ? { events: { inspection } } : {})
  });
  const businessFacts = new RentalBusinessFactRepository<Tx>(database, {
    resolveWorkspaceId: resolveScopeWorkspaceId, orderVisibilityWhere,
    // 报价和核心使用同一配置仓储；不能另外构造带不同事件或配置来源的实例。
    quoteConfiguration: coreConfiguration,
    quoteConfigurationBasis: createRentalQuoteConfigurationReader<Tx>(coreConfiguration, businessConfiguration),
    ...(notification ? { events: { notification } } : {})
  });
  const state = new RentalStateRepository<Tx>(database, configuration, {
    lockCategoryBinding: (transaction, tenantId, workspaceId, expected) =>
      lockActiveCategoryBinding(transaction, tenantId, workspaceId, expected),
    openingConfiguration
  });
  const receipts = new RentalIdempotencyRepository<Tx>(database, {
    workspaceId: (tenantId, transaction) => resolveScopeWorkspaceId(transaction ?? database, tenantId)
  });
  const idempotent = new RentalIdempotentActionService<Tx>(database, receipts);
  return Object.freeze({ coreConfiguration, businessConfiguration, coreFacts, businessFacts, state, receipts, idempotent });
}

export type RentalApplicationRepositories<Tx extends RentalRepositoryTransaction> =
  ReturnType<typeof createRentalApplicationRepositories<Tx>>;
