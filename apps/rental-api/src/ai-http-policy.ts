/** 可选 AI 宿主的真实处理器与提交接点。原输入、三条持久执行链、任务中心、恢复、配置
 * 和手动检查各用明确原事务；HTTP 发布不替代原模型/任务开关与当前调用授权。 */
import { compileRentalHttpAccessPolicy, type RentalHttpAccessDeclaration } from "@rental-os/rental-core/http-access-policy";
import { createRentalAuthorization } from "@rental-os/rental-core/http-auth";
import { StaffUploadsController } from "@rental-os/rental-core/http-staff-uploads";
import { matchableRequestPath } from "@rental-os/platform-server/request-path";
import { OperatorEntrySceneCatalogController, StaffEntrySceneCatalogController } from "@rental-os/ai-native-server/runtime/scenes/entry-scene-catalog.controller";
import { RentalStaffInspectionAssistController } from "./ai-inspection-http";
import { InspectionRecognitionTaskController, StaffInspectionAccountingController, INSPECTION_RECOGNITION_TASKS }
  from "@rental-os/ai-native-server/runtime/inspection-assist/inspection-recognition-task.controller";
import { AI_STAFF_INSPECTION_ACCOUNTING } from "@rental-os/ai-native-server/runtime/staff-inspection-accounting.composition";
import { AiOriginalScenesController, AiOriginalSceneRecoveryController, AiOriginalQuoteModelExecutionController,
  AiScenePlanPolicyController, AiOriginalTaskActionPolicyController, AI_SCENE_PLAN_POLICIES, AI_ORIGINAL_TASK_ACTION_POLICIES,
  AI_ORIGINAL_SCENE_REQUESTS, AI_ORIGINAL_SCENE_RECOVERY_REQUESTS,
  AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS } from "@rental-os/ai-native-server/runtime/scenes/original-scenes.controller";
import { AiOriginalOpeningModelExecutionController, AI_ORIGINAL_OPENING_MODEL_REQUESTS } from "@rental-os/ai-native-server/runtime/scenes/opening-model-execution.controller";
import { AiOriginalOrderReadController, AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS } from "@rental-os/ai-native-server/runtime/scenes/original-order-read.controller";
import { AiTaskCenterController, AI_NATIVE_TASK_CENTER_REQUESTS } from "@rental-os/ai-native-server/runtime/task-center.application";
import { AiModelSettingsController, AI_NATIVE_MODEL_SETTINGS_REQUESTS } from "@rental-os/ai-native-server/runtime/model-settings.application";
import { AiConversationController, AI_CONVERSATION_REQUESTS } from "@rental-os/ai-native-server/runtime/conversation.application";
import { AiTaskOrderHandoffController, AI_TASK_ORDER_HANDOFF_REQUESTS } from "@rental-os/ai-native-server/runtime/task-order-handoff.application";
import { AI_STAFF_INSPECTION_REQUESTS } from "@rental-os/ai-native-server/runtime/inspection-assist/staff-inspection-assist.controller";
import * as shared from "@rental-os/shared";
import { RENTAL_HOST_CONTROLLERS } from "./http-policy";
import { RentalWebsiteClientEntryController, RentalWechatClientEntryController } from "./ai-client-http";
import { RentalPlatformBudgetController, RentalTenantBudgetController } from "./ai-budget-http";
import { RentalPlatformCreditController, RentalTenantCreditController } from "./ai-credit-http";
import { AiPlatformModelSettingsController, AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS }
  from "@rental-os/ai-native-server/runtime/platform-model-settings.application";
import { AiGatewayPricingHistoryController, AI_BUDGET_MANAGEMENT, AI_GATEWAY_PRICING_HISTORY }
  from "@rental-os/ai-native-server/runtime/budget/budget-management.module";
import { TextCapabilityProbeController, TEXT_CAPABILITY_PROBE_REQUESTS }
  from "@rental-os/ai-native-server/runtime/text-capability-probe.controller";
import { PlatformCapabilityProbeController, PLATFORM_CAPABILITY_PROBE_REQUESTS }
  from "@rental-os/ai-native-server/runtime/platform-capability-probe/platform-capability-probe.controller";

import { HumanAutomationPolicyRequestController }
  from "@rental-os/ai-native-server/runtime/automation/human-automation-policy-request.controller";
import { HumanAutomationPolicyRequestFactory }
  from "@rental-os/ai-native-server/runtime/automation/human-automation-policy-request.composition";

import { AiRetentionController, AiPlatformRetentionController, AI_RETENTION_REQUESTS, AI_PLATFORM_RETENTION_REQUESTS }
  from "@rental-os/ai-native-server/runtime/privacy/retention.controller";
import { OperatorAutomationController, StaffAutomationController }
  from "@rental-os/ai-native-server/runtime/automation/human-automation-request.controller";
import { HumanAutomationRequestFactory }
  from "@rental-os/ai-native-server/runtime/automation/human-automation-request.composition";
import { AutomationExplanationController }
  from "@rental-os/ai-native-server/runtime/automation/automation-explanation.controller";
import { AutomationExplanationApplication }
  from "@rental-os/ai-native-server/runtime/automation/automation-explanation.application";

export const RENTAL_AI_INSPECTION_OPERATIONS = Object.freeze([
  "fulfillment-receipt-read", "history-read", "receipt-host-read", "host-read", "template-read",
  "evidence-bind", "evidence-fingerprint", "draft-create", "draft-read", "draft-edit", "evidence-replace",
  "draft-operation", "input-prepare", "input-receipt", "result-read", "result-save", "result-save-receipt", "submission-review", "submission-prepare", "submission-preparation", "submission-submit", "submission-read"
]);
export const RENTAL_AI_CONTROLLERS = Object.freeze([
  PlatformCapabilityProbeController, AiRetentionController, AiPlatformRetentionController,
  AutomationExplanationController,
  OperatorAutomationController, StaffAutomationController,
  HumanAutomationPolicyRequestController,
  TextCapabilityProbeController,
  AiPlatformModelSettingsController,
  RentalTenantCreditController, RentalPlatformCreditController,
  RentalTenantBudgetController, RentalPlatformBudgetController, AiGatewayPricingHistoryController,
  OperatorEntrySceneCatalogController, StaffEntrySceneCatalogController, RentalStaffInspectionAssistController,
  InspectionRecognitionTaskController, StaffInspectionAccountingController,
  AiOriginalScenesController, AiOriginalSceneRecoveryController, AiTaskCenterController, AiModelSettingsController,
  AiOriginalQuoteModelExecutionController, AiOriginalOpeningModelExecutionController, AiOriginalOrderReadController,
  AiScenePlanPolicyController, AiOriginalTaskActionPolicyController, AiConversationController, AiTaskOrderHandoffController,
  RentalWebsiteClientEntryController, RentalWechatClientEntryController
]);
export const RENTAL_AI_MOUNTED_REQUESTS: readonly (symbol | Function)[] = Object.freeze([
  PLATFORM_CAPABILITY_PROBE_REQUESTS, AI_RETENTION_REQUESTS, AI_PLATFORM_RETENTION_REQUESTS,
  AutomationExplanationApplication,
  HumanAutomationRequestFactory,
  HumanAutomationPolicyRequestFactory,
  TEXT_CAPABILITY_PROBE_REQUESTS,
  AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS,
  AI_BUDGET_MANAGEMENT, AI_GATEWAY_PRICING_HISTORY,
  AI_STAFF_INSPECTION_REQUESTS, INSPECTION_RECOGNITION_TASKS, AI_STAFF_INSPECTION_ACCOUNTING, AI_ORIGINAL_SCENE_REQUESTS, AI_ORIGINAL_SCENE_RECOVERY_REQUESTS,
  AI_NATIVE_TASK_CENTER_REQUESTS, AI_NATIVE_MODEL_SETTINGS_REQUESTS,
  AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS, AI_ORIGINAL_OPENING_MODEL_REQUESTS, AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS,
  AI_SCENE_PLAN_POLICIES, AI_ORIGINAL_TASK_ACTION_POLICIES, AI_CONVERSATION_REQUESTS, AI_TASK_ORDER_HANDOFF_REQUESTS
]);
function reviewed(controller: RentalHttpAccessDeclaration["controller"], handlers: readonly Function[],
  kind: "buffered-read" | "audited-read" | "transactional-write", evidence: string): RentalHttpAccessDeclaration[] {
  return handlers.map(handler => ({ controller, handler, review: { kind, evidence } }));
}
const scene = AiOriginalScenesController.prototype, recovery = AiOriginalSceneRecoveryController.prototype;
const center = AiTaskCenterController.prototype, settings = AiModelSettingsController.prototype;
const quote = AiOriginalQuoteModelExecutionController.prototype, opening = AiOriginalOpeningModelExecutionController.prototype;
const orders = AiOriginalOrderReadController.prototype;
const plans = AiScenePlanPolicyController.prototype, actions = AiOriginalTaskActionPolicyController.prototype;
const conversations = AiConversationController.prototype;
const capabilityProbe = TextCapabilityProbeController.prototype;
const automationPolicy = HumanAutomationPolicyRequestController.prototype;
const automationExplanation = AutomationExplanationController.prototype;
const inspection = RentalStaffInspectionAssistController.prototype, recognition = InspectionRecognitionTaskController.prototype;
const accounting = StaffInspectionAccountingController.prototype;
const budget = RentalTenantBudgetController.prototype, pricing = AiGatewayPricingHistoryController.prototype;
const credit = RentalTenantCreditController.prototype;
const platformSettings = AiPlatformModelSettingsController.prototype;
const platformBudget = RentalPlatformBudgetController.prototype;
const platformCredit = RentalPlatformCreditController.prototype;
const platformProbe = PlatformCapabilityProbeController.prototype;
const retention = AiRetentionController.prototype, platformRetention = AiPlatformRetentionController.prototype;
const automationControllers = [OperatorAutomationController, StaffAutomationController] as const;
const automationOriginalReads = (controller: typeof automationControllers[number]) => {
  const p = controller.prototype;
  return [p.readPendingBatch, p.readCreation, p.readQueue, p.read, p.forEvent, p.operation, p.readGrant];
};
const declarations: readonly RentalHttpAccessDeclaration[] = [
  ...[AiRetentionController, AiPlatformRetentionController].flatMap(controller => [
    ...reviewed(controller, [controller.prototype.receipt, controller.prototype.receipts], "buffered-read",
    "current workspace manager or independent SaaS view reads bounded original erasure receipts; same selected identity and final response recheck, no body or restore access"),
    ...reviewed(controller, [controller.prototype.cleanup], "transactional-write",
    "bounded original cleanup transactions acquire current workspace Auth/Tenant/Core or independent SaaS principal before scope/content locks and revalidate before commit; unresolved effects, object ACL and exact erasure receipts retained; restore and body protection stay host-only")
  ]),
  ...reviewed(PlatformCapabilityProbeController, [platformProbe.readOriginal, platformProbe.readTask, platformProbe.inspect,
    platformProbe.readHistory, platformProbe.readAccounting, platformProbe.readAccountingOperation], "buffered-read",
  "current SaaS view and original platform request/Task/accounting ownership; same selected identity and final response recheck, no new work"),
  ...reviewed(PlatformCapabilityProbeController, [platformProbe.publish, platformProbe.createTask, platformProbe.start,
    platformProbe.cancel, platformProbe.reconcile, platformProbe.readCapabilityReceipt, platformProbe.releaseUnsent,
    platformProbe.reconcileAccounting], "transactional-write",
  "current SaaS manage in original publication, Task, capability evidence and explicit financial recovery transactions; final authority recheck, same original key and one Gateway ledger, no tenant grant fallback"),
  ...reviewed(AutomationExplanationController, [automationExplanation.read, automationExplanation.prepare], "buffered-read",
  "current human original event and Task lineage; preparation rechecks the published execution boundary and original financial evidence without dispatch"),
  ...reviewed(AutomationExplanationController, [automationExplanation.start], "transactional-write",
  "explicit original explanation admission and Task transactions retain the owning request, current Auth/Tenant/Core and event authority before original locks; Gateway single accounting and same-operation unknown recovery remain"),
  ...automationControllers.flatMap(controller => {
    const p = controller.prototype;
    return [
      ...reviewed(controller, [p.outboxObservation, p.readPendingBatch, p.readInput, p.readCreation,
        p.readQueue, p.read, p.forEvent, p.operation, p.prepareGrant, p.readGrant], "buffered-read",
      "current operator/staff Guard reads original event/input/task/review bindings with final identity and source checks; grant preparation is not approval or dispatch"),
      ...reviewed(controller, [p.readCandidate, p.prepareCandidate, p.preparePending, p.continuePendingBatch,
        p.prepareInput, p.createTask, p.createEventTask, p.close, p.feedback, p.enableGrant], "transactional-write",
      "each original candidate/batch/input/task/grant/review transaction holds current Auth/Tenant/Core and original resource authority before its metadata locks; original keys and separate commit receipts preserve partial unknown without dispatch")
    ];
  }),
  ...reviewed(HumanAutomationPolicyRequestController, [automationPolicy.discover, automationPolicy.read,
    automationPolicy.preview, automationPolicy.preparation, automationPolicy.review, automationPolicy.operation], "buffered-read",
  "current workspace configuration manager observes bounded policy metadata or original preparation/operation receipts with final identity recheck; preview grants no publication or execution"),
  ...reviewed(HumanAutomationPolicyRequestController, [automationPolicy.prepare, automationPolicy.prepareConfirmed,
    automationPolicy.commit, automationPolicy.commitConfirmed], "transactional-write",
  "original confirmed grant/preparation/policy CAS transactions acquire current Auth/Tenant/Core before metadata locks, revalidate before commit and retain original deadlines and operation keys; no model or business dispatch"),
  ...reviewed(TextCapabilityProbeController, [capabilityProbe.prepare, capabilityProbe.readOriginal,
    capabilityProbe.readTask, capabilityProbe.inspect, capabilityProbe.readHistory, capabilityProbe.preflight,
    capabilityProbe.readTaskAction, capabilityProbe.readTaskActionReceipt, capabilityProbe.readAccounting,
    capabilityProbe.readAccountingOperation], "buffered-read",
  "current tenant configuration manager and original probe request/Task/Run/accounting lineage; same selected identity and final response recheck, preparation does not publish, create or dispatch"),
  ...reviewed(TextCapabilityProbeController, [capabilityProbe.publish, capabilityProbe.createTask,
    capabilityProbe.configureTaskAction, capabilityProbe.start, capabilityProbe.cancel, capabilityProbe.reconcile,
    capabilityProbe.readCapabilityReceipt, capabilityProbe.releaseUnsent, capabilityProbe.reconcileAccounting], "transactional-write",
  "original probe publication, action policies and Task transactions hold current Auth/Tenant/Core before original input and Task locks; explicit model start retains Gateway single accounting, capability receipt persists only verified original evidence, unknown stays on the same key"),
  ...reviewed(RentalPlatformCreditController, [platformCredit.platformRead, platformCredit.platformReceipt], "buffered-read",
  "original SaaS read permission observes bounded pending requests or the exact decision receipt; same selected identity and final principal recheck, no allowance increase or tenant content"),
  ...reviewed(RentalPlatformCreditController, [platformCredit.platformDecide], "transactional-write",
  "original SaaS principal and persisted request target lock ordered Tenant parents before request/allowance rows in the same decision transaction; final authority and target checks, original CAS and decision key prevent duplicate grants"),
  ...reviewed(RentalPlatformBudgetController, [platformBudget.platformRead, platformBudget.platformReadOperation,
    platformBudget.platformPriceReviewReceipt], "buffered-read",
  "original SaaS read permission and platform Scope observe existing policies and author-bound operation/rate receipts; same selected identity and final principal recheck, no invocation or pricing publication"),
  ...reviewed(RentalPlatformBudgetController, [platformBudget.platformSave, platformBudget.platformReviewPrice], "transactional-write",
  "original policy CAS/receipt and immutable rate review acquire current SaaS principal and selected data in their owning transactions before policy/Profile writes, revalidate before commit and retain the original unknown operation"),
  ...reviewed(AiPlatformModelSettingsController, [platformSettings.list, platformSettings.read,
    platformSettings.operation, platformSettings.capabilities], "buffered-read",
  "original SaaS management permission, profile ownership and bounded catalog/capability/operation observations; same selected identity and final principal recheck, no probe, model dispatch or credential export"),
  ...reviewed(AiPlatformModelSettingsController, [platformSettings.save], "transactional-write",
  "original platform Scope and vault/Profile CAS transactions acquire current SaaS principal and selected data authority before writes and revalidate before commit; original operation key and unknown receipt remain, no invocation grant"),
  ...reviewed(RentalTenantCreditController, [credit.read, credit.receipt, credit.allocationReceipt, credit.calls], "buffered-read",
  "original tenant-admin credit summary, own request/allocation receipts and bounded same-tenant call metadata; same selected authority and buffered response recheck, original ledger amounts only, no credit grant or model dispatch"),
  ...reviewed(RentalTenantCreditController, [credit.request, credit.allocate], "transactional-write",
  "original request and allowance CAS/receipt transactions lock current Auth/Tenant/Core before credit rows and revalidate before commit; no platform approval, new ledger, payment or task grant, unknown retains the same operation key"),
  ...reviewed(RentalTenantBudgetController, [budget.read, budget.readOperation, budget.readPriceConfiguration,
    budget.readPriceReview, budget.previewPlatformPrice, budget.readPlatformPriceAdoption], "buffered-read",
  "original current tenant management authority and settings/rate receipts; same selected identity and response recheck, no configuration, rate publication or model dispatch"),
  ...reviewed(RentalTenantBudgetController, [budget.initialize, budget.change, budget.refreshConfiguration, budget.adoptPlatformPrice,
    budget.reviewPrice], "transactional-write",
  "original configuration Scope, budget policy CAS/operation and explicit platform-rate adoption retain same Auth/Tenant/Core before owning writes with final transactional revalidation; tenant-authored rate review remains denied, original unknown receipt never replays model or money"),
  ...reviewed(AiGatewayPricingHistoryController, [pricing.readPrice, pricing.readPublication, pricing.readInputBound], "buffered-read",
  "original immutable price/input-bound observations under current management authority and original invocation ownership; same selected identity and response check, no producer, admission, publication or model call"),
  ...reviewed(AiTaskOrderHandoffController, [AiTaskOrderHandoffController.prototype.read], "buffered-read",
  "original Task/Run/input provenance and current guarded order/next-step read; same selected request identity and final scope/source checks, manual handoff grants no approval or execution"),
  ...reviewed(AiConversationController, [conversations.read, conversations.list, conversations.turns,
    conversations.operation, conversations.admission], "buffered-read",
  "original current owner, registered scene and bounded metadata/turn/operation readers; original input and task provenance retained, no admission or model dispatch; selected access rechecks before response"),
  ...reviewed(AiConversationController, [conversations.create, conversations.archive, conversations.delete,
    conversations.release, conversations.closeUnstarted, conversations.admit], "transactional-write",
  "original conversation CAS and operation receipts hold Auth/Tenant/Core in the owning transaction; admission shares original input save and resource fences, closure retains original creation fence and unresolved-effect checks; no implicit Task/model/business execution or unknown replay"),
  ...reviewed(AiConversationController, [conversations.modelResult, conversations.taskResult, conversations.display,
    conversations.displayRevalidate, conversations.displaySource, conversations.prepareModelControl,
    conversations.readModelControl], "audited-read",
  "original Task/Run/result lineage, field bindings, publication and source ACL readers; optional knowledge body uses the existing same-identity sensitive audit, selected response recheck, no new model control or invocation"),
  ...reviewed(AiConversationController, [conversations.modelControl], "transactional-write",
  "explicit same-task pure model control, original source/operation/parent Run and cumulative resource binding; owning registration and runner transactions hold Auth/Tenant/Core before Task CAS, original Gateway single accounting and unknown operation receipt remain"),
  ...[RentalWebsiteClientEntryController, RentalWechatClientEntryController].flatMap(controller => [
    ...reviewed(controller, [controller.prototype.issueBookingTransfer, controller.prototype.consumeBookingTransfer], "transactional-write",
    "original short-lived Booking transfer, current ClientAuth/Tenant/Core before the shared Draft lock, both channel policies locked in fixed order; exact source and reauthenticated target retain one acceptance/attempt/Core key, issue/consume receipts never grant execution"),
    ...reviewed(controller, [controller.prototype.readBookingTransferIssue, controller.prototype.readBookingTransferReceipt], "audited-read",
    "exact original transfer receipts in a nonlocking read snapshot with current client and independent read policy; expiry or stop permits observation only, no renewed reference or target continuation"),
    ...reviewed(controller, [controller.prototype.prepareOriginalQuoteBooking, controller.prototype.issueAction,
      controller.prototype.createBookingDraft, controller.prototype.chooseBookingDraft, controller.prototype.handoffBookingDraft,
      controller.prototype.readBookingDraft, controller.prototype.readBookingHandoff,
      controller.prototype.acceptBookingSubmission, controller.prototype.submitAcceptedBooking], "transactional-write",
    "original quote and explicit Booking selection; same ClientAuth/Tenant/Core locks precede material/Draft/policy CAS, page acceptance and first attempt share the Draft transaction; current reads may persist a bounded invalidation, unknown never re-dispatches Core and submitted is not business success"),
    ...reviewed(controller, [controller.prototype.readOriginalQuoteBookingOperation, controller.prototype.readBookingOperation,
      controller.prototype.readBookingAcceptance, controller.prototype.readBookingSubmission], "audited-read",
    "exact original quote/material/Draft/acceptance/submission receipts under independent read policy and current original client; same selected ALS and immutable reference preserved after expiry or new-work stop, no preparation, new attempt or order dispatch"),
    ...reviewed(controller, [controller.prototype.prepareGoalQuote, controller.prototype.prepareQuoteParameters,
      controller.prototype.confirmQuoteParameters], "transactional-write",
    "original explicit selection and immutable prequote/confirmation-attempt; owning ClientAuth/Tenant/Core precede original source/policy/material locks, current Core normalization and publication rechecked before commit; original attempt permits one quote dispatch, unknown only reads its receipt, no order or payment"),
    ...reviewed(controller, [controller.prototype.readGoalQuotePreparation, controller.prototype.readQuotePreparationOperation,
      controller.prototype.readPreparedQuoteOriginal], "audited-read",
    "same original client and historical preparation scope, frozen selection/hash and original quote reference; current independent read policy and source checks retain refusal audit, no current normalization, preparation, confirmation or quote dispatch"),
    ...reviewed(controller, [controller.prototype.prepareGoal], "transactional-write",
    "original explicit customer goal and frozen public sources; original ClientAuth/Tenant/Core, exact channel publication and source revalidation participate in the original material transaction, no Task/model/quote creation and unknown retains original operation"),
    ...reviewed(controller, [controller.prototype.readGoalPreparation, controller.prototype.readGoalCandidates], "audited-read",
    "original goal receipt or current source-bound candidate projection from the same customer Task/result and explicit clarifications; original selected request identity and nested current client validation retained, no candidate adoption or quote execution"),
    ...reviewed(controller, [controller.prototype.readHostCapabilities, controller.prototype.readOrderTaskHostCapabilities,
      controller.prototype.readOrderAction, controller.prototype.revalidateOrderAction, controller.prototype.readTaskSnapshot,
      controller.prototype.readTaskEvents, controller.prototype.readOrderExplanation, controller.prototype.readSource,
      controller.prototype.readTaskCancellationReceipt, controller.prototype.readTaskCancellationSettlementReceipt], "audited-read",
    "original ClientAuth, channel/publication, owned order/material/Task and current read policy; exact navigation/source and original cancellation receipts, selected refusal audit and response recheck, no creation or model dispatch"),
    ...reviewed(controller, [controller.prototype.requestTaskCancellation, controller.prototype.settleTaskUnstartedCancellation,
      controller.prototype.reconcileTaskInputCancellation], "transactional-write",
    "original same-customer Task cancellation request; Auth/Tenant/Core, owned order, original material and independent cancel policy revalidated in the existing Task control transaction; original CAS/receipt retained, no provider cancellation or rollback inferred"),
    ...reviewed(controller, [controller.prototype.prepareOrderMaterial, controller.prototype.createTask], "transactional-write",
    "original channel-specific ClientAuth and same customer/tenant/workspace request; original material/task creation transactions hold selected Auth/Tenant/Core before original Order/Workspace/task locks and revalidate before commit; original operation receipts and unknown retained"),
    ...reviewed(controller, [controller.prototype.readOrderMaterialReceipt, controller.prototype.readTaskCreation], "audited-read",
    "original client owner and order visibility readers retain standard refusal audit; no task admission, model dispatch or business execution; original same selected client authority and buffered response recheck"),
    ...reviewed(controller, [controller.prototype.startTaskModel, controller.prototype.submitTaskInput,
      controller.prototype.continueTaskInput, controller.prototype.recoverTaskModel, controller.prototype.reconcileTaskModel], "transactional-write",
    "original client order-model runner only; same ClientAuth/Tenant/Core/owner Order and original publication/material before Task/Step/Invocation, original Gateway final locked policy before transport; same-task input and recovery retain original receipts, cumulative resources and unknown, reconciliation may settle the original lease but never creates a new invocation"),
    ...reviewed(controller, [controller.prototype.readTaskInput, controller.prototype.readTaskInputReceipt,
      controller.prototype.readTaskModelResult], "audited-read",
    "original current client owner/model input/result and persisted answer receipt only; original standard refusal/unknown audit retained with selected response recheck, no admission or model dispatch")
  ]),
  ...reviewed(AiScenePlanPolicyController, [plans.read], "buffered-read",
  "original current scene plan policy and operation receipt only; no Scope creation, plan revision, model call or policy grant; same selected response recheck"),
  ...reviewed(AiScenePlanPolicyController, [plans.change], "transactional-write",
  "original Serializable policy CAS and audit hold current Auth/Tenant/Core before Scope/policy locks and revalidate before commit; original unknown operation receipt retained, no model dispatch"),
  ...reviewed(AiOriginalTaskActionPolicyController, [actions.read], "buffered-read",
  "original task policy reader preserves current owner/action and original order visibility; no policy write, task admission or model call; same selected response recheck"),
  ...reviewed(AiOriginalTaskActionPolicyController, [actions.configure, actions.clear], "transactional-write",
  "original task action policy transaction locks current Auth/Tenant/Core then original Order/Workspace before policy CAS and required audit; final same-transaction authorization, exact original revision and receipt/unknown semantics retained"),
  ...reviewed(AiOriginalScenesController, [scene.queryOrders, scene.previewOrderExtension, scene.read, scene.reconcile,
    scene.reconcileReissue, scene.material, scene.materialV2, scene.sourceV2, scene.recovery,
    scene.quoteReview, scene.quoteReceipt, scene.compareOriginalQuotes], "buffered-read",
  "original frozen input/receipt and current guarded business readers; preview/material do not create quotes, tasks, leases or model calls; selected access rechecks before response"),
  ...reviewed(AiOriginalScenesController, [scene.create, scene.reissue, scene.createTask], "transactional-write",
  "original input save/reissue and task creation each retain their Serializable transaction; same Auth/Tenant/Core, original Order/Workspace and frozen input checks precede original writes and revalidate before commit; original operation keys and unknown reconciliation retained"),
  ...reviewed(AiOriginalScenesController, [scene.quoteConfirm], "transactional-write",
  "original guarded quote confirmation uses Rental Core persistQuote under same Tenant/Core/Workspace fence; frozen input/revision and original quote receipt retained, no order or payment execution"),
  ...reviewed(AiOriginalSceneRecoveryController, [recovery.readTaskPage, recovery.readTaskEvents, recovery.readTaskUsage,
    recovery.readTaskScene, recovery.readTaskPerformance, recovery.readInput, recovery.readRecoverySnapshot,
    recovery.readTakeoverReceipt, recovery.readCancellationReceipt, recovery.readCancellationSettlementReceipt,
    recovery.readAnswer], "buffered-read",
  "original persisted task/input/run/result metadata observations under current original provenance/action authority; no new runner, lease or result settlement; selected access rechecks before response"),
  ...reviewed(AiOriginalSceneRecoveryController, [recovery.readModelResult, recovery.readQuoteGoalCandidates,
    recovery.reopenModelSource, recovery.reopenOpeningModelSource], "audited-read",
  "original result/source readers retain original knowledge ACL/consent and required sensitive-read audit; host binds only that audit to original identity and same Auth/Tenant/Core short transaction; buffered response rechecks current access"),
  ...reviewed(AiOriginalSceneRecoveryController, [recovery.requestCancellationIntent, recovery.settleUnstartedCancellation,
    recovery.settleReleasedInputCancellation], "transactional-write",
  "original task transaction authority locks Auth/Tenant/Core and persisted original Order/Workspace before Task mutation; original cancellation/answer CAS and receipts remain, cancel is never proof of remote cancellation or refund"),
  ...reviewed(AiOriginalQuoteModelExecutionController, [quote.readQuotePreparation, quote.readClarifiedQuoteReceipt,
    quote.readExecution], "buffered-read",
  "original frozen quote preparation, confirmation receipt and task recovery snapshot; current original owner/action/source authorization and selected access recheck before response, no quote creation or model dispatch"),
  ...reviewed(AiOriginalQuoteModelExecutionController, [quote.start, quote.refreshInput, quote.submitAnswer, quote.resume,
    quote.continueAnswer, quote.reconcile, quote.recover, quote.takeover, quote.requestCancel, quote.confirmClarifiedQuote], "transactional-write",
  "one original quote runner and Gateway; original request identity survives start/input admission, same-task Auth/Tenant/Core participant runs before original scope/task locks; original plan, lease, answer, budget and confirmation CAS/receipts remain; transport outside database transactions and unknown never authorizes redispatch"),
  ...reviewed(AiOriginalOpeningModelExecutionController, [opening.readExecution], "buffered-read",
  "original opening task recovery snapshot under current original owner/provenance authority and selected response recheck; no settings publication, proposal approval or task start"),
  ...reviewed(AiOriginalOpeningModelExecutionController, [opening.start, opening.recover, opening.reconcile,
    opening.takeover, opening.requestCancel], "transactional-write",
  "dedicated original opening diagnosis provider and persisted runner; same original request/tenant/Core/task transaction authority, admission policy, Gateway accounting and recovery fences; opening execution does not approve or publish business settings"),
  ...reviewed(AiOriginalOrderReadController, [orders.readPreparation, orders.readAnswer, orders.readTakeoverReceipt,
    orders.readOrderResult, orders.readTaskScene, orders.readNextSteps, orders.readTaskSnapshot,
    orders.readCancellationReceipt, orders.readCancellationSettlementReceipt], "buffered-read",
  "original dedicated order explanation readers expose persisted same-task preparation, answer, business projection and receipts; current original order visibility and owner/action provenance plus selected response recheck, no execution admission"),
  ...reviewed(AiOriginalOrderReadController, [orders.readModelResult, orders.reopenModelSource], "audited-read",
  "dedicated original order result/source reader preserves original knowledge ACL and consent; required sensitive-read audit uses current same Auth/Tenant/Core transaction, with final selected access recheck and no new model call"),
  ...reviewed(AiOriginalOrderReadController, [orders.start, orders.recover, orders.resumePrepared,
    orders.takeover, orders.requestCancel, orders.settleUnstartedCancellation], "transactional-write",
  "one dedicated original order explanation chain, never the legacy single-model driver; same-task Auth/Tenant/Core and original order locks precede original admission/plan/run writes; preparation repair, takeover and cancellation retain exact persisted fences, original receipts and no unknown replay"),
  ...reviewed(AiTaskCenterController, [center.list, center.snapshot, center.events, center.stopReceipt, center.usage,
    center.usageSummary, center.outcomes, center.confirmation, center.review, center.decisionReceipt, center.business,
    center.inputReceipt], "buffered-read",
  "original owner/action/provenance readers and stored confirmation/business receipts; no create/dispatch/re-admission; selected access rechecks before response"),
  ...reviewed(AiTaskCenterController, [center.result, center.source, center.performance, center.input], "audited-read",
  "original TaskCenter forwards only persisted same-task sources; optional knowledge content retains its ACL/consent and same selected sensitive audit transaction; no model start or arbitrary source access"),
  ...reviewed(AiTaskCenterController, [center.stop, center.visibleReport, center.decision, center.continue,
    center.resumeInput, center.continueInput], "transactional-write",
  "same-task transaction authority participates in original cancel/approval/input/visibility repositories, Auth/Tenant/Core then original Order/Workspace/Task; original runtime gates, approvals, idempotency and Gateway single accounting retained, unsupported provenance fails closed"),
  ...reviewed(AiModelSettingsController, [settings.read, settings.operation, settings.legacy], "buffered-read",
  "original management Guard and current same-identity configuration/legacy/operation reads; no automatic conversion, budget initialization, model or credential disclosure"),
  ...reviewed(AiModelSettingsController, [settings.save, settings.models, settings.detectProtocols], "transactional-write",
  "Scope and original config/Profile/receipt CAS each hold original Auth/Tenant/Core through final same-tx recheck; metadata discovery checks the same authority before/after its original bounded transport outside transactions; unknown config uses original operation key, no inference"),
  ...[OperatorEntrySceneCatalogController, StaffEntrySceneCatalogController].map(controller => ({ controller,
    handler: controller.prototype.read, review: { kind: "buffered-read" as const,
      evidence: "original current Auth/Guard/scope and read-only scene publication/policy metadata; actual mounted factory filter; no scope creation, task, ledger or model dispatch; same selected access rechecks before return" } })),
  ...reviewed(RentalStaffInspectionAssistController, [inspection.fulfillmentReceiptRead, inspection.historyRead,
    inspection.receiptHostRead, inspection.hostRead, inspection.templateRead, inspection.evidenceFingerprint,
    inspection.draftRead, inspection.draftOperation, inspection.inputReceipt, inspection.resultRead,
    inspection.resultSaveReceipt, inspection.submissionPreparation, inspection.submissionRead], "buffered-read",
  "exact original staff operations preserve current order/location/owner, frozen media/Task/result and human draft revision; receipt reads never prepare, persist candidates or submit fulfillment, same selected identity and final response recheck"),
  ...reviewed(RentalStaffInspectionAssistController, [inspection.evidenceBind, inspection.draftCreate, inspection.draftEdit,
    inspection.evidenceReplace, inspection.inputPrepare, inspection.resultSave, inspection.submissionReview,
    inspection.submissionPrepare, inspection.submissionSubmit], "transactional-write",
  "original staff publication plus explicit operation; owning draft/evidence/input/candidate transactions hold Auth/Tenant/Core then Order and revision with final revalidation; result-save persists review candidates only, explicit human adoption and original idempotent Core submission stay separate"),
  ...reviewed(InspectionRecognitionTaskController, [recognition.readCreation, recognition.readResultReference,
    recognition.readInput, recognition.readAnswer, recognition.readCancelReceipt, recognition.readCancellationSettlementReceipt], "buffered-read",
  "original current staff owner/order and persisted input/Task/Run lineage, current action and frozen result readers; no profile, lease, model, input submission or fulfillment dispatch; same selected identity survives original read wrappers"),
  ...reviewed(InspectionRecognitionTaskController, [recognition.create, recognition.start, recognition.resume,
    recognition.continueAnswer, recognition.reconcile, recognition.requestCancel, recognition.settleUnstartedCancellation,
    recognition.settleReleasedInputCancellation], "transactional-write",
  "original staff input/task and independent explicit execution; Auth/Tenant/Core/Order precede original Task CAS, current deployment/policy and Gateway financial authority retained; cancellation and reconciliation observe the original attempt without automatic redispatch"),
  ...reviewed(StaffInspectionAccountingController, [accounting.read], "buffered-read",
  "current same staff and Task action authority reads the exact original invocation/financial receipt; independent of new recognition, no reservation, release or settlement"),
  ...reviewed(StaffInspectionAccountingController, [accounting.reconcile], "transactional-write",
  "original owned invocation and persisted usage/dispatch evidence settle the same financial reservation under original budget locks; no new model call, reservation or inferred refund, current authority checked before original mutation"),
  { controller: StaffUploadsController, handler: StaffUploadsController.prototype.bindInspectionEvidence,
    review: { kind: "transactional-write", evidence: "original HTTP request credentials enter the same inspection request factory; current Auth Tenant/Core/Order and original exact asset/template/revision checks share the original evidence transaction" } }
];

export function createRentalAiHttpPolicy(authorization = createRentalAuthorization(shared)) {
  return compileRentalHttpAccessPolicy({ controllers: [...RENTAL_HOST_CONTROLLERS, ...RENTAL_AI_CONTROLLERS],
    authorization, declarations });
}

/** Global management is selected from the mounted reviewed handlers, not a
 * platform URL prefix. The Core layer still requires its original SaaS lease. */
export function rentalAiPlatformManagementSelector(policy: ReturnType<typeof createRentalAiHttpPolicy>) {
  const handlers = new Map<Function, readonly Function[]>([
    [AiPlatformRetentionController, [platformRetention.cleanup, platformRetention.receipt, platformRetention.receipts]],
    [PlatformCapabilityProbeController, [platformProbe.publish, platformProbe.readOriginal, platformProbe.createTask,
      platformProbe.readTask, platformProbe.start, platformProbe.inspect, platformProbe.cancel, platformProbe.reconcile,
      platformProbe.readCapabilityReceipt, platformProbe.readHistory, platformProbe.readAccounting,
      platformProbe.readAccountingOperation, platformProbe.releaseUnsent, platformProbe.reconcileAccounting]],
    [AiPlatformModelSettingsController, [platformSettings.list, platformSettings.read, platformSettings.operation,
      platformSettings.capabilities, platformSettings.save]],
    [RentalPlatformBudgetController, [platformBudget.platformRead, platformBudget.platformReadOperation,
      platformBudget.platformPriceReviewReceipt, platformBudget.platformSave, platformBudget.platformReviewPrice]],
    [RentalPlatformCreditController, [platformCredit.platformRead, platformCredit.platformDecide, platformCredit.platformReceipt]]
  ]);
  const routes = policy.routes.filter(route => handlers.get(route.controller)?.includes(route.handler))
    .map(route => ({ ...route, pattern: new RegExp(`^${route.path.split('/').map(segment => segment.startsWith(':')
      ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/')}$`, 'u') }));
  return Object.freeze({ isRoute: (request: { method: string; url: string }) => routes.some(route =>
    route.method === request.method.toUpperCase() && route.pattern.test(matchableRequestPath(request.url))) });
}

/** 只免除部署停新检查，不免当前身份、租户/Core、对象或物理可用性。
 * 明确原处理器和原路径构成闭集；混合 decision 仍由原事务区分拒绝与新批准，
 * recover/reconcile 仍由原 lease/receipt 仓储裁定，不能据此创建或重新派发。 */
export function rentalAiDeploymentContinuationSelector(policy: ReturnType<typeof createRentalAiHttpPolicy>) {
  const selected = new Map<Function, readonly Function[]>([
    [AiRetentionController, [retention.cleanup, retention.receipt, retention.receipts]],
    [AiPlatformRetentionController, [platformRetention.cleanup, platformRetention.receipt, platformRetention.receipts]],
    [PlatformCapabilityProbeController, [platformProbe.readOriginal, platformProbe.readTask, platformProbe.inspect,
      platformProbe.readHistory, platformProbe.readAccounting, platformProbe.readAccountingOperation,
      platformProbe.cancel, platformProbe.reconcile, platformProbe.releaseUnsent, platformProbe.reconcileAccounting]],
    [AutomationExplanationController, [automationExplanation.read]],
    ...automationControllers.map(controller => [controller, automationOriginalReads(controller)] as [Function, readonly Function[]]),
    [HumanAutomationPolicyRequestController, [automationPolicy.preparation, automationPolicy.review, automationPolicy.operation]],
    [TextCapabilityProbeController, [capabilityProbe.readOriginal, capabilityProbe.readTask, capabilityProbe.inspect,
      capabilityProbe.readTaskAction, capabilityProbe.readTaskActionReceipt, capabilityProbe.readHistory,
      capabilityProbe.readAccounting, capabilityProbe.readAccountingOperation, capabilityProbe.cancel,
      capabilityProbe.reconcile, capabilityProbe.releaseUnsent, capabilityProbe.reconcileAccounting]],
    [RentalTenantCreditController, [credit.receipt, credit.allocationReceipt, credit.calls]],
    [RentalTenantBudgetController, [budget.readOperation, budget.readPriceReview, budget.readPlatformPriceAdoption]],
    [AiGatewayPricingHistoryController, [pricing.readPrice, pricing.readPublication, pricing.readInputBound]],
    [RentalStaffInspectionAssistController, [inspection.fulfillmentReceiptRead, inspection.historyRead, inspection.receiptHostRead,
      inspection.hostRead, inspection.templateRead, inspection.draftRead, inspection.draftOperation, inspection.inputReceipt,
      inspection.resultRead, inspection.resultSaveReceipt, inspection.submissionPreparation, inspection.submissionRead]],
    [InspectionRecognitionTaskController, [recognition.readCreation, recognition.readResultReference, recognition.readInput,
      recognition.readAnswer, recognition.reconcile, recognition.requestCancel, recognition.readCancelReceipt,
      recognition.settleUnstartedCancellation, recognition.settleReleasedInputCancellation, recognition.readCancellationSettlementReceipt]],
    [StaffInspectionAccountingController, [accounting.read, accounting.reconcile]],
    [AiTaskOrderHandoffController, [AiTaskOrderHandoffController.prototype.read]],
    [AiConversationController, [conversations.read, conversations.list, conversations.turns, conversations.operation,
      conversations.admission, conversations.archive, conversations.delete, conversations.release, conversations.closeUnstarted,
      conversations.modelResult, conversations.taskResult, conversations.display, conversations.displayRevalidate,
      conversations.displaySource, conversations.readModelControl]],
    [AiOriginalScenesController, [scene.read, scene.reconcile, scene.reconcileReissue, scene.material,
      scene.materialV2, scene.sourceV2, scene.recovery, scene.quoteReview, scene.quoteReceipt, scene.compareOriginalQuotes]],
    [AiOriginalSceneRecoveryController, [recovery.readTaskPage, recovery.readTaskEvents, recovery.readTaskUsage,
      recovery.readTaskScene, recovery.readTaskPerformance, recovery.readInput, recovery.readRecoverySnapshot,
      recovery.readTakeoverReceipt, recovery.readCancellationReceipt, recovery.readCancellationSettlementReceipt,
      recovery.readAnswer, recovery.readModelResult, recovery.readQuoteGoalCandidates, recovery.reopenModelSource,
      recovery.reopenOpeningModelSource, recovery.requestCancellationIntent, recovery.settleUnstartedCancellation,
      recovery.settleReleasedInputCancellation]],
    [AiOriginalQuoteModelExecutionController, [quote.readQuotePreparation, quote.readClarifiedQuoteReceipt,
      quote.readExecution, quote.reconcile, quote.recover, quote.requestCancel]],
    [AiOriginalOpeningModelExecutionController, [opening.readExecution, opening.reconcile, opening.recover, opening.requestCancel]],
    [AiOriginalOrderReadController, [orders.readPreparation, orders.readAnswer, orders.readTakeoverReceipt,
      orders.readOrderResult, orders.readTaskScene, orders.readNextSteps, orders.readTaskSnapshot,
      orders.readCancellationReceipt, orders.readCancellationSettlementReceipt, orders.readModelResult,
      orders.reopenModelSource, orders.recover, orders.requestCancel, orders.settleUnstartedCancellation]],
    [AiTaskCenterController, [center.list, center.snapshot, center.events, center.stopReceipt, center.usage,
      center.usageSummary, center.outcomes, center.confirmation, center.review, center.decisionReceipt,
      center.business, center.inputReceipt, center.result, center.source, center.performance, center.input,
      center.stop, center.decision]],
    [AiScenePlanPolicyController, [plans.read]],
    [AiOriginalTaskActionPolicyController, [actions.read, actions.clear]],
    [AiModelSettingsController, [settings.operation]],
    ...[RentalWebsiteClientEntryController, RentalWechatClientEntryController].map(controller => [controller,
      [controller.prototype.readHostCapabilities, controller.prototype.readOrderTaskHostCapabilities,
        controller.prototype.readOrderAction, controller.prototype.revalidateOrderAction, controller.prototype.readTaskSnapshot,
        controller.prototype.readTaskEvents, controller.prototype.readOrderExplanation, controller.prototype.readSource,
        controller.prototype.requestTaskCancellation, controller.prototype.readTaskCancellationReceipt,
        controller.prototype.readTaskCancellationSettlementReceipt,
        controller.prototype.settleTaskUnstartedCancellation, controller.prototype.reconcileTaskInputCancellation,
        controller.prototype.readOrderMaterialReceipt, controller.prototype.readGoalPreparation, controller.prototype.readTaskCreation,
        controller.prototype.readGoalQuotePreparation, controller.prototype.readQuotePreparationOperation,
        controller.prototype.readPreparedQuoteOriginal, controller.prototype.readOriginalQuoteBookingOperation,
        controller.prototype.readBookingOperation, controller.prototype.readBookingAcceptance, controller.prototype.readBookingSubmission,
        controller.prototype.readBookingTransferIssue, controller.prototype.readBookingTransferReceipt,
        controller.prototype.readTaskInput, controller.prototype.readTaskInputReceipt,
        controller.prototype.readTaskModelResult, controller.prototype.recoverTaskModel,
        controller.prototype.reconcileTaskModel]] as [Function, readonly Function[]])
  ]);
  const routes = policy.routes.filter(route => selected.get(route.controller)?.includes(route.handler))
    .map(route => ({ ...route, pattern: new RegExp(`^${route.path.split('/').map(segment => segment.startsWith(':')
        ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/')}$`, 'u') }));
  const matches = (route: typeof routes[number], request: { method: string; url: string }) =>
    route.method === request.method.toUpperCase() && route.pattern.test(matchableRequestPath(request.url));
  return Object.freeze({
    isHandler: (controller: Function, handler: Function, request?: { method: string; url: string }) =>
      routes.some(route => route.controller === controller && route.handler === handler
        && (!request || matches(route, request))),
    isRoute: (request: { method: string; url: string }) => routes.some(route => matches(route, request))
  });
}

export function rentalAiRouteSelector(policy: ReturnType<typeof createRentalAiHttpPolicy>) {
  const routes = policy.routes.filter(route => RENTAL_AI_CONTROLLERS.some(controller => route.controller === controller)
    || route.controller === StaffUploadsController && route.handler === StaffUploadsController.prototype.bindInspectionEvidence);
  const patterns = routes.map(route => ({ route,
    pattern: new RegExp(`^${route.path.split("/").map(segment => segment.startsWith(":") ? "[^/]+" : segment.replace(/\./g, "\\.")).join("/")}$`, "u") }));
  return Object.freeze({
    isHandler: (controller: Function, handler: Function) => routes.some(route => route.controller === controller && route.handler === handler),
    isRoute: (request: { method: string; url: string }) => patterns.some(({ route, pattern }) =>
      route.method === request.method.toUpperCase() && pattern.test(matchableRequestPath(request.url))),
    isClientRoute: (request: { method: string; url: string }) => patterns.some(({ route, pattern }) =>
      (route.controller === RentalWebsiteClientEntryController || route.controller === RentalWechatClientEntryController)
      && route.method === request.method.toUpperCase() && pattern.test(matchableRequestPath(request.url)))
  });
}

/** Core停用后仅核对已有操作、回答和结果。原控制器继续校验原Task/Run/键和对象权限；
 * 不包含输入提交、创建任务、批准/决策、recover/reconcile执行器或任何模型派发。
 * 从真实controller/handler闭集取路由，并要求只读审定；请求标志不能扩展此集合。 */
export function rentalAiOriginalReceiptSelector(policy: ReturnType<typeof createRentalAiHttpPolicy>) {
  const selected = new Map<Function, readonly Function[]>([
    [AiRetentionController, [retention.receipt, retention.receipts]],
    [AutomationExplanationController, [automationExplanation.read]],
    ...automationControllers.map(controller => [controller, automationOriginalReads(controller)] as [Function, readonly Function[]]),
    [HumanAutomationPolicyRequestController, [automationPolicy.preparation, automationPolicy.review, automationPolicy.operation]],
    [TextCapabilityProbeController, [capabilityProbe.readOriginal, capabilityProbe.readTask, capabilityProbe.inspect,
      capabilityProbe.readTaskAction, capabilityProbe.readTaskActionReceipt, capabilityProbe.readHistory,
      capabilityProbe.readAccounting, capabilityProbe.readAccountingOperation]],
    [RentalTenantCreditController, [credit.receipt, credit.allocationReceipt, credit.calls]],
    [RentalTenantBudgetController, [budget.readOperation, budget.readPriceReview, budget.readPlatformPriceAdoption]],
    [AiGatewayPricingHistoryController, [pricing.readPrice, pricing.readPublication, pricing.readInputBound]],
    [RentalStaffInspectionAssistController, [inspection.fulfillmentReceiptRead, inspection.receiptHostRead,
      inspection.draftOperation, inspection.inputReceipt, inspection.resultRead, inspection.resultSaveReceipt,
      inspection.submissionPreparation, inspection.submissionRead]],
    [InspectionRecognitionTaskController, [recognition.readCreation, recognition.readResultReference, recognition.readInput,
      recognition.readAnswer, recognition.readCancelReceipt, recognition.readCancellationSettlementReceipt]],
    [StaffInspectionAccountingController, [accounting.read]],
    [AiConversationController, [conversations.operation, conversations.modelResult, conversations.taskResult,
      conversations.readModelControl]],
    [AiOriginalScenesController, [scene.reconcile, scene.reconcileReissue, scene.recovery]],
    [AiOriginalSceneRecoveryController, [recovery.readRecoverySnapshot, recovery.readTakeoverReceipt,
      recovery.readCancellationReceipt, recovery.readCancellationSettlementReceipt, recovery.readAnswer, recovery.readModelResult]],
    [AiOriginalOrderReadController, [orders.readAnswer, orders.readModelResult, orders.readTaskSnapshot,
      orders.readTakeoverReceipt, orders.readCancellationReceipt, orders.readCancellationSettlementReceipt]],
    [AiOriginalQuoteModelExecutionController, [quote.readExecution, quote.readClarifiedQuoteReceipt]],
    [AiOriginalOpeningModelExecutionController, [opening.readExecution]],
    [AiTaskCenterController, [center.stopReceipt, center.decisionReceipt, center.inputReceipt, center.result]],
    ...[RentalWebsiteClientEntryController, RentalWechatClientEntryController].map(controller => [controller,
      [controller.prototype.readGoalPreparation, controller.prototype.readTaskCreation, controller.prototype.readTaskInputReceipt,
        controller.prototype.readGoalQuotePreparation, controller.prototype.readQuotePreparationOperation,
        controller.prototype.readPreparedQuoteOriginal, controller.prototype.readOriginalQuoteBookingOperation,
        controller.prototype.readBookingOperation, controller.prototype.readBookingAcceptance, controller.prototype.readBookingSubmission,
        controller.prototype.readBookingTransferIssue, controller.prototype.readBookingTransferReceipt,
        controller.prototype.readTaskModelResult, controller.prototype.readTaskCancellationReceipt,
        controller.prototype.readTaskCancellationSettlementReceipt]] as [Function, readonly Function[]])
  ]);
  const routes = policy.routes.filter(route => selected.get(route.controller)?.includes(route.handler));
  if (routes.some(route => route.method !== "POST" || !["buffered-read", "audited-read"].includes(route.review.kind)))
    throw new Error("原AI收据恢复登记必须对应已审定的POST读取处理器");
  const keys = new Set(routes.map(route => route.method + " " + route.path));
  if (routes.some(route => route.path.includes(":"))) throw new Error("原AI收据恢复不能使用泛化参数路径");
  return Object.freeze({ isRoute: (request: { method: string; url: string }) =>
    keys.has(request.method.toUpperCase() + " " + matchableRequestPath(request.url)) });
}
