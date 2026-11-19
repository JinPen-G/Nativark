/** 原兼容宿主消费 Rental 包的主应用工厂，所有原服务令牌取得同一对实例。
 * 装配对象不持有生命周期钩子；Nest 在两个实际服务上分别执行恢复和启动预热。 */
import type { Provider } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createRentalPrimaryApplications, type RentalPrimaryApplications } from "@rental-os/rental-core/mysql-primary-application";
import { PrismaService } from "../database/prisma.service";
import { MembershipService } from "../platform/membership.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { EnterprisePolicyService } from "../enterprise/enterprise-policy.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { TenantIntegrationRuntimeService } from "../integrations/tenant-integration.runtime.service";
import { SecretBox } from "../../common/secret-box";
import { RentalCoreService } from "./rental-core.service";
import { RentalBusinessService } from "./rental-business.service";
import { RentalCoreConfigRepository } from "./rental-core-config.repository";
import { RentalCoreFactRepository } from "./rental-core-fact.repository";
import { RentalBusinessConfigRepository } from "./rental-business-config.repository";
import { RentalBusinessFactRepository } from "./rental-business-fact.repository";
import { RentalStateRepository } from "./rental-state.repository";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
import { CapabilityHookRepository } from "./capability-hook.repository";
import { WorkspaceCapabilityService } from "./workspace-capability.service";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import { RentalFundingService } from "./rental-funding.service";
import { RentalCategoryResolver } from "./rental-category-resolver.service";
import { rentalNotificationDraftRetention } from "./rental-notification-log-cache";

export const RENTAL_PRIMARY_APPLICATIONS = Symbol("RENTAL_PRIMARY_APPLICATIONS");

export const RENTAL_PRIMARY_APPLICATION_PROVIDERS: Provider[] = [
  {
    provide: RENTAL_PRIMARY_APPLICATIONS,
    inject: [
      RentalCoreConfigRepository, RentalCoreFactRepository, RentalBusinessConfigRepository,
      RentalBusinessFactRepository, PrismaService, RentalStateRepository, CapabilityHookRuntime,
      WorkspaceCapabilityService, CapabilityHookRepository, MembershipService, RentalServiceCapacityService,
      FileStorageRuntimeService, RentalFundingService, RentalCategoryResolver, CustomerCorporateSettlementService,
      EnterprisePolicyService, TenantIntegrationRuntimeService, SecretBox
    ],
    useFactory: (
      coreConfiguration: RentalCoreConfigRepository, coreFacts: RentalCoreFactRepository,
      businessConfiguration: RentalBusinessConfigRepository, businessFacts: RentalBusinessFactRepository,
      database: PrismaService, state: RentalStateRepository, capabilityHooks: CapabilityHookRuntime,
      capabilities: WorkspaceCapabilityService, capabilityAudits: CapabilityHookRepository,
      memberships: MembershipService, serviceCapacities: RentalServiceCapacityService,
      files: FileStorageRuntimeService, funding: RentalFundingService, categories: RentalCategoryResolver,
      corporateSettlement: CustomerCorporateSettlementService, enterprisePolicies: EnterprisePolicyService,
      notifications: TenantIntegrationRuntimeService, secrets: SecretBox
    ) => createRentalPrimaryApplications<Prisma.TransactionClient>({
      coreConfiguration, coreFacts, businessConfiguration, businessFacts, database, state, capabilityHooks,
      capabilities, capabilityAudits, memberships, serviceCapacities, files, funding, categories,
      corporateSettlement, enterprisePolicies, notifications, secrets,
      notificationDraftRetention: rentalNotificationDraftRetention
    })
  },
  {
    provide: RentalCoreService,
    inject: [RENTAL_PRIMARY_APPLICATIONS],
    useFactory: (applications: RentalPrimaryApplications<Prisma.TransactionClient>) => applications.core
  },
  {
    provide: RentalBusinessService,
    inject: [RENTAL_PRIMARY_APPLICATIONS],
    useFactory: (applications: RentalPrimaryApplications<Prisma.TransactionClient>) => applications.business
  }
];
