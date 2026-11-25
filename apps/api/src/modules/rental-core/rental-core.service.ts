/** 原核心服务令牌与直接构造兼容入口，保留原参数及 Rental 单源算法。
 * 正式宿主从 rental-primary-application.providers 取得实例，恢复和预热仍由 Nest 执行。 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalCoreService as CoreRentalCoreService } from "@rental-os/rental-core/mysql-core-runtime";
import { RentalCoreConfigRepository, type RentalConfigStore } from "./rental-core-config.repository";
import { RentalCoreFactRepository, type RentalCoreFactStore } from "./rental-core-fact.repository";
import { RentalStateRepository } from "./rental-state.repository";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
import { MembershipService } from "../platform/membership.service";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { RentalFundingService } from "./rental-funding.service";
import { RentalCategoryResolver } from "./rental-category-resolver.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { RentalBusinessConfigRepository, type RentalBusinessConfigStore } from "./rental-business-config.repository";
import { EnterprisePolicyService } from "../enterprise/enterprise-policy.service";
import { RentalBusinessService } from "./rental-business.service";

export { RENTAL_PENDING_PAYMENT_TIMEOUT_REASON } from "@rental-os/rental-core/mysql-core-runtime";

@Injectable()
export class RentalCoreService extends CoreRentalCoreService<Prisma.TransactionClient> {
  constructor(
    @Inject(RentalCoreConfigRepository) configStore: RentalConfigStore,
    @Inject(RentalCoreFactRepository) factStore: RentalCoreFactStore,
    @Optional() stateRepository?: RentalStateRepository,
    @Optional() hooks?: CapabilityHookRuntime,
    @Optional() memberships?: MembershipService,
    @Optional() serviceCapacities?: RentalServiceCapacityService,
    @Optional() fileStorage?: FileStorageRuntimeService,
    @Optional() funding?: RentalFundingService,
    categoryResolver?: RentalCategoryResolver,
    @Optional() corporateSettlement?: CustomerCorporateSettlementService,
    @Optional() @Inject(RentalBusinessConfigRepository) businessConfigStore?: RentalBusinessConfigStore,
    @Optional() enterprisePolicies?: EnterprisePolicyService,
    @Optional() extensionPrices?: RentalBusinessService
  ) {
    super(configStore, factStore, stateRepository, hooks, memberships, serviceCapacities, fileStorage,
      funding, categoryResolver, corporateSettlement, businessConfigStore, enterprisePolicies, extensionPrices);
  }
}
