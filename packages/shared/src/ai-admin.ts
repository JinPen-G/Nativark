/** 原AI工作台的窄合同出口，仅再导出原声明和运行值，不加载Rental根实现。 */
export { AI_CONVERSATION_HTTP_DRAFT } from "./ai-conversation-draft";
export { AI_PROPOSAL_DRAFT_VERSION } from "./ai-proposal-draft";
export { AI_SCENE_REQUEST_DRAFT_VERSION } from "./ai-scene-request-draft";
export type { AiTaskBudgetUsagePageDraft, AiTaskBudgetUsageSummaryDraft } from "./ai-scene-request-draft";
export { AI_STEP_STATUSES_DRAFT, AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT } from "@rental-os/platform-contracts/ai-task";
export { AI_TASK_CENTER_HTTP_DRAFT } from "./ai-task-draft";
export type { AiTaskBusinessObservationDraft, AiTaskClarificationAnswerDraft, AiTaskClarificationObservationDraft, AiTaskClarificationProgressDraft, AiTaskClarificationReceiptQueryDraft, AiTaskDecisionQueryDraft, AiTaskEventPageDraft, AiTaskEventResetDraft, AiTaskHumanContinuationDraft, AiTaskHumanContinueDraft, AiTaskHumanDecisionReceiptDraft, AiTaskHumanReviewDraft, AiTaskMetadataPageDraft, AiTaskMetadataQueryDraft, AiTaskModelObservationDraft, AiTaskModelSourceObservationDraft, AiTaskModelSourceQueryDraft, AiTaskReviewQueryDraft, AiTaskSnapshotDraft, AiTaskStopObservationDraft, AiTaskStopQueryDraft } from "./ai-task-draft";
export { AI_WORKBENCH_CONTEXT_DRAFT_VERSION, AI_WORKBENCH_DISPLAY_DRAFT_VERSION, AI_WORKBENCH_DISPLAY_LIMITS } from "./ai-workbench-display-draft";
export type { AiWorkbenchContextDraft, AiWorkbenchDisplayBindingDraft, AiWorkbenchFieldMaterialDraft, AiWorkbenchHostDraft, AiWorkbenchMountBindingDraft, AiWorkbenchPresentationDraft, AiWorkbenchSandboxMessageDraft } from "./ai-workbench-display-draft";
export { AI_WORKBENCH_DISPLAY_HTTP_SCHEMAS } from "./ai-workbench-display-http-draft";
export type { AiWorkbenchAuthoritativeSummaryDraft } from "./ai-workbench-display-http-draft";
export { AI_WORKBENCH_MODEL_CONTROL_SCHEMAS, AI_WORKBENCH_MODEL_CONTROL_VERSION } from "./ai-workbench-model-control-draft";
export type { AiWorkbenchModelControlCommand, AiWorkbenchModelControlKind, AiWorkbenchModelControlObservation, AiWorkbenchModelControlPreparation, AiWorkbenchModelControlReference } from "./ai-workbench-model-control-draft";
export type { AiApprovalApplicationReferenceDraft } from "./ai-approval-application-draft";
export type { AiGatewayCapabilityAssessmentDraft } from "@rental-os/platform-contracts/ai-gateway";
export type { AiTaskClientVisibleReceiptDraft, AiTaskClientVisibleReportDraft, AiTaskClientVisibleSourceDraft, AiTaskOutcomeSampleDraft, AiTaskPerformanceObservationDraft } from "./ai-task-performance-draft";
export type { AiTaskConfirmationHistoryDraft } from "./ai-task-confirmation-history-draft";
export { isAiTaskInputContractDraft, validateAiTaskInputAnswersDraft } from "./ai-task-input-draft";
export type { AiTaskInputAnswerDraft, AiTaskInputFieldDraft } from "./ai-task-input-draft";
export type { AiTenantModelSettingsSummaryDraft } from "./ai-usage-draft";

/** 原平台模型、预算、价格核对与额度页继续消费同一合同。 */
export { AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT } from "./ai-usage-draft";
export type { AiBudgetLimitDraft, AiPlatformModelCapabilityObservationDraft, AiPlatformModelDirectoryDraft, AiPlatformModelDirectoryQueryDraft, AiPlatformModelSettingsInputDraft, AiPlatformModelSettingsSummaryDraft, AiUsageQuantityDraft } from "./ai-usage-draft";
export { AI_BUDGET_MANAGEMENT_HTTP_DRAFT } from "./ai-budget-management-http-draft";
export type { AiBudgetSettingsChangeDraft, AiBudgetSettingsInitializeDraft, AiBudgetSettingsOperationReadDraft, AiBudgetSettingsReadDraft, AiBudgetSettingsRefreshConfigurationDraft, AiBudgetSettingsSummaryDraft, AiGatewayPlatformPriceAdoptionDraft, AiGatewayPlatformPriceAdoptionReadDraft, AiGatewayPriceConfigurationDraft, AiGatewayPriceConfigurationReadDraft, AiGatewayPriceReviewDraft, AiGatewayPriceReviewReadDraft, AiGatewayPriceReviewResponseDraft, AiGatewayReviewedPriceBillingDraft, AiPlatformBudgetSettingsOperationReadDraft, AiPlatformBudgetSettingsReadDraft, AiPlatformBudgetSettingsSaveDraft, AiPlatformBudgetSettingsSummaryDraft } from "./ai-budget-management-http-draft";
export { AI_CREDIT_HTTP } from "./ai-credit";
export type { AiCreditRequest, AiCreditSummary, AiTenantCallRecords } from "./ai-credit";

/** 原租户模型设置与能力连接检查仍使用原请求和收据协议。 */
export { AI_MODEL_SETTINGS_HTTP_DRAFT } from "./ai-usage-draft";
export type { AiLegacyModelConfigurationDraft, AiLegacyModelConfigurationReferenceDraft, AiTenantModelSettingsInputDraft } from "./ai-usage-draft";
export type { AiProviderDiscoveryInputDraft, AiProviderDiscoveryProtocol, AiProviderDiscoveryResultDraft } from "./ai-provider-discovery-draft";
export type { AiTenantCallRecord } from "./ai-credit";
export { AI_TASK_TERMINAL_STATUSES_DRAFT } from "@rental-os/platform-contracts/ai-task";
export { AI_TEXT_CAPABILITY_HTTP_DRAFT } from "./ai-text-capability-http-draft";
export type { AiTextCapabilityAccountingOperationRequestDraft, AiTextCapabilityAccountingOperationResponseDraft, AiTextCapabilityAccountingResponseDraft, AiTextCapabilityActionRequestDraft, AiTextCapabilityCancelRequestDraft, AiTextCapabilityConfigureActionDraft, AiTextCapabilityHttpResponsesDraft, AiTextCapabilityPrepareRequestDraft } from "./ai-text-capability-http-draft";
