import { AiTaskReadPolicyController } from './modules/ai-native/task-read-policy.application';
import { AiTaskOriginalReadPolicyController } from './modules/ai-native/task-original-read-policy.application';
import { AI_NATIVE_TASK_ORIGINAL_READ_POLICY_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_TASK_READ_POLICY_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AiTaskOrderHandoffController } from './modules/ai-native/task-order-handoff.application';
import { AI_NATIVE_TASK_ORDER_HANDOFF_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AiTaskCalendarDraftController } from './modules/ai-native/task-calendar-draft.application';
import { AI_NATIVE_TASK_CALENDAR_DRAFT_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AiMemberNameController } from './modules/ai-native/member-name.application';
import { AI_NATIVE_MEMBER_NAME_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { Module } from "@nestjs/common";
import { AiDesktopBusinessModule } from './modules/ai-native/desktop-business/desktop-business.module';
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
import { FileBusinessAccessService } from "./modules/files/file-business-access.service";
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
import { EnterprisePortalService } from "./modules/platform/enterprise-portal.service";
import { EnterpriseAccessService } from "./modules/client/enterprise-access.service";
import { EnterpriseCommandService } from "./modules/enterprise/enterprise-command.service";
import { EnterpriseApplicationService } from "./modules/enterprise/enterprise-application.service";
import { EnterpriseRentalHandoffService } from "./modules/enterprise/enterprise-rental-handoff.service";
import { EnterpriseMembershipAuditService } from "./modules/enterprise/enterprise-membership-audit.service";
import { EnterpriseRentalHandoffMerchantController } from "./modules/enterprise/enterprise-rental-handoff-merchant.controller";
import { EnterpriseMembersService } from "./modules/enterprise/enterprise-members.service";
import { EnterprisePolicyService } from "./modules/enterprise/enterprise-policy.service";
import { EnterpriseApprovalService } from "./modules/enterprise/enterprise-approval.service";
import { EnterpriseExchangeApprovalService } from "./modules/enterprise/enterprise-exchange-approval.service";
import { EnterpriseExtensionApprovalService } from "./modules/enterprise/enterprise-extension-approval.service";
import { EnterpriseTaskCenterService } from "./modules/enterprise/enterprise-task-center.service";
import { EnterpriseManagementRequestService } from "./modules/enterprise/enterprise-management-request.service";
import { EnterpriseWorkflowsController } from "./modules/enterprise/enterprise-workflows.controller";
import { EnterpriseOrderReaderService } from "./modules/enterprise/enterprise-order-reader.service";
import { EnterpriseReadController } from "./modules/enterprise/enterprise-read.controller";
import { EnterpriseMerchantController } from "./modules/enterprise/enterprise-merchant.controller";
import { CustomerAvatarController } from "./modules/platform/customer-avatar.controller";
import { CustomerAvatarService } from "./modules/platform/customer-avatar.service";
import { PlatformService } from "./modules/platform/platform.service";
import { RentalCoreController } from "./modules/rental-core/rental-core.controller";
import { RentalExchangePreviewService } from "./modules/rental-core/rental-exchange-preview.service";
import { RentalExchangeInspectionPreparationService } from "./modules/rental-core/rental-exchange-inspection-preparation.service";
import { RentalExchangeInspectionConsentService } from "./modules/rental-core/rental-exchange-inspection-consent.service";
import { RentalApprovedExchangeService } from "./modules/rental-core/rental-approved-exchange.service";
import { RentalExchangeInspectionMediaService } from "./modules/rental-core/rental-exchange-inspection-media.service";
import { RentalCoreService } from "./modules/rental-core/rental-core.service";
import { RentalCategoryResolver } from "./modules/rental-core/rental-category-resolver.service";
import { CategoryGovernanceController } from "./modules/rental-core/category-governance.controller";
import { CategoryGovernanceService } from "./modules/rental-core/category-governance.service";
import { CategoryAdoptionPreparationController } from "./modules/rental-core/category-adoption-preparation.controller";
import { CategoryAdoptionPreparationService } from "./modules/rental-core/category-adoption-preparation.service";
import { CategoryAdoptionApplication } from "./modules/rental-core/category-adoption.application";
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
import { RentalOrderReceivableRepository } from "./modules/rental-core/rental-order-receivable.repository";
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
import { AiOriginalScenesController, AiOriginalSceneObservationController, AiOriginalQuoteModelExecutionController, AiOriginalTaskActionPolicyController, AiScenePlanPolicyController } from "./modules/ai-native/scenes/original-scenes.controller";
import { AI_NATIVE_ORIGINAL_REQUEST_PROVIDER, AI_NATIVE_ORIGINAL_ACCOUNTING_PROVIDER, AI_NATIVE_BUDGET_MANAGEMENT_PROVIDER, AI_NATIVE_CAPABILITY_PROBE_PROVIDER, AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER, AI_NATIVE_ORIGINAL_READ_POLICY_PROVIDER, AI_NATIVE_ORIGINAL_PLAN_POLICY_PROVIDER, AI_NATIVE_ORIGINAL_ORDER_EXECUTION_PROVIDER, AI_NATIVE_STAFF_RECEIPT_PROVIDERS, AI_NATIVE_CLIENT_ENTRY_PROVIDERS, AI_NATIVE_RETENTION_PROVIDER } from "./modules/ai-native/ai-native-application.providers";
import { AiOriginalOrderReadController } from "./modules/ai-native/scenes/original-order-read.controller";
import { AiOriginalTaskAccountingController } from "./modules/ai-native/scenes/original-task-accounting-http.module";
import { AiBudgetManagementController, AiGatewayPricingHistoryController } from "./modules/ai-native/budget/budget-management.module";
import { AI_NATIVE_GATEWAY_PRICING_HISTORY_PROVIDER } from "./modules/ai-native/ai-native-application.providers";
import { TextCapabilityProbeController } from "./modules/ai-native/text-capability-probe.controller";
import { AiInputCountingController } from './modules/ai-native/input-counting/input-counting-request.module';
import { AI_NATIVE_INPUT_COUNTING_PROVIDER, AI_NATIVE_PLATFORM_PROBE_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { PlatformCapabilityProbeController } from './modules/ai-native/platform-capability-probe/platform-capability-probe.controller';
import { AiModelSettingsController } from './modules/ai-native/model-settings.application';
import { AiTaskRuleDraftController } from './modules/ai-native/task-rule-draft.application';
import { AI_NATIVE_TASK_RULE_DRAFT_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AiTaskCenterController } from './modules/ai-native/task-center.application';
import { AiConversationController } from './modules/ai-native/conversation.application';
import { AI_NATIVE_CONVERSATION_PROVIDER, AI_NATIVE_RUNTIME_CONFIGURATION_PROVIDERS } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_TASK_CENTER_PROVIDER, AI_NATIVE_QUOTE_MODEL_EXECUTION_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_OPENING_MODEL_EXECUTION_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AiOriginalOpeningModelExecutionController } from './modules/ai-native/scenes/opening-model-execution.controller';
import { AI_NATIVE_MODEL_SETTINGS_PROVIDER, AI_NATIVE_PLATFORM_MODEL_SETTINGS_PROVIDER, AI_NATIVE_MEMORY_MANAGEMENT_PROVIDER,
  AI_NATIVE_KNOWLEDGE_POLICY_PROVIDER, AI_NATIVE_KNOWLEDGE_MANAGEMENT_PROVIDER, AI_NATIVE_KNOWLEDGE_CONSUMPTION_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AiPlatformModelSettingsController } from './modules/ai-native/platform-model-settings.application';
import { HumanMemoryManagementController } from './modules/ai-native/knowledge/human-memory-management.controller';
import { KnowledgePolicyManagementController } from './modules/ai-native/knowledge/knowledge-policy-management.controller';
import { HumanKnowledgeManagementController } from './modules/ai-native/knowledge/human-knowledge-management.controller';
import { HumanKnowledgeConsumptionController } from './modules/ai-native/knowledge/human-knowledge-consumption.controller';
import { AI_NATIVE_BUSINESS_FAILURE_PROVIDERS, AI_NATIVE_SETTINGS_LIFECYCLE_PROVIDERS, AI_NATIVE_QUOTE_ORDER_PROVIDERS, AI_NATIVE_CLARIFIED_QUOTE_SELECTION_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AiHumanQuoteSelectionController, AiHumanQuoteOrderController, AiSelectedQuoteTaskController, AiClarifiedQuoteSelectionController } from './modules/ai-native/task-request/human-quote-selection.controller';
import { AiSettingsChangeController, AiSettingsTaskCreationController, AiSettingsTaskControlController,
  AiSettingsTaskController, AiSettingsTaskReadController } from './modules/ai-native/scenes/settings-task.controller';
import { OperatorAutomationController, StaffAutomationController } from './modules/ai-native/automation/human-automation-request.controller';
import { HumanAutomationPolicyRequestController } from './modules/ai-native/automation/human-automation-policy-request.controller';
import { AiRetentionController } from "./modules/ai-native/privacy/retention.controller";
import { AiCategoryDraftController } from './modules/ai-native/category-assist/category-draft.application';
import { AI_NATIVE_CATEGORY_DRAFT_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { AI_NATIVE_STAFF_RECOGNITION_PROVIDERS } from './modules/ai-native/ai-native-application.providers';
import { InspectionRecognitionTaskController, StaffInspectionAccountingController } from './modules/ai-native/inspection-assist/inspection-recognition-task.controller';
import { StaffInspectionTaskPolicyController } from './modules/ai-native/inspection-assist/inspection-task-policy.controller';
import { ClientTaskPolicyController } from './modules/ai-native/scenes/client-task-policy.controller';
import { AI_NATIVE_CLIENT_POLICY_PROVIDER } from './modules/ai-native/ai-native-application.providers';
import { StaffInspectionAssistController } from "./modules/ai-native/inspection-assist/staff-inspection-assist.controller";
import { WebsiteClientEntryController, WechatClientEntryController } from "./modules/ai-native/scenes/standard-client-entry.application";
import { AiCreditController } from './modules/ai-native/budget/ai-credit.controller';
import { AiCreditService } from './modules/ai-native/budget/ai-credit.service';

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
  controllers: [
    AiCreditController,
    InspectionRecognitionTaskController,
    StaffInspectionAccountingController,
    StaffInspectionTaskPolicyController,
    ClientTaskPolicyController,
    AiCategoryDraftController,
    AiConversationController,
    TextCapabilityProbeController,
    AiInputCountingController,
    PlatformCapabilityProbeController,
    AiOriginalScenesController,
    AiOriginalOrderReadController,
    AiOriginalTaskAccountingController,
    AiBudgetManagementController,
    AiGatewayPricingHistoryController,
    AiModelSettingsController,
    AiTaskCenterController,
    AiMemberNameController,
    AiTaskRuleDraftController,
    AiTaskCalendarDraftController,
    AiTaskOrderHandoffController,
    AiTaskReadPolicyController,
    AiTaskOriginalReadPolicyController,
    AiPlatformModelSettingsController,
    HumanMemoryManagementController,
    KnowledgePolicyManagementController,
    HumanKnowledgeManagementController,
    HumanKnowledgeConsumptionController,
    OperatorAutomationController,
    StaffAutomationController,
    HumanAutomationPolicyRequestController,
    AiSettingsChangeController,
    AiSettingsTaskCreationController,
    AiSettingsTaskControlController,
    AiSettingsTaskController,
    AiSettingsTaskReadController,
    AiHumanQuoteSelectionController,
    AiClarifiedQuoteSelectionController,
    AiHumanQuoteOrderController,
    AiSelectedQuoteTaskController,
    AiScenePlanPolicyController,
    StaffInspectionAssistController,
    WebsiteClientEntryController,
    WechatClientEntryController,
    AiRetentionController,
    AiOriginalSceneObservationController,
    AiOriginalQuoteModelExecutionController,
    AiOriginalOpeningModelExecutionController,
    AiOriginalTaskActionPolicyController,
    HealthController,
    OpenApiController,
    AuthController,
    StaffAuthController,
    PlatformController,
    CategoryGovernanceController,
    CategoryAdoptionPreparationController,
    MembershipController,
    EnterpriseWorkflowsController,
    EnterpriseReadController,
    EnterpriseMerchantController,
    EnterpriseRentalHandoffMerchantController,
    CustomerAvatarController,
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
    AiCreditService,
    ...AI_NATIVE_STAFF_RECOGNITION_PROVIDERS,
    AI_NATIVE_CLIENT_POLICY_PROVIDER,
    AI_NATIVE_CATEGORY_DRAFT_PROVIDER,
    ...AI_NATIVE_RUNTIME_CONFIGURATION_PROVIDERS,
    AI_NATIVE_CONVERSATION_PROVIDER,
    AI_NATIVE_MEMBER_NAME_PROVIDER,
    ApiAuthGuard,
    AI_NATIVE_ORIGINAL_REQUEST_PROVIDER,
    AI_NATIVE_ORIGINAL_ACCOUNTING_PROVIDER,
    AI_NATIVE_BUDGET_MANAGEMENT_PROVIDER,
    AI_NATIVE_GATEWAY_PRICING_HISTORY_PROVIDER,
    AI_NATIVE_MODEL_SETTINGS_PROVIDER,
    AI_NATIVE_TASK_CENTER_PROVIDER,
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
    AI_NATIVE_QUOTE_MODEL_EXECUTION_PROVIDER,
    AI_NATIVE_OPENING_MODEL_EXECUTION_PROVIDER,
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
    EnterprisePortalService,
    EnterpriseAccessService,
    EnterpriseCommandService,
    EnterpriseApplicationService,
    EnterpriseRentalHandoffService,
    EnterpriseMembershipAuditService,
    EnterpriseMembersService,
    EnterprisePolicyService,
    EnterpriseApprovalService,
    EnterpriseExtensionApprovalService,
    EnterpriseExchangeApprovalService,
    EnterpriseTaskCenterService,
    EnterpriseManagementRequestService,
    EnterpriseOrderReaderService,
    CustomerAvatarService,
    OperationLogService,
    RentalCoreService,
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
    RentalOrderReceivableRepository,
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
  ]
})
export class AppModule {}
