/** 原公共与 AI HTTP 保持原入口，业务 HTTP 通过正式 Rental 模块挂载。
 * 服务模块只提供一组原实例与全局 Guard/审计；此入口不加载环境、启动计时器或执行迁移。 */

import { AiTaskReadPolicyController } from './modules/ai-native/task-read-policy.application';
import { AiCategoryProposalController } from './modules/ai-native/category-assist/category-proposal-http.application';


import { AutomationExplanationController } from './modules/ai-native/automation/automation-explanation.controller';

import { TaskOpeningProposalController } from './modules/ai-native/task-opening-proposal.controller';
import { AiTaskCenterRecoveryController } from './modules/ai-native/task-center-recovery.application';

import { AiTaskOriginalReadPolicyController } from './modules/ai-native/task-original-read-policy.application';


import { AiTaskOrderHandoffController } from './modules/ai-native/task-order-handoff.application';

import { AiTaskCalendarDraftController } from './modules/ai-native/task-calendar-draft.application';

import { AiMemberNameController } from './modules/ai-native/member-name.application';

import { Module } from "@nestjs/common";

import { AuthController } from "./modules/auth/auth.controller";

import { HealthController } from "./modules/health/health.controller";
import { IntegrationsController } from "./modules/integrations/integrations.controller";

import { TenantIntegrationController } from "./modules/integrations/tenant-integration.controller";

import { AcceptTenantOperatorInvitationController } from "./modules/notifications/accept-operator-invitation.controller";
import { TenantDispatchController } from "./modules/notifications/tenant-dispatch.controller";
import { TenantOperatorInvitationsController } from "./modules/notifications/tenant-operator-invitations.controller";
import { TenantSupportEmailController } from "./modules/notifications/tenant-support-email.controller";

import { JobsController } from "./modules/jobs/jobs.controller";
import { NotificationsController } from "./modules/notifications/notifications.controller";
import { OpenApiController } from "./modules/openapi/openapi.controller";

import { PlatformController } from "./modules/platform/platform.controller";

import { OfficialCalendarSourceController } from "./modules/rental-core/official-calendar-source.controller";

import { TenantAppearanceProfileController } from "./modules/client/tenant-appearance-profile.controller";

import { AccountAppearanceController } from "./modules/client/account-appearance.controller";

import { TenantSubscriptionController } from "./modules/subscription/subscription.controller";
import { PlatformSubscriptionController } from "./modules/subscription/subscription-platform.controller";
import { StaffSubscriptionController } from "./modules/subscription/subscription-staff.controller";


import { PublicDemoRequestController } from "./modules/demo-requests/public-demo-request.controller";
import { PlatformDemoRequestController } from "./modules/demo-requests/platform-demo-request.controller";

import { AiOriginalScenesController, AiOriginalSceneObservationController, AiOriginalQuoteModelExecutionController, AiOriginalTaskActionPolicyController, AiScenePlanPolicyController } from "./modules/ai-native/scenes/original-scenes.controller";

import { AiOriginalOrderReadController } from "./modules/ai-native/scenes/original-order-read.controller";
import { AiOriginalTaskAccountingController } from "./modules/ai-native/scenes/original-task-accounting-http.module";
import { AiBudgetManagementController, AiGatewayPricingHistoryController } from "./modules/ai-native/budget/budget-management.module";

import { TextCapabilityProbeController } from "./modules/ai-native/text-capability-probe.controller";
import { AiInputCountingController } from './modules/ai-native/input-counting/input-counting-request.module';

import { PlatformCapabilityProbeController } from './modules/ai-native/platform-capability-probe/platform-capability-probe.controller';
import { AiModelSettingsController } from './modules/ai-native/model-settings.application';
import { AiTaskRuleDraftController } from './modules/ai-native/task-rule-draft.application';

import { AiTaskCenterController } from './modules/ai-native/task-center.application';
import { AiConversationController } from './modules/ai-native/conversation.application';

import { AiOriginalOpeningModelExecutionController } from './modules/ai-native/scenes/opening-model-execution.controller';

import { AiPlatformModelSettingsController } from './modules/ai-native/platform-model-settings.application';
import { HumanMemoryManagementController } from './modules/ai-native/knowledge/human-memory-management.controller';
import { KnowledgePolicyManagementController } from './modules/ai-native/knowledge/knowledge-policy-management.controller';
import { HumanKnowledgeManagementController } from './modules/ai-native/knowledge/human-knowledge-management.controller';
import { HumanKnowledgeConsumptionController } from './modules/ai-native/knowledge/human-knowledge-consumption.controller';

import { AiHumanQuoteSelectionController, AiHumanQuoteOrderController, AiSelectedQuoteTaskController, AiClarifiedQuoteSelectionController } from './modules/ai-native/task-request/human-quote-selection.controller';
import { AiSettingsChangeController, AiSettingsTaskCreationController, AiSettingsTaskControlController,
  AiSettingsTaskController, AiSettingsTaskReadController } from './modules/ai-native/scenes/settings-task.controller';
import { OperatorAutomationController, StaffAutomationController } from './modules/ai-native/automation/human-automation-request.controller';
import { HumanAutomationPolicyRequestController } from './modules/ai-native/automation/human-automation-policy-request.controller';
import { AiRetentionController, AiPlatformRetentionController } from "./modules/ai-native/privacy/retention.controller";
import { OperatorEntrySceneCatalogController, StaffEntrySceneCatalogController,
  WebsiteEntrySceneCatalogController, WechatEntrySceneCatalogController } from './modules/ai-native/scenes/entry-scene-catalog.controller';


import { OperatorRegisteredEntryActionController, StaffRegisteredEntryActionController,
  WebsiteRegisteredEntryActionController, WechatRegisteredEntryActionController,
  OperatorEntryNotificationDraftController } from './modules/ai-native/scenes/registered-entry-action.controller';

import { AiCategoryDraftController } from './modules/ai-native/category-assist/category-draft.application';


import { InspectionRecognitionTaskController, StaffInspectionAccountingController } from './modules/ai-native/inspection-assist/inspection-recognition-task.controller';
import { StaffInspectionTaskPolicyController } from './modules/ai-native/inspection-assist/inspection-task-policy.controller';
import { ClientTaskPolicyController } from './modules/ai-native/scenes/client-task-policy.controller';

import { StaffInspectionAssistController } from "./modules/ai-native/inspection-assist/staff-inspection-assist.controller";
import { WebsiteClientEntryController, WechatClientEntryController } from "./modules/ai-native/scenes/standard-client-entry.application";
import { WebsiteClientPublicController, WechatClientPublicController } from './modules/ai-native/scenes/client-public.controller';

import { AiCreditController } from './modules/ai-native/budget/ai-credit.controller';

import { RentalHttpModule, type RentalHttpServiceGroups } from "@rental-os/rental-core/http";
import { OriginalApplicationServicesModule, ORIGINAL_RENTAL_HTTP_APPLICATIONS, ORIGINAL_RENTAL_PAYMENT_HTTP_APPLICATIONS } from "./application-services.module";

import { RentalPaymentsHttpModule, type RentalPaymentHttpApplications } from "@rental-os/rental-core/http-payments";
import { originalCorePackagesModule } from "./modules/core-host/original-core-packages.module";

@Module({
  imports: [
    OriginalApplicationServicesModule,
    originalCorePackagesModule,
    RentalPaymentsHttpModule.registerFactory({
      imports: [OriginalApplicationServicesModule],
      inject: [ORIGINAL_RENTAL_PAYMENT_HTTP_APPLICATIONS],
      useFactory: (applications: RentalPaymentHttpApplications) => applications,
    }),
    RentalHttpModule.registerFactory({
      imports: [OriginalApplicationServicesModule],
      inject: [ORIGINAL_RENTAL_HTTP_APPLICATIONS],
      useFactory: (applications: RentalHttpServiceGroups) => applications,
    }),
  ],
  controllers: [
    AutomationExplanationController,
    AiTaskCenterRecoveryController,
    TaskOpeningProposalController,
    AiCreditController,
    InspectionRecognitionTaskController,
    StaffInspectionAccountingController,
    StaffInspectionTaskPolicyController,
    ClientTaskPolicyController,
    AiCategoryDraftController,
    AiCategoryProposalController,
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
    WebsiteClientPublicController,
    WechatClientPublicController,
    AiRetentionController,
    AiPlatformRetentionController,
    OperatorEntrySceneCatalogController,
    StaffEntrySceneCatalogController,
    WebsiteEntrySceneCatalogController,
    WechatEntrySceneCatalogController,
    OperatorRegisteredEntryActionController,
    StaffRegisteredEntryActionController,
    WebsiteRegisteredEntryActionController,
    WechatRegisteredEntryActionController,
    OperatorEntryNotificationDraftController,
    AiOriginalSceneObservationController,
    AiOriginalQuoteModelExecutionController,
    AiOriginalOpeningModelExecutionController,
    AiOriginalTaskActionPolicyController,
    HealthController,
    OpenApiController,
    AuthController,
    PlatformController,
    OfficialCalendarSourceController,
    IntegrationsController,
    TenantIntegrationController,
    NotificationsController,
    TenantDispatchController,
    TenantOperatorInvitationsController,
    AcceptTenantOperatorInvitationController,
    TenantSupportEmailController,
    JobsController,
    TenantAppearanceProfileController,
    AccountAppearanceController,
    TenantSubscriptionController,
    PlatformSubscriptionController,
    StaffSubscriptionController,
    PublicDemoRequestController,
    PlatformDemoRequestController,
  ],
})
export class AppModule {}
