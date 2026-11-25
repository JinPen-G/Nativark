/** 原组合宿主的 AI 正式包接线：只引用现有 provider，不创建第二 Auth/Guard/数据库或 Rental 生命周期。 */
import type { Provider } from "@nestjs/common";
import { PrismaService as LegacyPrismaService } from "./modules/database/prisma.service";
import { PrismaService as PackagePrismaService } from "@rental-os/ai-native-server/runtime/rental-adapters/prisma.service";
import { AuthService as LegacyAuthService } from "./modules/auth/auth.service";
import { AuthService as PackageAuthService } from "@rental-os/ai-native-server/runtime/rental-adapters/auth.service";
import { ApiAuthGuard as LegacyApiAuthGuard } from "./common/api-auth.guard";
import { ApiAuthGuard as PackageApiAuthGuard } from "@rental-os/ai-native-server/runtime/rental-adapters/api-auth.guard";
import { OperationLogService as LegacyOperationLogService } from "./common/operation-log.service";
import { OperationLogService as PackageOperationLogService } from "@rental-os/ai-native-server/runtime/rental-adapters/operation-log.service";
import { SubscriptionService as LegacySubscriptionService } from "./modules/subscription/subscription.service";
import { SubscriptionService as PackageSubscriptionService } from "@rental-os/platform-server/subscription";
import { ClientDeliveryAddressService as LegacyClientDeliveryAddressService } from "./modules/client/client-delivery-address.service";
import { ClientDeliveryAddressService as PackageClientDeliveryAddressService } from "@rental-os/rental-core/mysql-client-delivery-address";
import { ClientAuthService as LegacyClientAuthService } from "./modules/client/client-auth.service";
import { ClientAuthService as PackageClientAuthService } from "@rental-os/rental-core/mysql-client-auth";
import { RentalCoreService as LegacyRentalCoreService } from "./modules/rental-core/rental-core.service";
import { RentalCoreService as PackageRentalCoreService } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-core.service";
import { WorkspaceCapabilityService as LegacyWorkspaceCapabilityService } from "./modules/rental-core/workspace-capability.service";
import { WorkspaceCapabilityService as PackageWorkspaceCapabilityService } from "@rental-os/ai-native-server/runtime/rental-adapters/workspace-capability.service";
import { RentalOrderConfirmationService as LegacyRentalOrderConfirmationService } from "./modules/rental-core/rental-order-confirmation.service";
import { RentalOrderConfirmationService as PackageRentalOrderConfirmationService } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-order-confirmation.service";
import { EnterpriseMerchantDelegationService as LegacyEnterpriseMerchantDelegationService } from "./modules/enterprise/enterprise-merchant-delegation.service";
import { EnterpriseMerchantDelegationService as PackageEnterpriseMerchantDelegationService } from "@rental-os/rental-core/mysql-enterprise-merchant-delegation";
import { RentalBusinessFactRepository as LegacyRentalBusinessFactRepository } from "./modules/rental-core/rental-business-fact.repository";
import { RentalBusinessFactRepository as PackageRentalBusinessFactRepository } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-business-fact.repository";
import { RentalCoreFactRepository as LegacyRentalCoreFactRepository } from "./modules/rental-core/rental-core-fact.repository";
import { RentalCoreFactRepository as PackageRentalCoreFactRepository } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-core-fact.repository";
import { RentalAllocationService as LegacyRentalAllocationService } from "./modules/rental-core/rental-allocation.service";
import { RentalAllocationService as PackageRentalAllocationService } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-allocation.service";
import { RentalCoreConfigRepository as LegacyRentalCoreConfigRepository } from "./modules/rental-core/rental-core-config.repository";
import { RentalCoreConfigRepository as PackageRentalCoreConfigRepository } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-core-config.repository";
import { RentalBusinessConfigRepository as LegacyRentalBusinessConfigRepository } from "./modules/rental-core/rental-business-config.repository";
import { RentalBusinessConfigRepository as PackageRentalBusinessConfigRepository } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-business-config.repository";
import { RentalIdempotencyRepository as LegacyRentalIdempotencyRepository } from "./modules/rental-core/rental-idempotency.repository";
import { RentalIdempotencyRepository as PackageRentalIdempotencyRepository } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-idempotency.repository";
import { RentalBusinessService as LegacyRentalBusinessService } from "./modules/rental-core/rental-business.service";
import { RentalBusinessService as PackageRentalBusinessService } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-business.service";
import { RentalFundingService as LegacyRentalFundingService } from "./modules/rental-core/rental-funding.service";
import { RentalFundingService as PackageRentalFundingService } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-funding.service";
import { RentalWorkspaceReportRepository as LegacyRentalWorkspaceReportRepository } from "./modules/rental-core/rental-workspace-report.repository";
import { RentalWorkspaceReportRepository as PackageRentalWorkspaceReportRepository } from "@rental-os/rental-core/mysql-reports";
import { MembershipService as LegacyMembershipService } from "./modules/platform/membership.service";
import { MembershipService as PackageMembershipService } from "@rental-os/rental-core/mysql-membership";
import { PlatformService as LegacyPlatformService } from "./modules/platform/platform.service";
import { PlatformService as PackagePlatformService } from "@rental-os/ai-native-server/runtime/rental-adapters/platform.service";
import { PaymentRuntimeService as LegacyPaymentRuntimeService } from "./modules/integrations/payment.runtime.service";
import { PaymentRuntimeService as PackagePaymentRuntimeService } from "@rental-os/ai-native-server/runtime/rental-adapters/payment.runtime.service";
import { ClientApiService as LegacyClientApiService } from "./modules/client/client-api.service";
import { ClientApiService as PackageClientApiService } from "@rental-os/rental-core/mysql-client-application";
import { FileStorageRuntimeService as LegacyFileStorageRuntimeService } from "./modules/integrations/file-storage.runtime.service";
import { FileStorageRuntimeService as PackageFileStorageRuntimeService } from "@rental-os/ai-native-server/runtime/rental-adapters/file-storage.runtime.service";
import { TenantIntegrationService as LegacyTenantIntegrationService } from "./modules/integrations/tenant-integration.service";
import { TenantIntegrationService as PackageTenantIntegrationService } from "@rental-os/platform-server/tenant-integration";
import { SharedCustomerRepository as LegacySharedCustomerRepository } from "./modules/platform/shared-customer.repository";
import { SharedCustomerRepository as PackageSharedCustomerRepository } from "@rental-os/rental-core/mysql-customer-master";
import { RentalIdempotentActionService as LegacyRentalIdempotentActionService } from "./modules/rental-core/rental-idempotent-action.service";
import { RentalIdempotentActionService as PackageRentalIdempotentActionService } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-idempotent-action.service";

export const AI_NATIVE_LEGACY_SERVICE_ALIASES: Provider[] = [
  { provide: PackagePrismaService, useExisting: LegacyPrismaService },
  { provide: PackageAuthService, useExisting: LegacyAuthService },
  { provide: PackageApiAuthGuard, useExisting: LegacyApiAuthGuard },
  { provide: PackageOperationLogService, useExisting: LegacyOperationLogService },
  { provide: PackageSubscriptionService, useExisting: LegacySubscriptionService },
  { provide: PackageClientDeliveryAddressService, useExisting: LegacyClientDeliveryAddressService },
  { provide: PackageClientAuthService, useExisting: LegacyClientAuthService },
  { provide: PackageRentalCoreService, useExisting: LegacyRentalCoreService },
  { provide: PackageWorkspaceCapabilityService, useExisting: LegacyWorkspaceCapabilityService },
  { provide: PackageRentalOrderConfirmationService, useExisting: LegacyRentalOrderConfirmationService },
  { provide: PackageEnterpriseMerchantDelegationService, useExisting: LegacyEnterpriseMerchantDelegationService },
  { provide: PackageRentalBusinessFactRepository, useExisting: LegacyRentalBusinessFactRepository },
  { provide: PackageRentalCoreFactRepository, useExisting: LegacyRentalCoreFactRepository },
  { provide: PackageRentalAllocationService, useExisting: LegacyRentalAllocationService },
  { provide: PackageRentalCoreConfigRepository, useExisting: LegacyRentalCoreConfigRepository },
  { provide: PackageRentalBusinessConfigRepository, useExisting: LegacyRentalBusinessConfigRepository },
  { provide: PackageRentalIdempotencyRepository, useExisting: LegacyRentalIdempotencyRepository },
  { provide: PackageRentalBusinessService, useExisting: LegacyRentalBusinessService },
  { provide: PackageRentalFundingService, useExisting: LegacyRentalFundingService },
  { provide: PackageRentalWorkspaceReportRepository, useExisting: LegacyRentalWorkspaceReportRepository },
  { provide: PackageMembershipService, useExisting: LegacyMembershipService },
  { provide: PackagePlatformService, useExisting: LegacyPlatformService },
  { provide: PackagePaymentRuntimeService, useExisting: LegacyPaymentRuntimeService },
  { provide: PackageClientApiService, useExisting: LegacyClientApiService },
  { provide: PackageFileStorageRuntimeService, useExisting: LegacyFileStorageRuntimeService },
  { provide: PackageTenantIntegrationService, useExisting: LegacyTenantIntegrationService },
  { provide: PackageSharedCustomerRepository, useExisting: LegacySharedCustomerRepository },
  { provide: PackageRentalIdempotentActionService, useExisting: LegacyRentalIdempotentActionService },
];
