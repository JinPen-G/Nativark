import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ApiAuthGuard } from "./common/api-auth.guard";
import { ConfigModule } from "@nestjs/config";
import { OperationAuditInterceptor } from "./common/operation-audit.interceptor";
import { OperationLogService } from "./common/operation-log.service";
import { RequestIdInterceptor } from "./common/request-id.interceptor";
import { AuthController } from "./modules/auth/auth.controller";
import { StaffAuthController } from "./modules/auth/staff-auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { FilesController } from "./modules/files/files.controller";
import { StaffUploadsController } from "./modules/files/staff-uploads.controller";
import { HealthController } from "./modules/health/health.controller";
import { IntegrationsController } from "./modules/integrations/integrations.controller";
import { IntegrationsRepository } from "./modules/integrations/integrations.repository";
import { IntegrationsService } from "./modules/integrations/integrations.service";
import { TenantIntegrationController } from "./modules/integrations/tenant-integration.controller";
import { TenantIntegrationConnectivityService } from "./modules/integrations/tenant-integration.connectivity.service";
import { TenantIntegrationService } from "./modules/integrations/tenant-integration.service";
import { TenantIntegrationRuntimeService } from "./modules/integrations/tenant-integration.runtime.service";
import { FileStorageRuntimeService } from "./modules/integrations/file-storage.runtime.service";
import { PaymentRuntimeService } from "./modules/integrations/payment.runtime.service";
import { PaymentWebhookController } from "./modules/integrations/payment-webhook.controller";
import { PaymentOperationsController } from "./modules/integrations/payment-operations.controller";
import { PaymentReconciliationController } from "./modules/integrations/payment-reconciliation.controller";
import { PaymentReconciliationFileService } from "./modules/integrations/payment-reconciliation-file.service";
import { SecretBox } from "./common/secret-box";
import { JobsController } from "./modules/jobs/jobs.controller";
import { NotificationsController } from "./modules/notifications/notifications.controller";
import { OpenApiController } from "./modules/openapi/openapi.controller";
import { DatabaseModule } from "./modules/database/database.module";
import { PlatformController } from "./modules/platform/platform.controller";
import { PlatformRepository } from "./modules/platform/platform.repository";
import { SharedCustomerRepository } from "./modules/platform/shared-customer.repository";
import { CustomerOperationsRepository } from "./modules/platform/customer-operations.repository";
import { CustomerRegistrationService } from "./modules/platform/customer-registration.service";
import { CustomerOperationsService } from "./modules/platform/customer-operations.service";
import { CustomerMergeService } from "./modules/platform/customer-merge.service";
import { CustomerCorporateService } from "./modules/platform/customer-corporate.service";
import { CustomerCorporateSettlementService } from "./modules/platform/customer-corporate-settlement.service";
import { MembershipController } from "./modules/platform/membership.controller";
import { MembershipService } from "./modules/platform/membership.service";
import { PlatformService } from "./modules/platform/platform.service";
import { RentalCoreController } from "./modules/rental-core/rental-core.controller";
import { RentalCoreService } from "./modules/rental-core/rental-core.service";
import { RentalCategoryResolver } from "./modules/rental-core/rental-category-resolver.service";
import { CategoryGovernanceController } from "./modules/rental-core/category-governance.controller";
import { CategoryGovernanceService } from "./modules/rental-core/category-governance.service";
import { CategoryAdoptionPreparationController } from "./modules/rental-core/category-adoption-preparation.controller";
import { CategoryAdoptionPreparationService } from "./modules/rental-core/category-adoption-preparation.service";
import { RentalAllocationService } from "./modules/rental-core/rental-allocation.service";
import { RentalDueJobScheduler } from "./modules/rental-core/rental-due-job.scheduler";
import { RentalBusinessController } from "./modules/rental-core/rental-business.controller";
import { OfficialCalendarSourceController } from "./modules/rental-core/official-calendar-source.controller";
import { OfficialCalendarSourceService } from "./modules/rental-core/official-calendar-source.service";
import { RentalBusinessService } from "./modules/rental-core/rental-business.service";
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
import { StaffOfflinePaymentController } from "./modules/rental-core/staff-offline-payment.controller";
import { StaffOfflinePaymentService } from "./modules/rental-core/staff-offline-payment.service";
import { RentalDocumentService } from "./modules/rental-core/rental-document.service";
import { RentalOrderConfirmationService } from "./modules/rental-core/rental-order-confirmation.service";
import { WorkspaceCapabilityController } from "./modules/rental-core/workspace-capability.controller";
import { WorkspaceCapabilityRepository } from "./modules/rental-core/workspace-capability.repository";
import { WorkspaceCapabilityService } from "./modules/rental-core/workspace-capability.service";
import { CapabilityHookRuntime } from "./modules/rental-core/capability-hook.runtime";
import { CapabilityHookRepository } from "./modules/rental-core/capability-hook.repository";
import { CapabilityHookRegistrar } from "./modules/rental-core/capability-hook.registrar";
import { RentalServiceCapacityService } from "./modules/rental-core/rental-service-capacity.service";
import { ClientApiController } from "./modules/client/client-api.controller";
import { ClientApiService } from "./modules/client/client-api.service";
import { ClientAuthService } from "./modules/client/client-auth.service";
import { ClientApiRateLimitService } from "./modules/client/client-api-rate-limit.service";
import { ClientAccountClosureService } from "./modules/client/client-account-closure.service";
import { ClientDeliveryAddressService } from "./modules/client/client-delivery-address.service";
import { ClientWechatAuthService } from "./modules/client/client-wechat-auth.service";
import { WechatMiniProgramAdapter } from "./modules/client/wechat-mini-program.adapter";
import { MiniProgramChannelController } from "./modules/client/mini-program-channel.controller";
import { MiniProgramChannelService } from "./modules/client/mini-program-channel.service";
import { ClientChannelProfileController } from "./modules/client/client-channel-profile.controller";
import { ClientChannelProfileService } from "./modules/client/client-channel-profile.service";
import { TenantAppearanceProfileController } from "./modules/client/tenant-appearance-profile.controller";
import { TenantAppearanceProfileService } from "./modules/client/tenant-appearance-profile.service";
import { AccountAppearanceController } from "./modules/client/account-appearance.controller";
import { AccountAppearanceService } from "./modules/client/account-appearance.service";
import { WebsiteChannelProfileController } from "./modules/client/website-channel-profile.controller";
import { WebsiteChannelProfileService } from "./modules/client/website-channel-profile.service";
import { WebsiteAssetService } from "./modules/client/website-asset.service";
import { TenantSubscriptionController } from "./modules/subscription/subscription.controller";
import { PlatformSubscriptionController } from "./modules/subscription/subscription-platform.controller";
import { StaffSubscriptionController } from "./modules/subscription/subscription-staff.controller";
import { SubscriptionService } from "./modules/subscription/subscription.service";
import { PublicDemoRequestController } from "./modules/demo-requests/public-demo-request.controller";
import { PlatformDemoRequestController } from "./modules/demo-requests/platform-demo-request.controller";
import { DemoRequestService } from "./modules/demo-requests/demo-request.service";
import { AiOriginalScenesController, AiOriginalSceneObservationController, AiOriginalTaskActionPolicyController, AiScenePlanPolicyController } from "./modules/ai-native/scenes/original-scenes.controller";
import { AI_NATIVE_ORIGINAL_REQUEST_PROVIDER, AI_NATIVE_ORIGINAL_ACCOUNTING_PROVIDER, AI_NATIVE_BUDGET_MANAGEMENT_PROVIDER, AI_NATIVE_CAPABILITY_PROBE_PROVIDER, AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER, AI_NATIVE_ORIGINAL_READ_POLICY_PROVIDER, AI_NATIVE_ORIGINAL_PLAN_POLICY_PROVIDER, AI_NATIVE_ORIGINAL_ORDER_EXECUTION_PROVIDER, AI_NATIVE_STAFF_RECEIPT_PROVIDERS, AI_NATIVE_CLIENT_ENTRY_PROVIDERS, AI_NATIVE_RETENTION_PROVIDER } from "./modules/ai-native/ai-native-application.providers";
import { AiOriginalOrderReadController } from "./modules/ai-native/scenes/original-order-read.controller";
import { AiOriginalTaskAccountingController } from "./modules/ai-native/scenes/original-task-accounting-http.module";
import { AiBudgetManagementController } from "./modules/ai-native/budget/budget-management.module";
import { TextCapabilityProbeController } from "./modules/ai-native/text-capability-probe.controller";
import { AiModelSettingsController } from './modules/ai-native/model-settings.application';
import { AI_NATIVE_MODEL_SETTINGS_PROVIDER, AI_NATIVE_PLATFORM_MODEL_SETTINGS_PROVIDER, AI_NATIVE_MEMORY_MANAGEMENT_PROVIDER,
  AI_NATIVE_KNOWLEDGE_POLICY_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AiPlatformModelSettingsController } from './modules/ai-native/platform-model-settings.application';
import { HumanMemoryManagementController } from './modules/ai-native/knowledge/human-memory-management.controller';
import { KnowledgePolicyManagementController } from './modules/ai-native/knowledge/knowledge-policy-management.controller';
import { AiRetentionController } from "./modules/ai-native/privacy/retention.controller";
import { StaffInspectionAssistController } from "./modules/ai-native/inspection-assist/staff-inspection-assist.controller";
import { WebsiteClientEntryController, WechatClientEntryController } from "./modules/ai-native/scenes/standard-client-entry.application";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"]
    }),
    DatabaseModule
  ],
  controllers: [
    TextCapabilityProbeController,
    AiOriginalScenesController,
    AiOriginalOrderReadController,
    AiOriginalTaskAccountingController,
    AiBudgetManagementController,
    AiModelSettingsController,
    AiPlatformModelSettingsController,
    HumanMemoryManagementController,
    KnowledgePolicyManagementController,
    AiScenePlanPolicyController,
    StaffInspectionAssistController,
    WebsiteClientEntryController,
    WechatClientEntryController,
    AiRetentionController,
    AiOriginalSceneObservationController,
    AiOriginalTaskActionPolicyController,
    HealthController,
    OpenApiController,
    AuthController,
    StaffAuthController,
    PlatformController,
    CategoryGovernanceController,
    CategoryAdoptionPreparationController,
    MembershipController,
    RentalCoreController,
    RentalBusinessController,
    OfficialCalendarSourceController,
    WorkspaceCapabilityController,
    IntegrationsController,
    TenantIntegrationController,
    FilesController,
    StaffUploadsController,
    StaffOfflinePaymentController,
    PaymentWebhookController,
    PaymentOperationsController,
    PaymentReconciliationController,
    NotificationsController,
    JobsController,
    ClientApiController,
    MiniProgramChannelController,
    ClientChannelProfileController,
    TenantAppearanceProfileController,
    AccountAppearanceController,
    WebsiteChannelProfileController,
    TenantSubscriptionController,
    PlatformSubscriptionController,
    StaffSubscriptionController,
    PublicDemoRequestController,
    PlatformDemoRequestController
  ],
  providers: [
    ApiAuthGuard,
    AI_NATIVE_ORIGINAL_REQUEST_PROVIDER,
    AI_NATIVE_ORIGINAL_ACCOUNTING_PROVIDER,
    AI_NATIVE_BUDGET_MANAGEMENT_PROVIDER,
    AI_NATIVE_MODEL_SETTINGS_PROVIDER,
    AI_NATIVE_PLATFORM_MODEL_SETTINGS_PROVIDER,
    AI_NATIVE_MEMORY_MANAGEMENT_PROVIDER,
    AI_NATIVE_KNOWLEDGE_POLICY_PROVIDER,
    AI_NATIVE_CAPABILITY_PROBE_PROVIDER,
    AI_NATIVE_ORIGINAL_ORDER_EXECUTION_PROVIDER,
    AI_NATIVE_ORIGINAL_PLAN_POLICY_PROVIDER,
    ...AI_NATIVE_STAFF_RECEIPT_PROVIDERS,
    ...AI_NATIVE_CLIENT_ENTRY_PROVIDERS,
    AI_NATIVE_RETENTION_PROVIDER,
    AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER,
    AI_NATIVE_ORIGINAL_READ_POLICY_PROVIDER,
    AuthService,
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
    OperationLogService,
    RentalCoreService,
    RentalCategoryResolver,
    CategoryGovernanceService,
    CategoryAdoptionPreparationService,
    RentalAllocationService,
    RentalDueJobScheduler,
    RentalBusinessService,
    OfficialCalendarSourceService,
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
    StaffOfflinePaymentService,
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
    SubscriptionService,
    DemoRequestService,
    IntegrationsService,
    IntegrationsRepository,
    TenantIntegrationService,
    TenantIntegrationConnectivityService,
    TenantIntegrationRuntimeService,
    FileStorageRuntimeService,
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
  ]
})
export class AppModule {}
