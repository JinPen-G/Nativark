import { AI_NATIVE_LEGACY_SERVICE_ALIASES } from "./ai-native-legacy.providers";
/** 原组合宿主的服务依赖模块，保留同一数据库、身份、审计、Rental 和 AI 实例。
 * 只集中已有 provider 与生命周期；业务 HTTP 由正式 Rental 模块挂载，环境加载与监听仍由 main 负责。 */

import { AI_NATIVE_CATEGORY_PROPOSAL_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_BODY_DATABASE_PROVIDER } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_AUTOMATION_EXPLANATION_PROVIDER } from './modules/ai-native/ai-native-application.providers';


import { AI_NATIVE_TASK_CENTER_RECOVERY_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_ORIGINAL_ORDER_ANSWER_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_TASK_OPENING_PROPOSAL_PROVIDER } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_TASK_ORIGINAL_READ_POLICY_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_TASK_READ_POLICY_PROVIDER } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_TASK_ORDER_HANDOFF_PROVIDER } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_TASK_CALENDAR_DRAFT_PROVIDER } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_MEMBER_NAME_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { Module } from "@nestjs/common";
import { PLATFORM_APPEARANCE_DATA_STORE, LEGACY_TENANT_APPEARANCE_READER } from "./modules/platform/platform-appearance-data-store";
import { PrismaService } from "./modules/database/prisma.service";
import { AiDesktopBusinessModule } from './modules/ai-native/desktop-business/desktop-business.module';
import { APP_GUARD, APP_INTERCEPTOR, ModuleRef } from "@nestjs/core";
import { ApiAuthGuard } from "./common/api-auth.guard";
import { ConfigModule } from "@nestjs/config";
import { OperationAuditInterceptor } from "./common/operation-audit.interceptor";
import { OperationLogService } from "./common/operation-log.service";
import { RequestIdInterceptor } from "./common/request-id.interceptor";

import { AuthService } from "./modules/auth/auth.service";


import { IntegrationsRepository } from "./modules/integrations/integrations.repository";
import { IntegrationsService } from "./modules/integrations/integrations.service";
import { JOBS_HTTP_APPLICATION } from "@rental-os/platform-server/jobs";
import { NOTIFICATIONS_HTTP_APPLICATION } from "@rental-os/platform-server/notifications";
import { RENTAL_INTEGRATIONS_HTTP_APPLICATION } from "@rental-os/rental-core/http-integrations";
import { RENTAL_CUSTOMERS_HTTP_APPLICATION } from "@rental-os/rental-core/http-customers";

import { TenantIntegrationConnectivityService } from "./modules/integrations/tenant-integration.connectivity.service";
import { TenantIntegrationService } from "./modules/integrations/tenant-integration.service";
import { TENANT_INTEGRATION_APPLICATION, TENANT_INTEGRATION_CONNECTIVITY } from "@rental-os/platform-server/integration-store";
import { TenantIntegrationRuntimeService } from "./modules/integrations/tenant-integration.runtime.service";
import { TenantEmailRuntimeService } from "./modules/integrations/tenant-email.runtime.service";
import { TenantDispatchService } from "./modules/notifications/tenant-dispatch.service";
import { TenantOperatorInvitationsService } from "./modules/notifications/tenant-operator-invitations.service";

import { TenantSupportEmailService } from "./modules/notifications/tenant-support-email.service";
import { FileStorageRuntimeService } from "./modules/integrations/file-storage.runtime.service";
import { RENTAL_FILE_AUTHORITY } from "./modules/integrations/rental-file-application.participant";
import { FileBusinessAccessService } from "./modules/files/file-business-access.service";
import { PaymentRuntimeService } from "./modules/integrations/payment.runtime.service";

import { PaymentReconciliationFileService } from "./modules/integrations/payment-reconciliation-file.service";
import { SecretBox } from "./common/secret-box";

import { DatabaseModule } from "./modules/database/database.module";

import { PlatformRepository } from "./modules/platform/platform.repository";
import { PLATFORM_AUTH_DATA_STORE } from "@rental-os/platform-server/auth-store";
import { PlatformManagementService } from "@rental-os/platform-server/management";
import { PlatformToolsService } from "@rental-os/platform-server/tools";
import { SharedCustomerRepository } from "./modules/platform/shared-customer.repository";
import { CustomerOperationsRepository } from "./modules/platform/customer-operations.repository";
import { CustomerRegistrationService } from "./modules/platform/customer-registration.service";
import { CustomerOperationsService } from "./modules/platform/customer-operations.service";
import { CustomerMergeService } from "./modules/platform/customer-merge.service";
import { CustomerCorporateService } from "./modules/platform/customer-corporate.service";
import { CustomerCorporateSettlementService } from "./modules/platform/customer-corporate-settlement.service";
import { MembershipService } from "./modules/platform/membership.service";
import { EnterprisePortalService } from "./modules/platform/enterprise-portal.service";
import { EnterpriseAccessService } from "./modules/client/enterprise-access.service";
import { EnterpriseCommandService } from "./modules/enterprise/enterprise-command.service";
import { EnterpriseApplicationService } from "./modules/enterprise/enterprise-application.service";
import { EnterpriseRentalHandoffService } from "./modules/enterprise/enterprise-rental-handoff.service";
import { EnterpriseMembershipAuditService } from "./modules/enterprise/enterprise-membership-audit.service";
import { EnterpriseMembersService } from "./modules/enterprise/enterprise-members.service";
import { EnterprisePolicyService } from "./modules/enterprise/enterprise-policy.service";
import { EnterpriseApprovalService } from "./modules/enterprise/enterprise-approval.service";
import { EnterpriseMerchantDelegationService } from "./modules/enterprise/enterprise-merchant-delegation.service";
import { EnterpriseMerchantOrderSubmissionService } from "./modules/enterprise/enterprise-merchant-order-submission.service";
import { EnterpriseExchangeApprovalService } from "./modules/enterprise/enterprise-exchange-approval.service";
import { EnterpriseExtensionApprovalService } from "./modules/enterprise/enterprise-extension-approval.service";
import { EnterpriseTaskCenterService } from "./modules/enterprise/enterprise-task-center.service";
import { EnterpriseManagementRequestService } from "./modules/enterprise/enterprise-management-request.service";
import { EnterpriseOrderReaderService } from "./modules/enterprise/enterprise-order-reader.service";
import { CustomerAvatarService } from "./modules/platform/customer-avatar.service";
import { PlatformService } from "./modules/platform/platform.service";
import { RentalExchangePreviewService } from "./modules/rental-core/rental-exchange-preview.service";
import { RentalExchangeInspectionPreparationService } from "./modules/rental-core/rental-exchange-inspection-preparation.service";
import { RentalExchangeInspectionConsentService } from "./modules/rental-core/rental-exchange-inspection-consent.service";
import { RentalApprovedExchangeService } from "./modules/rental-core/rental-approved-exchange.service";
import { RentalExchangeInspectionMediaService } from "./modules/rental-core/rental-exchange-inspection-media.service";
import { RentalCategoryResolver } from "./modules/rental-core/rental-category-resolver.service";
import { CategoryGovernanceService } from "./modules/rental-core/category-governance.service";
import { CategoryAdoptionPreparationService } from "./modules/rental-core/category-adoption-preparation.service";
import { CategoryAdoptionApplication } from "./modules/rental-core/category-adoption.application";
import { RentalAllocationService } from "./modules/rental-core/rental-allocation.service";
import { RentalDueJobScheduler } from "./modules/rental-core/rental-due-job.scheduler";

import { OfficialCalendarSourceService } from "./modules/rental-core/official-calendar-source.service";
import { OFFICIAL_CALENDAR_DATA_STORE, OFFICIAL_CALENDAR_APPLICATION } from "@rental-os/platform-server/official-calendar-store";
import { OFFICIAL_CALENDAR_SOURCE_READER, createOfficialCalendarSourceReader } from "@rental-os/platform-server/official-calendar-reader";
import { RentalStateRepository } from "./modules/rental-core/rental-state.repository";
import { RentalSnapshotBackfillService } from "./modules/rental-core/rental-snapshot-backfill.service";
import { RentalCoreConfigRepository } from "./modules/rental-core/rental-core-config.repository";
import { RentalCoreFactRepository } from "./modules/rental-core/rental-core-fact.repository";
import { RentalWorkspaceReportRepository } from "./modules/rental-core/rental-workspace-report.repository";
import { RentalBusinessConfigRepository } from "./modules/rental-core/rental-business-config.repository";
import { RentalBusinessFactRepository } from "./modules/rental-core/rental-business-fact.repository";
import { RentalIdempotencyRepository } from "./modules/rental-core/rental-idempotency.repository";
import { RentalIdempotentActionService } from "./modules/rental-core/rental-idempotent-action.service";
import { RentalFundingService } from "./modules/rental-core/rental-funding.service";
import { RentalOrderReceivableRepository } from "./modules/rental-core/rental-order-receivable.repository";
import { StaffOfflinePaymentService } from "./modules/rental-core/staff-offline-payment.service";
import { RentalDocumentService } from "./modules/rental-core/rental-document.service";
import { RentalOrderConfirmationService } from "./modules/rental-core/rental-order-confirmation.service";
import { RENTAL_HTTP_PROVIDERS } from "./modules/rental-core/rental-http.providers";
import { RENTAL_PRIMARY_APPLICATION_PROVIDERS } from "./modules/rental-core/rental-primary-application.providers";
import { RENTAL_ENTERPRISE_HTTP_PROVIDERS } from "./modules/enterprise/enterprise-http.providers";
import { RENTAL_STAFF_HTTP_PROVIDERS } from "./modules/files/staff-http.providers";
import { RENTAL_FILE_HTTP_PROVIDERS } from "./modules/files/file-http.providers";
import { RENTAL_CLIENT_HTTP_PROVIDERS } from "./modules/client/client-http.providers";
import { RENTAL_CHANNEL_HTTP_PROVIDERS } from "./modules/client/channel-http.providers";
import { RENTAL_CATEGORY_HTTP_PROVIDERS } from "./modules/rental-core/category-http.providers";
import { WorkspaceCapabilityRepository } from "./modules/rental-core/workspace-capability.repository";
import { WorkspaceCapabilityService } from "./modules/rental-core/workspace-capability.service";
import { CapabilityHookRuntime } from "./modules/rental-core/capability-hook.runtime";
import { CapabilityHookRepository } from "./modules/rental-core/capability-hook.repository";
import { CapabilityHookRegistrar } from "./modules/rental-core/capability-hook.registrar";
import { RentalServiceCapacityService } from "./modules/rental-core/rental-service-capacity.service";

import { ClientApiService } from "./modules/client/client-api.service";
import { ClientAuthService } from "./modules/client/client-auth.service";
import { ClientApiRateLimitService } from "./modules/client/client-api-rate-limit.service";
import { ClientAccountClosureService } from "./modules/client/client-account-closure.service";
import { ClientDeliveryAddressService } from "./modules/client/client-delivery-address.service";
import { ClientWechatAuthService } from "./modules/client/client-wechat-auth.service";
import { WechatMiniProgramAdapter } from "./modules/client/wechat-mini-program.adapter";

import { MiniProgramChannelService } from "./modules/client/mini-program-channel.service";

import { ClientChannelProfileService } from "./modules/client/client-channel-profile.service";

import { TenantAppearanceProfileService } from "./modules/client/tenant-appearance-profile.service";

import { AccountAppearanceService } from "./modules/client/account-appearance.service";

import { WebsiteChannelProfileService } from "./modules/client/website-channel-profile.service";
import { WebsiteAssetService } from "./modules/client/website-asset.service";

import { SubscriptionService } from "./modules/subscription/subscription.service";
import { SUBSCRIPTION_APPLICATION } from "@rental-os/platform-server/subscription-store";


import { DemoRequestService } from "./modules/demo-requests/demo-request.service";

import { AI_NATIVE_ORIGINAL_REQUEST_PROVIDER, AI_NATIVE_ORIGINAL_ACCOUNTING_PROVIDER, AI_NATIVE_BUDGET_MANAGEMENT_PROVIDER, AI_NATIVE_CAPABILITY_PROBE_PROVIDER, AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER, AI_NATIVE_ORIGINAL_READ_POLICY_PROVIDER, AI_NATIVE_ORIGINAL_PLAN_POLICY_PROVIDER, AI_NATIVE_ORIGINAL_ORDER_EXECUTION_PROVIDER, AI_NATIVE_STAFF_RECEIPT_PROVIDERS, AI_NATIVE_CLIENT_ENTRY_PROVIDERS, AI_NATIVE_RETENTION_PROVIDER } from "./modules/ai-native/ai-native-application.providers";

import { AI_NATIVE_GATEWAY_PRICING_HISTORY_PROVIDER } from "./modules/ai-native/ai-native-application.providers";


import { AI_NATIVE_INPUT_COUNTING_PROVIDER, AI_NATIVE_PLATFORM_PROBE_PROVIDER } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_TASK_RULE_DRAFT_PROVIDER } from './modules/ai-native/ai-native-application.providers';


import { AI_NATIVE_CONVERSATION_PROVIDER, AI_NATIVE_RUNTIME_CONFIGURATION_PROVIDERS } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_TASK_CENTER_PROVIDER, AI_NATIVE_QUOTE_MODEL_EXECUTION_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_OPENING_MODEL_EXECUTION_PROVIDER, AI_NATIVE_WORKBENCH_MODEL_CONTROL_PROVIDER } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_MODEL_SETTINGS_PROVIDER, AI_NATIVE_PLATFORM_MODEL_SETTINGS_PROVIDER, AI_NATIVE_MEMORY_MANAGEMENT_PROVIDER,
  AI_NATIVE_KNOWLEDGE_POLICY_PROVIDER, AI_NATIVE_KNOWLEDGE_MANAGEMENT_PROVIDER, AI_NATIVE_KNOWLEDGE_CONSUMPTION_PROVIDER } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_BUSINESS_FAILURE_PROVIDERS, AI_NATIVE_SETTINGS_LIFECYCLE_PROVIDERS, AI_NATIVE_QUOTE_ORDER_PROVIDERS, AI_NATIVE_CLARIFIED_QUOTE_SELECTION_PROVIDER } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_SCENE_CATALOG_PROVIDERS } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_ENTRY_ACTION_PROVIDERS } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_PLATFORM_RETENTION_PROVIDER } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_CATEGORY_DRAFT_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_STAFF_RECOGNITION_PROVIDERS } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_CLIENT_POLICY_PROVIDER } from './modules/ai-native/ai-native-application.providers';

import { AI_NATIVE_CLIENT_PUBLIC_PROVIDERS } from './modules/ai-native/ai-native-application.providers';

import { AiCreditService } from './modules/ai-native/budget/ai-credit.service';
import type { Provider } from "@nestjs/common";
import { composeRentalHttpServiceGroups, RENTAL_HTTP_DEPENDENCY_TOKENS, type RentalHttpServiceGroups } from "@rental-os/rental-core/http";
import { RENTAL_HTTP_CORE } from "@rental-os/rental-core/http-applications";

import type { RentalPaymentHttpApplications } from "@rental-os/rental-core/http-payments";

export const ORIGINAL_RENTAL_PAYMENT_HTTP_APPLICATIONS = Symbol("original.rental.payment-http.applications");

export const ORIGINAL_RENTAL_HTTP_APPLICATIONS = Symbol("original.rental.http.applications");

const originalProviders: Provider[] = [
    { provide: PLATFORM_APPEARANCE_DATA_STORE, useExisting: PrismaService },
    { provide: LEGACY_TENANT_APPEARANCE_READER, inject: [PrismaService], useFactory: (database: PrismaService) =>
      async (tenantId: string) => {
        const row = await database.clientChannelProfile.findUnique({ where: { tenantId }, select: {
          brandName: true, brandLogoUrl: true, faviconUrl: true, themeColor: true, adminCornerRadius: true,
          adminContainerRadius: true, adminButtonRadius: true, adminInputRadius: true
        } });
        return row;
      } },
    AI_NATIVE_BODY_DATABASE_PROVIDER,
    AI_NATIVE_AUTOMATION_EXPLANATION_PROVIDER,
    AI_NATIVE_TASK_OPENING_PROPOSAL_PROVIDER,
    AiCreditService,
    ...AI_NATIVE_STAFF_RECOGNITION_PROVIDERS,
    AI_NATIVE_CLIENT_POLICY_PROVIDER,
    AI_NATIVE_CATEGORY_DRAFT_PROVIDER,
    AI_NATIVE_CATEGORY_PROPOSAL_PROVIDER,
    ...AI_NATIVE_RUNTIME_CONFIGURATION_PROVIDERS,
    ...AI_NATIVE_SCENE_CATALOG_PROVIDERS,
    ...AI_NATIVE_ENTRY_ACTION_PROVIDERS,
    AI_NATIVE_CONVERSATION_PROVIDER,
    AI_NATIVE_MEMBER_NAME_PROVIDER,
    ApiAuthGuard,
    AI_NATIVE_ORIGINAL_REQUEST_PROVIDER,
    AI_NATIVE_ORIGINAL_ACCOUNTING_PROVIDER,
    AI_NATIVE_BUDGET_MANAGEMENT_PROVIDER,
    AI_NATIVE_GATEWAY_PRICING_HISTORY_PROVIDER,
    AI_NATIVE_MODEL_SETTINGS_PROVIDER,
    AI_NATIVE_TASK_CENTER_PROVIDER,
    AI_NATIVE_TASK_CENTER_RECOVERY_PROVIDER,
    AI_NATIVE_TASK_RULE_DRAFT_PROVIDER,
    AI_NATIVE_TASK_CALENDAR_DRAFT_PROVIDER,
    AI_NATIVE_TASK_ORDER_HANDOFF_PROVIDER,
    AI_NATIVE_TASK_READ_POLICY_PROVIDER,
    AI_NATIVE_TASK_ORIGINAL_READ_POLICY_PROVIDER,
    AI_NATIVE_PLATFORM_MODEL_SETTINGS_PROVIDER,
    AI_NATIVE_MEMORY_MANAGEMENT_PROVIDER,
    AI_NATIVE_KNOWLEDGE_POLICY_PROVIDER,
    AI_NATIVE_KNOWLEDGE_MANAGEMENT_PROVIDER,
    AI_NATIVE_KNOWLEDGE_CONSUMPTION_PROVIDER,
    ...AI_NATIVE_BUSINESS_FAILURE_PROVIDERS,
    ...AI_NATIVE_SETTINGS_LIFECYCLE_PROVIDERS,
    ...AI_NATIVE_QUOTE_ORDER_PROVIDERS,
    AI_NATIVE_CLARIFIED_QUOTE_SELECTION_PROVIDER,
    AI_NATIVE_CAPABILITY_PROBE_PROVIDER,
    AI_NATIVE_INPUT_COUNTING_PROVIDER,
    AI_NATIVE_PLATFORM_PROBE_PROVIDER,
    AI_NATIVE_ORIGINAL_ORDER_EXECUTION_PROVIDER,
    AI_NATIVE_ORIGINAL_ORDER_ANSWER_PROVIDER,
    AI_NATIVE_QUOTE_MODEL_EXECUTION_PROVIDER,
    AI_NATIVE_OPENING_MODEL_EXECUTION_PROVIDER,
    AI_NATIVE_WORKBENCH_MODEL_CONTROL_PROVIDER,
    AI_NATIVE_ORIGINAL_PLAN_POLICY_PROVIDER,
    ...AI_NATIVE_STAFF_RECEIPT_PROVIDERS,
    ...AI_NATIVE_CLIENT_ENTRY_PROVIDERS,
    ...AI_NATIVE_CLIENT_PUBLIC_PROVIDERS,
    AI_NATIVE_RETENTION_PROVIDER,
    AI_NATIVE_PLATFORM_RETENTION_PROVIDER,
    AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER,
    AI_NATIVE_ORIGINAL_READ_POLICY_PROVIDER,
    AuthService,
    { provide: PLATFORM_AUTH_DATA_STORE, useExisting: PrismaService },
    PlatformManagementService,
    PlatformToolsService,
    PlatformService,
    PlatformRepository,
    SharedCustomerRepository,
    CustomerOperationsRepository,
    CustomerRegistrationService,
    CustomerOperationsService,
    CustomerMergeService,
    CustomerCorporateService,
    CustomerCorporateSettlementService,
    MembershipService,
    EnterprisePortalService,
    EnterpriseAccessService,
    EnterpriseCommandService,
    EnterpriseApplicationService,
    EnterpriseRentalHandoffService,
    EnterpriseMembershipAuditService,
    EnterpriseMembersService,
    EnterprisePolicyService,
    EnterpriseApprovalService,
    EnterpriseMerchantDelegationService,
    EnterpriseMerchantOrderSubmissionService,
    EnterpriseExtensionApprovalService,
    EnterpriseExchangeApprovalService,
    EnterpriseTaskCenterService,
    EnterpriseManagementRequestService,
    EnterpriseOrderReaderService,
    CustomerAvatarService,
    OperationLogService,
    ...RENTAL_PRIMARY_APPLICATION_PROVIDERS,
    RentalExchangePreviewService,
    RentalExchangeInspectionPreparationService,
    RentalExchangeInspectionConsentService,
    RentalApprovedExchangeService,
    RentalExchangeInspectionMediaService,
    RentalCategoryResolver,
    CategoryGovernanceService,
    CategoryAdoptionPreparationService,
    CategoryAdoptionApplication,
    RentalAllocationService,
    RentalDueJobScheduler,
    OfficialCalendarSourceService,
    { provide: OFFICIAL_CALENDAR_DATA_STORE, useExisting: PrismaService },
    { provide: OFFICIAL_CALENDAR_APPLICATION, useExisting: OfficialCalendarSourceService },
    { provide: OFFICIAL_CALENDAR_SOURCE_READER, inject: [OfficialCalendarSourceService], useFactory: createOfficialCalendarSourceReader },
    RentalStateRepository,
    RentalSnapshotBackfillService,
    RentalCoreConfigRepository,
    RentalCoreFactRepository,
    RentalWorkspaceReportRepository,
    RentalBusinessConfigRepository,
    RentalBusinessFactRepository,
    RentalIdempotencyRepository,
    RentalIdempotentActionService,
    RentalFundingService,
    RentalOrderReceivableRepository,
    StaffOfflinePaymentService,
    ...RENTAL_HTTP_PROVIDERS,
    ...RENTAL_ENTERPRISE_HTTP_PROVIDERS,
    ...RENTAL_STAFF_HTTP_PROVIDERS,
    ...RENTAL_FILE_HTTP_PROVIDERS,
    ...RENTAL_CLIENT_HTTP_PROVIDERS,
    ...RENTAL_CHANNEL_HTTP_PROVIDERS,
    ...RENTAL_CATEGORY_HTTP_PROVIDERS,
    RentalDocumentService,
    RentalOrderConfirmationService,
    RentalServiceCapacityService,
    WorkspaceCapabilityRepository,
    WorkspaceCapabilityService,
    CapabilityHookRuntime,
    CapabilityHookRegistrar,
    CapabilityHookRepository,
    ClientApiService,
    ClientAuthService,
    ClientApiRateLimitService,
    ClientAccountClosureService,
    ClientDeliveryAddressService,
    ClientWechatAuthService,
    WechatMiniProgramAdapter,
    MiniProgramChannelService,
    ClientChannelProfileService,
    TenantAppearanceProfileService,
    AccountAppearanceService,
    WebsiteChannelProfileService,
    WebsiteAssetService,
    // 原 Rental 适配器的构造参数是 Prisma；公共父类的 @Inject 数据令牌不能
    // 通过继承元数据覆盖它。显式工厂保留这一原实例及其品类参加者。
    { provide: SubscriptionService, inject: [PrismaService], useFactory: (prisma: PrismaService) => new SubscriptionService(prisma) },
    { provide: SUBSCRIPTION_APPLICATION, useExisting: SubscriptionService },
    DemoRequestService,
    IntegrationsService,
    // 原控制器继承公共入口；公共令牌继续指向原实例，避免另建领域对象。
    { provide: RENTAL_INTEGRATIONS_HTTP_APPLICATION, useExisting: IntegrationsService },
    { provide: RENTAL_CUSTOMERS_HTTP_APPLICATION, useExisting: PlatformService },
    { provide: JOBS_HTTP_APPLICATION, useExisting: IntegrationsService },
    { provide: NOTIFICATIONS_HTTP_APPLICATION, useExisting: IntegrationsService },
    IntegrationsRepository,
    { provide: TenantIntegrationService, inject: [PrismaService, SecretBox, OperationLogService],
      useFactory: (prisma: PrismaService, secrets: SecretBox, logs: OperationLogService) => new TenantIntegrationService(prisma, secrets, logs) },
    { provide: TenantIntegrationConnectivityService,
      inject: [TenantIntegrationService, TenantIntegrationRuntimeService, FileStorageRuntimeService, PaymentRuntimeService, TenantEmailRuntimeService],
      useFactory: (integrations: TenantIntegrationService, sms: TenantIntegrationRuntimeService,
        files: FileStorageRuntimeService, payments: PaymentRuntimeService, email: TenantEmailRuntimeService) =>
        new TenantIntegrationConnectivityService(integrations, sms, files, payments, email) },
    { provide: TENANT_INTEGRATION_APPLICATION, useExisting: TenantIntegrationService },
    { provide: TENANT_INTEGRATION_CONNECTIVITY, useExisting: TenantIntegrationConnectivityService },
    { provide: TenantIntegrationRuntimeService, inject: [PrismaService, TenantIntegrationService],
      useFactory: (prisma: PrismaService, integrations: TenantIntegrationService) => new TenantIntegrationRuntimeService(prisma, integrations) },
    {
      provide: RENTAL_FILE_AUTHORITY,
      inject: [ModuleRef],
      // Auth→Platform→Rental→文件已有构造链；调用时才取得同一Auth，避免文件反向构造Auth。
      useFactory: (modules: ModuleRef): Pick<AuthService, "lockRequestWorkspaceAccess"> => ({
        lockRequestWorkspaceAccess: transaction => modules.get<AuthService>(AuthService, { strict: false })
          .lockRequestWorkspaceAccess(transaction)
      })
    },
    TenantEmailRuntimeService,
    TenantDispatchService,
    TenantOperatorInvitationsService,
    TenantSupportEmailService,
    FileStorageRuntimeService,
    FileBusinessAccessService,
    PaymentRuntimeService,
    PaymentReconciliationFileService,
    SecretBox,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: OperationAuditInterceptor
    },
    {
      provide: APP_GUARD,
      useExisting: ApiAuthGuard
    }
  ];

/** 原 provider 只登记一次；HTTP 取得同一组别名，不额外登记领域对象的生命周期钩子。 */
const rentalApplications: Provider = {
  provide: ORIGINAL_RENTAL_HTTP_APPLICATIONS,
  inject: [...RENTAL_HTTP_DEPENDENCY_TOKENS],
  useFactory: (...applications: unknown[]): RentalHttpServiceGroups => {
    const current = new Map(RENTAL_HTTP_DEPENDENCY_TOKENS.map((token, index) => [token, applications[index]]));
    return composeRentalHttpServiceGroups(token => current.get(token));
  },
};

const paymentApplications: Provider = {
  provide: ORIGINAL_RENTAL_PAYMENT_HTTP_APPLICATIONS,
  inject: [PaymentRuntimeService, PaymentReconciliationFileService, RENTAL_HTTP_CORE],
  useFactory: (runtime: PaymentRuntimeService, statements: PaymentReconciliationFileService, core: RentalPaymentHttpApplications["core"]): RentalPaymentHttpApplications => ({ runtime, statements, core }),
};

// 公共及 AI Controller 继续消费原实例；全局 Guard/审计注册保持原位置和顺序。
const exportedProviders = [...originalProviders, ...AI_NATIVE_LEGACY_SERVICE_ALIASES].flatMap(provider => {
  const token = typeof provider === "function" ? provider : provider.provide;
  return token === APP_GUARD || token === APP_INTERCEPTOR ? [] : [token];
});

@Module({
  imports: [
    AiDesktopBusinessModule,
    ConfigModule.forRoot({
      isGlobal: true,
      // main.ts loads and validates the selected project environment before importing this module.
      ignoreEnvFile: true
    }),
    DatabaseModule
  ],
  providers: [...originalProviders, ...AI_NATIVE_LEGACY_SERVICE_ALIASES, rentalApplications, paymentApplications],
  exports: [...new Set(exportedProviders), ORIGINAL_RENTAL_HTTP_APPLICATIONS, ORIGINAL_RENTAL_PAYMENT_HTTP_APPLICATIONS],
})
export class OriginalApplicationServicesModule {}
