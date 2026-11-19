/** 原报价/营销服务令牌与直接构造兼容入口，保留原参数与通知正文维护参加者。
 * 正式宿主从主应用工厂取得同一实例，恢复和预热继续沿 Nest 的两个阶段。 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { rentalNotificationDraftRetention } from "./rental-notification-log-cache";
export { RentalNotificationDraftUnknownError } from "@rental-os/rental-core/notification-draft";
export type { RentalNotificationDraftInput, RentalNotificationDraftOriginal, RentalNotificationDraftObservation } from "@rental-os/rental-core/notification-draft";
import { RentalBusinessService as CoreRentalBusinessService } from "@rental-os/rental-core/mysql-business-runtime";
import { RentalBusinessConfigRepository, type RentalBusinessConfigStore } from "./rental-business-config.repository";
import { RentalBusinessFactRepository, type RentalBusinessFactStore } from "./rental-business-fact.repository";
import { RentalCoreConfigRepository, type RentalConfigStore } from "./rental-core-config.repository";
import { RentalStateRepository } from "./rental-state.repository";
import { PrismaService } from "../database/prisma.service";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
import { WorkspaceCapabilityService } from "./workspace-capability.service";
import { CapabilityHookRepository } from "./capability-hook.repository";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import { MembershipService } from "../platform/membership.service";
import { TenantIntegrationRuntimeService } from "../integrations/tenant-integration.runtime.service";
import { SecretBox } from "../../common/secret-box";
import { RentalCategoryResolver } from "./rental-category-resolver.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
export type { RentalBusinessContext as BusinessContext } from "@rental-os/rental-core/configuration-basis";

@Injectable()
export class RentalBusinessService extends CoreRentalBusinessService<Prisma.TransactionClient> {
  constructor(
    @Inject(RentalBusinessConfigRepository) configStore: RentalBusinessConfigStore,
    @Inject(RentalBusinessFactRepository) factStore: RentalBusinessFactStore,
    @Inject(RentalCoreConfigRepository) coreConfigStore: RentalConfigStore,
    @Optional() stateRepository?: RentalStateRepository,
    @Optional() prisma?: PrismaService,
    @Optional() hooks?: CapabilityHookRuntime,
    @Optional() capabilities?: WorkspaceCapabilityService,
    @Optional() hookAudits?: CapabilityHookRepository,
    @Optional() serviceCapacities?: RentalServiceCapacityService,
    @Optional() memberships?: MembershipService,
    @Optional() notificationRuntime?: TenantIntegrationRuntimeService,
    @Optional() secretBox?: SecretBox,
    categoryResolver?: RentalCategoryResolver,
    @Optional() corporateSettlement?: CustomerCorporateSettlementService
  ) {
    super(configStore, factStore, coreConfigStore, stateRepository, prisma, hooks, capabilities, hookAudits,
      serviceCapacities, memberships, notificationRuntime, secretBox, categoryResolver, corporateSettlement, rentalNotificationDraftRetention);
  }
}
