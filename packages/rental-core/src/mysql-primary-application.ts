/** Rental 的核心与报价/营销应用装配入口，共用宿主提供的事务、配置和真实参加者。
 * 只构造一对原领域服务，不执行恢复、Seed、迁移或定时任务；生命周期由宿主调用。
 * 业务服务同时作为核心的续租价格来源，避免两套缓存、隐私读取器或金额裁定。 */
import { RentalCoreService } from "./mysql-core-runtime";
import { RentalBusinessService } from "./mysql-business-runtime";
import type { RentalConfigStore } from "./mysql-core-configuration";
import type { RentalCoreFactStore } from "./mysql-core-facts";
import type { RentalBusinessConfigStore } from "./mysql-business-configuration";
import type { RentalBusinessFactStore } from "./mysql-business-facts";
import type { RentalStateRepository } from "./mysql-state";
import type { CapabilityHookRuntime } from "./capability-runtime";
import type { CapabilityHookRepository } from "./capability-audit";
import type { WorkspaceCapabilityService } from "./workspace-capabilities";
import type { RentalServiceCapacityService } from "./mysql-service-capacity";
import type { RentalFundingService } from "./mysql-funding";
import type { RentalCategoryResolver } from "./category-runtime";
import type { RentalNotificationDraftRetention } from "./notification-draft";
import type {
  RentalCoreRuntimeTransaction, RentalCoreMemberships, RentalCoreCorporateSettlement,
  RentalCoreEnterprisePolicies, RentalCoreFileStorage
} from "./core-runtime-ports";
import type {
  RentalBusinessRuntimeTransaction, RentalBusinessRuntimeStorage, RentalBusinessMemberships,
  RentalBusinessCorporateSettlement, RentalBusinessNotifications, RentalBusinessSecretBox
} from "./business-runtime-ports";

export type RentalPrimaryTransaction = RentalCoreRuntimeTransaction & RentalBusinessRuntimeTransaction;

export interface RentalPrimaryDependencies<TTransaction extends RentalPrimaryTransaction> {
  coreConfiguration: RentalConfigStore<TTransaction> & Required<Pick<RentalConfigStore<TTransaction>, "loadWorkspaceSnapshot">>;
  coreFacts: RentalCoreFactStore<TTransaction>;
  businessConfiguration: RentalBusinessConfigStore<TTransaction>;
  businessFacts: RentalBusinessFactStore<TTransaction>;
  database: RentalBusinessRuntimeStorage<TTransaction>;
  state: RentalStateRepository<TTransaction>;
  capabilityHooks: CapabilityHookRuntime<TTransaction>;
  capabilities: WorkspaceCapabilityService<TTransaction>;
  capabilityAudits: CapabilityHookRepository;
  memberships: RentalCoreMemberships<TTransaction> & RentalBusinessMemberships<TTransaction>;
  serviceCapacities: RentalServiceCapacityService<TTransaction>;
  files: RentalCoreFileStorage;
  funding: RentalFundingService<TTransaction>;
  categories: RentalCategoryResolver;
  corporateSettlement: RentalCoreCorporateSettlement<TTransaction> & RentalBusinessCorporateSettlement;
  enterprisePolicies: RentalCoreEnterprisePolicies<TTransaction>;
  notifications: RentalBusinessNotifications;
  secrets: RentalBusinessSecretBox;
  notificationDraftRetention: RentalNotificationDraftRetention;
}

export interface RentalPrimaryApplications<TTransaction extends RentalPrimaryTransaction> {
  readonly core: RentalCoreService<TTransaction>;
  readonly business: RentalBusinessService<TTransaction>;
}

const dependencyNames = [
  "coreConfiguration", "coreFacts", "businessConfiguration", "businessFacts", "database", "state",
  "capabilityHooks", "capabilities", "capabilityAudits", "memberships", "serviceCapacities", "files",
  "funding", "categories", "corporateSettlement", "enterprisePolicies", "notifications", "secrets",
  "notificationDraftRetention"
] as const;

/** 标准宿主须显式提供原生产依赖；旧服务的可选构造参数只保留给直接构造的兼容消费者。 */
export function createRentalPrimaryApplications<TTransaction extends RentalPrimaryTransaction>(
  dependencies: RentalPrimaryDependencies<TTransaction>
): RentalPrimaryApplications<TTransaction> {
  for (const name of dependencyNames) {
    if (dependencies[name] == null) throw new Error(`Rental Core 装配缺少依赖: ${name}`);
  }

  const business = new RentalBusinessService<TTransaction>(
    dependencies.businessConfiguration, dependencies.businessFacts, dependencies.coreConfiguration,
    dependencies.state, dependencies.database, dependencies.capabilityHooks, dependencies.capabilities,
    dependencies.capabilityAudits, dependencies.serviceCapacities, dependencies.memberships,
    dependencies.notifications, dependencies.secrets, dependencies.categories,
    dependencies.corporateSettlement, dependencies.notificationDraftRetention
  );
  const core = new RentalCoreService<TTransaction>(
    dependencies.coreConfiguration, dependencies.coreFacts, dependencies.state, dependencies.capabilityHooks,
    dependencies.memberships, dependencies.serviceCapacities, dependencies.files, dependencies.funding,
    dependencies.categories, dependencies.corporateSettlement, dependencies.businessConfiguration,
    dependencies.enterprisePolicies, business
  );
  return Object.freeze({ core, business });
}
