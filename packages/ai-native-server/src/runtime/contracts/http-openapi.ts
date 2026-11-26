/** 原 AI Native OpenAPI 单源贡献。实际宿主只发布已挂载且审定的处理器；文档不授予调用或执行权限。 */
import { ref, objectOf, clientOperation, RENTAL_HTTP_COMPONENT_SCHEMAS,
  type SchemaObject, type ContractOperation } from "@rental-os/rental-core/http-openapi";
import { AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT, AI_TASK_OPENING_PROPOSAL_HTTP_CONTRACTS } from '@rental-os/shared';
import { AI_TASK_READ_POLICY_HTTP, AI_TASK_READ_POLICY_SCHEMAS } from '@rental-os/shared';
import { AI_CATEGORY_PROPOSAL_HTTP, AI_CATEGORY_PROPOSAL_CONTRACTS } from '@rental-os/shared';
import { STAFF_FULFILLMENT_RECEIPT_HTTP, STAFF_FULFILLMENT_RECEIPT_CONTRACT } from '@rental-os/shared';
import { AI_TASK_ORIGINAL_READ_POLICY_HTTP, AI_TASK_ORIGINAL_READ_POLICY_ENTRY_PERMISSIONS } from '@rental-os/shared';
import { AI_TASK_ORDER_HANDOFF_HTTP, AI_TASK_ORDER_HANDOFF_SCHEMAS } from '@rental-os/shared';
import { AI_TASK_CALENDAR_DRAFT_HTTP, AI_TASK_CALENDAR_DRAFT_CONTRACTS, AI_TASK_CALENDAR_DRAFT_SCHEMAS, AI_TASK_CALENDAR_DRAFT_READ_PERMISSIONS } from "@rental-os/shared";
import { AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP, AI_TASK_CALENDAR_DRAFT_PREPARATION_CONTRACTS, AI_TASK_CALENDAR_DRAFT_PREPARATION_SCHEMAS } from '@rental-os/shared';
import { AI_MEMBER_NAME_HTTP, AI_MEMBER_NAME_SCHEMAS, AI_MEMBER_NAME_CONTRACTS } from '@rental-os/shared';
import { AI_TASK_RULE_DRAFT_HTTP, AI_TASK_RULE_DRAFT_CONTRACTS, AI_TASK_RULE_DRAFT_SCHEMAS, AI_TASK_RULE_DRAFT_READ_PERMISSIONS } from "@rental-os/shared";
import { AI_TASK_RULE_SOURCE_ENTRY_HTTP, AI_TASK_RULE_SOURCE_ENTRY_CONTRACTS, AI_TASK_RULE_SOURCE_ENTRY_SCHEMAS } from '@rental-os/shared';
import { AI_NATIVE_COMPONENT_SCHEMAS } from "./ai-native-schemas";
import { AI_TASK_DRAFT_COMPONENT_SCHEMAS } from "./ai-task-draft-schemas";
import { AI_LEAF_COMPONENT_SCHEMAS } from "./ai-leaf-components";
import { DESKTOP_BUSINESS_SCHEMAS, DESKTOP_BUSINESS_OPERATIONS } from './ai-desktop-business-schemas';
import { AI_AUTOMATION_EVENT_TASK_HTTP_DRAFT } from '@rental-os/shared';
import { AI_AUTOMATION_REVIEW_HTTP_CONTRACTS, AI_AUTOMATION_REVIEW_GRANT_HTTP_DRAFT, AI_AUTOMATION_PENDING_BATCH_HTTP_DRAFT } from '@rental-os/shared';
import { AI_AUTOMATION_EXPLANATION_HTTP, AI_AUTOMATION_EXPLANATION_CONTRACTS } from '@rental-os/shared';
import { AI_AUTOMATION_POLICY_HTTP_CONTRACTS } from '@rental-os/shared';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, AI_SCENE_MODEL_HTTP_DRAFT, AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS, AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT } from "@rental-os/shared";
import { AI_CLIENT_PUBLIC_HTTP, AI_CLIENT_PUBLIC_CONTRACTS } from '@rental-os/shared';
import { AI_SCENE_REQUEST_HTTP_CONTRACTS, AI_ORIGINAL_SCENE_QUOTE_HTTP_CONTRACTS, AI_ORDER_EXPLANATION_HTTP_V2, AI_ORDER_EXPLANATION_HTTP_CONTRACTS_V2 } from '@rental-os/shared';
import { AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT, AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT } from "@rental-os/shared";
import { AI_TEXT_CAPABILITY_HTTP_DRAFT, AI_PLATFORM_CAPABILITY_HTTP_DRAFT, AI_PLATFORM_CAPABILITY_HTTP_OPERATIONS } from "@rental-os/shared";
import { AI_COUNTING_HTTP_DRAFT, AI_COUNTING_HTTP_OPERATIONS } from '@rental-os/shared';
import { AI_BUDGET_MANAGEMENT_HTTP_DRAFT } from "@rental-os/shared";
import { AI_CREDIT_COMPONENT_SCHEMAS, AI_CREDIT_OPERATIONS } from './ai-credit';
import { AI_MODEL_SETTINGS_HTTP_DRAFT } from '@rental-os/shared';
import { PLATFORM_AI_MODEL_SETTINGS_OPERATIONS } from '../../configuration/platform-model-settings-policy';
import { AI_PROVIDER_DISCOVERY_INPUT_SCHEMA, AI_PROVIDER_DISCOVERY_RESULT_SCHEMA } from '@rental-os/shared';
import { AI_TASK_CENTER_HTTP_DRAFT, AI_TASK_CENTER_ENTRY_PERMISSIONS, AI_CONVERSATION_HTTP_DRAFT } from '@rental-os/shared';
import { AI_TASK_CENTER_RECOVERY_HTTP, AI_TASK_CENTER_RECOVERY_CONTRACTS } from '@rental-os/shared';
import { AI_QUOTE_SELECTION_HTTP_DRAFT, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT, AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT, AI_QUOTE_SELECTION_HTTP_CONTRACTS, AI_CLARIFIED_QUOTE_SELECTION_HTTP_CONTRACTS, AI_APPROVED_SETTINGS_CHANGE_HTTP_CONTRACTS, AI_APPROVED_SETTINGS_READ_HTTP_CONTRACTS, AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS, AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS } from '@rental-os/shared';
import { AI_MEMORY_MANAGEMENT_HTTP_DRAFT, AI_KNOWLEDGE_POLICY_HTTP_DRAFT, AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT, AI_KNOWLEDGE_TARGET_HTTP_CONTRACTS } from '@rental-os/shared';
import { AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT } from '@rental-os/shared';
import { AI_SCENE_ORDER_READ_HTTP_DRAFT, AI_ORDER_READ_HTTP_CONTRACTS, AI_SCENE_PLAN_POLICY_HTTP_DRAFT, AI_SCENE_REQUEST_HTTP_DRAFT } from "@rental-os/shared";
import { AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT, AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT, AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS, AI_INSPECTION_TASK_HTTP_CONTRACTS, AI_INSPECTION_TASK_POLICY_HTTP_CONTRACTS } from '@rental-os/shared';
import { AI_RETENTION_HTTP_CONTRACTS, AI_ORIGINAL_POLICY_HTTP_CONTRACTS, AI_CLIENT_TASK_POLICY_HTTP_DRAFT, AI_CLIENT_POLICY_HTTP_CONTRACTS, AI_INSPECTION_MANUAL_HTTP_CONTRACTS, AI_INSPECTION_LIFECYCLE_HTTP_CONTRACTS, AI_CATEGORY_DRAFT_HTTP_CONTRACTS } from '@rental-os/shared';
import { AI_PLATFORM_RETENTION_HTTP, AI_PLATFORM_RETENTION_HTTP_CONTRACTS } from '@rental-os/shared';
import { AI_ENTRY_SCENE_CATALOG_HTTP, AI_ENTRY_SCENE_CATALOG_CONTRACTS } from '@rental-os/shared';
import { AI_REGISTERED_ENTRY_ACTION_HTTP, AI_REGISTERED_ENTRY_ACTION_CONTRACTS } from '@rental-os/shared';
import { AI_ENTRY_NOTIFICATION_DRAFT_HTTP, AI_ENTRY_NOTIFICATION_DRAFT_CONTRACTS } from '@rental-os/shared';

const SETTINGS_TASK_CONTRACTS: Record<string, readonly [string, string]> = {
  ...Object.fromEntries(Object.entries(AI_APPROVED_SETTINGS_READ_HTTP_CONTRACTS)
    .map(([name, contract]) => [name, [contract.request, contract.response] as const])),
  ...Object.fromEntries(Object.entries(AI_APPROVED_SETTINGS_CHANGE_HTTP_CONTRACTS)
    .map(([name, contract]) => [name, [contract.request, contract.response] as const])),
  createSettingsTask: ['AiApprovedSettingsTaskCreationDraft', 'AiApprovedSettingsTaskCreatedDraft'],
  readSettingsTaskCreation: ['AiApprovedSettingsTaskCreationDraft', 'AiApprovedSettingsTaskCreationReadDraft'],
  requestOriginalSettingsCancellation: ['AiApprovedSettingsTaskCancellationDraft', 'AiApprovedSettingsTaskCancellationResultDraft'],
  readOriginalSettingsCancellation: ['AiApprovedSettingsTaskCancellationDraft', 'AiApprovedSettingsTaskCancellationReadDraft'],
  settleUnstartedSettingsCancellation: ['AiApprovedSettingsTaskCancellationDraft', 'AiApprovedSettingsTaskCancellationResultDraft'],
  readOriginalSettingsCancellationSettlement: ['AiApprovedSettingsTaskCancellationDraft', 'AiApprovedSettingsTaskCancellationReadDraft'],
  startOriginalSettingsTask: ['AiApprovedSettingsTaskCreationDraft', 'AiApprovedSettingsTaskRunDraft'],
  startSettingsTask: ['AiApprovedSettingsTaskRunRequestDraft', 'AiApprovedSettingsTaskRunDraft'],
  readSettingsConfirmation: ['AiApprovedSettingsTaskCheckpointReadDraft', 'AiApprovedSettingsTaskCheckpointDraft'],
  decideSettingsProposal: ['AiApprovedSettingsDecisionDraft', 'AiApprovedSettingsDecisionReceiptDraft'],
  readSettingsDecision: ['AiApprovedSettingsReferenceDraft', 'AiApprovedSettingsDecisionReceiptDraft'],
  continueSettingsConfirmation: ['AiApprovedSettingsTaskContinueDraft', 'AiApprovedSettingsTaskRunDraft'],
  reconcileSettingsTask: ['AiApprovedSettingsTaskRunRequestDraft', 'AiApprovedSettingsTaskRecoveryDraft'],
  cancelSettingsTask: ['AiApprovedSettingsTaskCancelDraft', 'AiApprovedSettingsTaskCancelResponseDraft'],
  configureSettingsTaskPolicy: ['AiApprovedSettingsTaskPolicyConfigureDraft', 'AiApprovedSettingsTaskPolicyMutationDraft'],
  readSettingsTaskPolicy: ['AiApprovedSettingsTaskPolicyReadDraft', 'AiApprovedSettingsTaskPolicyReadResultDraft'],
  clearSettingsTaskPolicy: ['AiApprovedSettingsTaskPolicyClearDraft', 'AiApprovedSettingsTaskPolicyMutationDraft'],
  readSettingsTaskPolicyOperation: ['AiApprovedSettingsTaskPolicyOperationReadDraft', 'AiApprovedSettingsTaskPolicyOperationDraft']
};

// Recovery uses the original transition receipts, without constructing model
// admission or claiming that cancellation reverses a business operation.
const cancellationIntentReceipt = AI_LEAF_COMPONENT_SCHEMAS.AiSceneModelCancelResponseDraft.properties!.receipt;
const cancellationSettledReceipt = AI_LEAF_COMPONENT_SCHEMAS.AiSceneModelReconcileResponseDraft.oneOf![1].properties!.receipt;
const RECOVERY_RESPONSE_SCHEMAS: Record<string, SchemaObject> = {
  AiOriginalCancellationIntentResponse: objectOf({ receipt: cancellationIntentReceipt,
    cancellation: { type: 'string', enum: ['requested_not_rollback'] }, settlement: { nullable: true, enum: [null] },
    settlementState: { type: 'string', enum: ['not_attempted'] } }, ['receipt', 'cancellation', 'settlement', 'settlementState'], false),
  AiOriginalUnstartedCancellationResponse: objectOf({ original: ref('AiSceneRequestReadDraft'), receipt: cancellationSettledReceipt,
    cancellation: { type: 'string', enum: ['unstarted_task_cancelled_not_business_rollback'] },
    automaticRetry: { type: 'boolean', enum: [false] } }, ['original', 'receipt', 'cancellation', 'automaticRetry'], false),
  AiOriginalInputWaitCancellationResponse: objectOf({ original: ref('AiSceneRequestReadDraft'), receipt: cancellationSettledReceipt,
    cancellation: { type: 'string', enum: ['released_input_wait_cancelled_not_business_rollback'] },
    resourceRelease: { type: 'string', enum: ['not_attempted'] }, automaticRetry: { type: 'boolean', enum: [false] } },
    ['original', 'receipt', 'cancellation', 'resourceRelease', 'automaticRetry'], false)
};

export const AI_HTTP_OPERATIONS: ContractOperation[] = [
...Object.entries(AI_TASK_OPENING_PROPOSAL_HTTP_CONTRACTS).map(([action, contract]) => ({
    method: 'post' as const, path: `/api/${AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT.basePath}/${action}`, tag: 'AI Native',
    operationId: `taskOpeningProposal_${action}`, permissions: action === 'prepare' ? ['rental-os:price:manage'] : ['rental-os:order:view', 'rental-os:price:manage'],
    summary: 'Current original diagnosis and Core section are revalidated. Preview is read-only; explicit preparation creates one linked original R1 Task and AI proposal. No active configuration, business draft, publication or model dispatch. Unknown uses the same original operation; history never resumes preparation.',
    requestSchema: contract.request, responseSchema: contract.response,
  })),
...Object.entries(AI_ENTRY_NOTIFICATION_DRAFT_CONTRACTS).map(([action, contract]) => ({
    method: 'post' as const, path: `/api/${AI_ENTRY_NOTIFICATION_DRAFT_HTTP.basePath}/${AI_ENTRY_NOTIFICATION_DRAFT_HTTP[action as keyof typeof AI_ENTRY_NOTIFICATION_DRAFT_CONTRACTS]}`,
    tag: 'AI Native', operationId: `entryNotificationDraft_${action}`, authRequired: true, permissions: ['system:integration:manage'],
    summary: '明确准备和保存未发送通知草稿，按原操作读取；不发送、不重试或刷新供应商。',
    requestSchema: contract.request, responseSchema: contract.response,
  })),
...(['operatorBasePath', 'staffBasePath', 'websiteBasePath', 'wechatBasePath'] as const).flatMap(surface =>
    Object.entries(AI_REGISTERED_ENTRY_ACTION_CONTRACTS).map(([action, contract]) => ({
      method: 'post' as const, path: `/api/${AI_REGISTERED_ENTRY_ACTION_HTTP[surface]}/${AI_REGISTERED_ENTRY_ACTION_HTTP[action as keyof typeof AI_REGISTERED_ENTRY_ACTION_CONTRACTS]}`,
      tag: 'AI Native', operationId: `registeredEntryAction_${surface}_${action}`, authRequired: true, permissions: [],
      summary: 'Current server-issued fixed Action; original resource authorization, version and expiry rechecked. No business dispatch.',
      requestSchema: contract.request, responseSchema: contract.response,
    }))),
...(['operatorBasePath', 'staffBasePath', 'websiteBasePath', 'wechatBasePath'] as const).map(surface => ({
    method: 'post' as const, path: `/api/${AI_ENTRY_SCENE_CATALOG_HTTP[surface]}/${AI_ENTRY_SCENE_CATALOG_HTTP.read}`,
    tag: 'AI Native', operationId: `readAiSceneCatalog_${surface}`, authRequired: true,
    permissions: surface === 'staffBasePath' ? ['rental-os:order:view'] : [],
    summary: 'Current server-bound scene metadata. Audience, scope and surface are never supplied by the caller. Directory observation does not authorize Task, model or Core execution.',
    requestSchema: AI_ENTRY_SCENE_CATALOG_CONTRACTS.read.request, responseSchema: AI_ENTRY_SCENE_CATALOG_CONTRACTS.read.response,
  })),
...Object.entries(AI_AUTOMATION_EXPLANATION_CONTRACTS).map(([action, contract]) => ({
    method: 'post' as const, path: `/api/${AI_AUTOMATION_EXPLANATION_HTTP.basePath}/${AI_AUTOMATION_EXPLANATION_HTTP[action as keyof typeof AI_AUTOMATION_EXPLANATION_CONTRACTS]}`,
    tag: 'AI Native', operationId: `automationExplanation_${action}`,
    permissions: ['rental-os:order:view', 'system:integration:manage', 'rental-os:finance:view'],
    summary: 'Current human original-resource access; explicit first model execution retains the independent automation policy and single ledger. Unknowns only read the original input.',
    requestSchema: contract.request, responseSchema: contract.response,
  })),
...(['availability', 'discover', 'inspect', 'prepare', 'read', 'execute', 'inspectReconfirmation',
    'prepareReconfirmation', 'readReconfirmation', 'startReview'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_MEMBER_NAME_HTTP.basePath}/${AI_MEMBER_NAME_HTTP[action]}`, tag: 'AI Native', operationId: `memberName_${action}`,
    permissions: ['prepare', 'execute', 'prepareReconfirmation', 'startReview'].includes(action)
      ? ['rental-os:member:manage'] : ['rental-os:member:view', 'rental-os:member:manage'],
    authRequired: true, summary: 'Explicit original member-name human workflow; current original manager and Core remain authoritative. Unknown is read only.',
    requestSchema: AI_MEMBER_NAME_CONTRACTS[action], responseSchema: 'AiMemberNameResponse' })),
...(['list', 'review', 'save', 'operation', 'preparation', 'previewPreparation', 'prepare', 'preparationOperation'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_TASK_RULE_DRAFT_HTTP.basePath}/${AI_TASK_RULE_DRAFT_HTTP[action]}`, tag: 'AI Native', operationId: `aiTaskRuleDraft_${action}`,
    permissions: action === 'save' || action === 'review' || action === 'previewPreparation' || action === 'prepare'
      ? ['rental-os:rules:manage'] : [...AI_TASK_RULE_DRAFT_READ_PERMISSIONS],
    authRequired: true,
    summary: action === 'save' ? 'Explicit human save of a reviewed original rule draft. No publication. Unknown: read the same original operation.'
      : action === 'operation' ? 'Read original rule draft operation from server-owned Task/Step/proposal linkage.'
      : action === 'preparation' ? 'Read current rule candidates for an owned diagnosis. No implicit version selection.'
      : action === 'previewPreparation' ? 'Review six permitted rule fields under the original rule edit permission. No persistence.'
      : action === 'prepare' ? 'Explicitly prepare a linked new rule AI proposal. Preserve the original diagnostic plan; no Core draft or publication.'
      : action === 'preparationOperation' ? 'Read the original linked rule preparation result without restarting it.'
      : 'Current owned rule proposal or full Core candidate review.',
    requestSchema: AI_TASK_RULE_DRAFT_CONTRACTS[action].request, responseSchema: AI_TASK_RULE_DRAFT_CONTRACTS[action].response })),
...Object.entries(AI_TASK_RULE_SOURCE_ENTRY_CONTRACTS).map(([action, contract]) => ({ method: 'post' as const,
    path: `/api/${AI_TASK_RULE_SOURCE_ENTRY_HTTP.basePath}/${AI_TASK_RULE_SOURCE_ENTRY_HTTP[action as keyof typeof AI_TASK_RULE_SOURCE_ENTRY_CONTRACTS]}`,
    tag: 'AI Native', authRequired: true, operationId: `aiTaskRuleDraft_${action}`, permissions: ['rental-os:rules:manage'],
    summary: action === 'source' ? 'Read one original rule version under current rule-management authority. No task creation.'
      : action === 'entry' ? 'Explicitly record the original rule task from the selected version. No model, rule save or publication.'
      : 'Read the original rule task creation receipt without retrying creation.',
    requestSchema: contract.request, responseSchema: contract.response })),
...(['list', 'review', 'save', 'operation'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_TASK_CALENDAR_DRAFT_HTTP.basePath}/${AI_TASK_CALENDAR_DRAFT_HTTP[action]}`, tag: 'AI Native', authRequired: true, operationId: `aiTaskCalendarDraft_${action}`,
    permissions: action === 'save' || action === 'review' ? ['rental-os:calendar:edit'] : [...AI_TASK_CALENDAR_DRAFT_READ_PERMISSIONS],
    summary: action === 'save' ? 'Explicit human save of a reviewed original calendar draft. No publication. Unknown: read the same original operation.'
      : action === 'operation' ? 'Read original calendar draft operation from server-owned Task/Step/proposal linkage.' : 'Current owned calendar proposal or full Core candidate review.',
    requestSchema: AI_TASK_CALENDAR_DRAFT_CONTRACTS[action].request, responseSchema: AI_TASK_CALENDAR_DRAFT_CONTRACTS[action].response })),
...Object.entries(AI_TASK_CALENDAR_DRAFT_PREPARATION_CONTRACTS).map(([action, contract]) => ({ method: 'post' as const,
    path: `/api/${AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP.basePath}/${AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP[action as keyof typeof AI_TASK_CALENDAR_DRAFT_PREPARATION_CONTRACTS]}`,
    tag: 'AI Native', authRequired: true, operationId: `aiTaskCalendarDraft_${action}`, permissions: ['rental-os:calendar:edit'],
    summary: action === 'source' ? 'Read existing draft calendar dates under current calendar edit authority. No task creation.'
      : action === 'entry' ? 'Explicitly create the original calendar task from a selected existing draft date. No model, calendar save or publication.'
      : action === 'entryOperation' ? 'Read the original calendar task creation receipt without retrying creation.'
      : action === 'prepare' ? 'Prepare a linked calendar AI proposal from reviewed name and business status changes. No Core draft save or publication.'
      : action === 'preparationOperation' ? 'Read the original linked calendar proposal operation without restarting it.'
      : 'Review an existing calendar draft date and its permitted changes. No persistence or publication.',
    requestSchema: contract.request, responseSchema: contract.response })),
{ method: 'post', path: `/api/${AI_TASK_ORDER_HANDOFF_HTTP.basePath}/${AI_TASK_ORDER_HANDOFF_HTTP.read}`, tag: 'AI Native', authRequired: true,
    operationId: 'aiTaskOrderHandoff_read', permissions: ['rental-os:order:view'],
    summary: 'Locate the owned original order Task and reread current order facts and manual reference. No model, business execution or approval.',
    requestSchema: 'AiTaskOrderHandoffQuery', responseSchema: 'AiTaskOrderHandoffResponse' },
...(['inspect', 'enable', 'operation'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_TASK_READ_POLICY_HTTP.basePath}/${AI_TASK_READ_POLICY_HTTP[action]}`, tag: 'AI Native', authRequired: true,
    operationId: `aiTaskReadPolicy_${action}`, permissions: ['system:params:manage'],
    summary: 'Explicit same-owner original manager read-policy CAS and original receipts. Never model/Core execution authorization.',
    requestSchema: action === 'inspect' ? 'AiTaskReadPolicyQuery' : action === 'enable' ? 'AiTaskReadPolicyEnable' : 'AiTaskReadPolicyReference', responseSchema: 'AiTaskReadPolicyResponse' })),
...(['inspect', 'enable', 'operation'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_TASK_ORIGINAL_READ_POLICY_HTTP.basePath}/${AI_TASK_ORIGINAL_READ_POLICY_HTTP[action]}`, tag: 'AI Native', authRequired: true,
    operationId: `aiTaskOriginalReadPolicy_${action}`, permissions: [...AI_TASK_ORIGINAL_READ_POLICY_ENTRY_PERMISSIONS],
    summary: action === 'enable' ? 'Explicit renewal of three owned-task read policies under current original business and resource authorization. No model or Core execution.'
      : action === 'operation' ? 'Read original renewal receipts, including after expiry or new-execution shutdown. No writes or retries.'
      : 'Inspect owned-task read access through current original resource Guards, independently of new-model publication.',
    requestSchema: action === 'inspect' ? 'AiTaskReadPolicyQuery' : action === 'enable' ? 'AiTaskReadPolicyEnable' : 'AiTaskReadPolicyReference', responseSchema: 'AiTaskReadPolicyResponse' })),
...AI_CREDIT_OPERATIONS,
...DESKTOP_BUSINESS_OPERATIONS,
{ method: 'post', path: '/api/ai-native/privacy/cleanup', tag: 'AI Native', operationId: 'cleanupAiRetention',
    permissions: ['system:params:manage'], authRequired: true,
    summary: 'Explicit bounded retention cleanup. Requires current full-workspace operator scope; unknown effects and original business receipts are held. No timer or automatic retry.',
    requestSchema: AI_RETENTION_HTTP_CONTRACTS.cleanup.request, responseSchema: AI_RETENTION_HTTP_CONTRACTS.cleanup.response },
{ method: 'post', path: '/api/ai-native/privacy/receipt', tag: 'AI Native', operationId: 'readAiRetentionReceipt',
    permissions: ['system:params:manage'], authRequired: true, summary: 'Observe only an owned original cleanup receipt; does not resend an unknown object deletion.',
    requestSchema: AI_RETENTION_HTTP_CONTRACTS.receipt.request, responseSchema: AI_RETENTION_HTTP_CONTRACTS.receipt.response },
{ method: 'post', path: '/api/ai-native/privacy/receipts', tag: 'AI Native', operationId: 'listAiRetentionReceipts',
    permissions: ['system:params:manage'], authRequired: true, summary: 'Bounded current-workspace receipt observation after an ambiguous batch reply.',
    requestSchema: AI_RETENTION_HTTP_CONTRACTS.receipts.request, responseSchema: AI_RETENTION_HTTP_CONTRACTS.receipts.response },
...Object.entries(AI_PLATFORM_RETENTION_HTTP_CONTRACTS).map(([action, contract]) => ({
    method: 'post' as const,
    path: `/api/${AI_PLATFORM_RETENTION_HTTP.basePath}/${AI_PLATFORM_RETENTION_HTTP[action as keyof typeof AI_PLATFORM_RETENTION_HTTP_CONTRACTS]}`,
    tag: 'AI Native', operationId: `platformAiRetention_${action}`, authRequired: true,
    permissions: [contract.write ? 'system:ai-provider:manage' : 'system:ai-provider:view'],
    summary: 'Bounded platform-only AI body maintenance and original receipts. Current SaaS authority, null business attribution, original accounting holds and deletion journals remain mandatory. No model, Core execution or unsigned restore.',
    requestSchema: contract.request, responseSchema: contract.response,
  })),
...AI_CLIENT_PUBLIC_HTTP.basePaths.flatMap(base => Object.entries(AI_CLIENT_PUBLIC_CONTRACTS).map(([action, contract]) => ({
    method: 'post' as const, path: `/api/${base}/${AI_CLIENT_PUBLIC_HTTP[action as keyof typeof AI_CLIENT_PUBLIC_CONTRACTS]}`,
    tag: 'AI Native', operationId: `clientPublic_${base.includes('wechat') ? 'wechat' : 'web'}_${action}`, permissions: [],
    authRequired: action === 'continueOriginal' || action === 'readContinuation', rateLimited: true,
    summary: 'Public catalog/help only under the current channel publication. Short signed ownership never grants customer data or execution. Explicit login continuation creates one current customer material; receipt recovery uses the original binding. No task, model, quote or payment is initiated.',
    requestSchema: contract.request, responseSchema: contract.response,
    ...(['prepare', 'readOriginal', 'continueOriginal'].includes(action) ? { parameters: [{
      name: AI_CLIENT_PUBLIC_HTTP.credentialHeader, in: 'header' as const, required: action !== 'continueOriginal',
      description: 'Server-signed public-material ownership only. Required for first preparation/continuation; existing continuation receipts use the original customer session without renewing public ownership.',
      schema: { type: 'string', minLength: 1, maxLength: 2048, pattern: '^ain-public-1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$' },
    }] } : {}),
  }))),
...([AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath, AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath]
    .flatMap((base, surface) => ([
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readHostCapabilities, 'AiClientHostCapabilitiesRequest', 'AiClientHostCapabilities'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderTaskHostCapabilities, 'AiClientOrderActionSource', 'AiClientHostCapabilities'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderAction, 'AiClientOrderActionSource', 'AiClientOrderActionDraft'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.revalidateOrderAction, 'AiClientOrderActionRevalidation', 'AiClientOrderActionDraft'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOrderMaterial, 'AiClientOrderMaterialRequest', 'AiClientOrderMaterialReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderMaterialReceipt, 'AiClientOrderMaterialRequest', 'AiClientOrderMaterialReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.createTask, 'AiClientTaskReadRequest', 'AiClientTaskCreationReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCreation, 'AiClientTaskReadRequest', 'AiClientTaskCreationReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.prepareQuoteParameters, 'AiClientQuotePreparationRequest', 'AiClientQuotePreparationResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.prepareGoal, 'AiClientGoalPreparationRequest', 'AiClientGoalPreparationResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalPreparation, 'AiClientGoalPreparationReadRequest', 'AiClientGoalPreparationResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalCandidates, 'AiClientGoalCandidatesRequest', 'AiClientGoalProjection'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.prepareGoalQuote, 'AiClientGoalQuoteRequest', 'AiClientQuotePreparationResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readGoalQuotePreparation, 'AiClientGoalQuoteRecoveryRequest', 'AiClientGoalQuoteReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readQuotePreparationOperation, 'AiClientQuoteReadRequest', 'AiClientQuotePreparationReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.confirmQuoteParameters, 'AiClientQuoteConfirmationRequest', 'AiClientQuoteResultReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readPreparedQuoteOriginal, 'AiClientQuoteConfirmationRequest', 'AiClientQuoteResultReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOriginalQuoteBooking, 'AiClientQuoteBookingRequest', 'AiClientQuoteBookingPreparationResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readOriginalQuoteBookingOperation, 'AiClientBookingReadRequest', 'AiClientQuoteBookingOperationResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.requestTaskCancellation, 'AiClientTaskCancelRequest', 'AiClientTaskCancelReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskInputCancellation, 'AiClientTaskCancelRequest', 'AiClientTaskInputCancellationReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskSnapshot, 'AiClientTaskReadRequest', 'AiTaskSnapshotDraft'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskEvents, 'AiClientTaskEventsReadRequest', 'AiTaskEventsObservationDraft'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderExplanation, 'AiClientOrderExplanationReadRequest', 'AiClientOrderExplanationReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readSource, 'AiClientSourceReadRequest', 'AiClientSourceReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskModelResult, 'AiClientTaskReadRequest', 'AiClientTaskModelResultReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInput, 'AiClientTaskReadRequest', 'AiClientTaskInputReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.submitTaskInput, 'AiClientTaskInputSubmissionRequest', 'AiClientTaskInputSubmissionReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInputReceipt, 'AiClientTaskInputRecoveryRequest', 'AiClientTaskInputReceiptReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.continueTaskInput, 'AiClientTaskInputRecoveryRequest', 'AiClientTaskModelControlResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.startTaskModel, 'AiClientTaskReadRequest', 'AiClientTaskModelControlResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.recoverTaskModel, 'AiClientTaskReadRequest', 'AiClientTaskModelControlResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskModel, 'AiClientTaskReadRequest', 'AiClientTaskModelControlResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationReceipt, 'AiClientTaskCancelRequest', 'AiClientTaskCancellationObservation'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationSettlementReceipt, 'AiClientTaskCancelRequest', 'AiClientTaskCancellationObservation'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.settleTaskUnstartedCancellation, 'AiClientTaskCancelRequest', 'AiClientTaskUnstartedCancellationReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskAccounting, 'AiClientTaskAccountingRequest', 'AiClientTaskAccountingResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskAccounting, 'AiClientTaskAccountingRequest', 'AiClientTaskAccountingResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.issueAction, 'AiEntryActionRequest', 'AiEntryActionDraft'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.createBookingDraft, 'AiBookingActionRequest', 'AiBookingCreateResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.chooseBookingDraft, 'AiBookingChoiceRequest', 'AiBookingChoiceResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingDraft, 'AiBookingDraftSelection', 'AiBookingDraft'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.handoffBookingDraft, 'AiBookingActionRequest', 'AiBookingHandoffResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingHandoff, 'AiBookingHandoffSelection', 'AiBookingHandoff'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingOperation, 'AiBookingOperationReadRequest', 'AiBookingOperationReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.issueBookingTransfer, 'AiClientBookingTransferIssueRequest', 'AiClientBookingTransferIssueResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingTransferIssue, 'AiClientBookingTransferIssueRequest', 'AiClientBookingTransferIssueResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.consumeBookingTransfer, 'AiClientBookingTransferRequest', 'AiClientBookingTransferReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingTransferReceipt, 'AiClientBookingTransferRequest', 'AiClientBookingTransferReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingAcceptance, 'AiBookingAcceptanceReadRequest', 'AiBookingAcceptanceReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.acceptBookingSubmission, 'AiBookingSubmissionAcceptanceRequest', 'AiBookingSubmissionAcceptance'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.submitAcceptedBooking, 'AiBookingSubmissionDecision', 'AiBookingSubmissionReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingSubmission, 'AiBookingSubmissionSelection', 'AiBookingSubmissionReceipt'],
    ] as const).map(([route, requestSchema, responseSchema]) => clientOperation('post', `/api/${base}/${route}`,
      `clientAi_${surface}_${route.replace(/\//gu, '_')}`,
      'Current independent customer identity and persisted surface/scene policy required. Observation does not grant execution; only an explicit original-page decision submits through Core. Unknown uses the same original receipt, never automatic resubmission.',
      { requestSchema, responseSchema })))),
...Object.entries(AI_CONVERSATION_HTTP_DRAFT.operations).map(([operation, contract]) => ({
    method: 'post' as const, path: `/api/${AI_CONVERSATION_HTTP_DRAFT.basePath}/${operation}`, tag: 'AI Native',
    operationId: `aiConversation_${operation}`, authRequired: true, permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    summary: operation === 'modelResult'
      ? 'Current owner-authorized conversation turn reads its existing source-revalidated model artifact through the original reader. Erased input exposes only its attested task locator, never recovered text. No model dispatch, task start, approval or business commit. Default-disabled conversation provider requires migration and explicit configuration.'
      : operation === 'task-result'
        ? '读取当前受权会话原 Task 的准确结果。原 admission Run 不变；回答或模型控制后继必须由原收据、计划与累计资源来源证明，再经原结果 reader 复核。读取不启动模型、恢复执行或创建业务操作。'
      : operation === 'model-control'
        ? '明确为同一当前受权材料登记一次重新解释或排版，沿原 Task、Gateway 与累计预算执行模型。原操作重放只读原收据，不重报价格、重放业务工具或授予业务批准。'
      : 'Current operator-owned conversation metadata and original request admission only. No model start, task cancellation, approval or business commit; unknown uses the original operation/admission. Default-disabled provider requires migration and explicit server configuration.',
    requestSchema: contract.request, responseSchema: contract.response })),
...Object.entries(AI_CATEGORY_PROPOSAL_CONTRACTS).map(([operation, contract]) => ({
    method: 'post' as const, path: `/api/${AI_CATEGORY_PROPOSAL_HTTP.basePath}/${AI_CATEGORY_PROPOSAL_HTTP[operation as keyof typeof AI_CATEGORY_PROPOSAL_CONTRACTS]}`,
    tag: 'AI Native', operationId: `aiCategoryProposal_${operation}`, permissions: [contract.permission],
    summary: 'Current SaaS category proposal over original platform Task/Gateway/ledger. Explicit generation only; candidates are not draft saves, publication or adoption. Unknown observes its original operation.',
    requestSchema: contract.request, responseSchema: contract.response })),
...Object.entries(AI_CATEGORY_DRAFT_HTTP_CONTRACTS).map(([operation, contract]) => ({
    method: 'post' as const, path: `/api/ai-native/category-drafts/${operation}`, tag: 'AI Native',
    operationId: `aiCategoryDraft_${operation}`, permissions: [operation === 'create' || operation === 'patch'
      ? 'system:rental-category:edit' : 'system:rental-category:view'],
    summary: 'Human draft preparation through original platform CAT-GOV permissions, preview gate and DTO/CAS. New work is server-disabled by default; publication and adoption are unavailable. Draft JSON may intentionally fail business validation; a valid wire response never certifies executable category configuration. Unknown writes require original-state review, not automatic retry.',
    requestSchema: contract.request, responseSchema: contract.response
  })),
{ method: 'post', path: '/api/staff/v1/ai-native/inspection-assist/history-read', tag: 'AI Native',
    operationId: 'readOwnedStaffInspectionHistory', permissions: ['rental-os:order:view'],
    summary: 'Read bounded owned historical inspection draft references under current staff/order/location authorization; no media access or execution.',
    requestSchema: 'AiStaffInspectionHistoryRequest', responseSchema: 'AiStaffInspectionHistoryResponse' },
...Object.entries(AI_CLIENT_POLICY_HTTP_CONTRACTS).map(([operation, contract]) => ({
    method: 'post' as const, path: `/api/${AI_CLIENT_TASK_POLICY_HTTP_DRAFT.basePath}/${AI_CLIENT_TASK_POLICY_HTTP_DRAFT[operation as keyof typeof AI_CLIENT_POLICY_HTTP_CONTRACTS]}`, tag: 'AI Native',
    operationId: `manageClientTaskPolicy_${operation}`, permissions: ['system:params:manage'],
    summary: 'Server-opt-in operator management of the existing quote-clarification customer policy and text plan. Current workspace/identity and original CAS/audit are mandatory; no customer scope/scene/tool overrides. Changes do not grant model capabilities, budget or booking approval. Unknown policy writes use their original operation key; plan uncertainty requires observing the current original plan (not an exact historical mutation receipt), never blind retry.',
    requestSchema: contract.request, responseSchema: contract.response
  })),
...Object.entries(AI_INSPECTION_TASK_HTTP_CONTRACTS).map(([operation, contract]) => ({
    method: 'post' as const, path: `/api/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.basePath}/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT[operation as keyof typeof AI_INSPECTION_TASK_HTTP_CONTRACTS]}`, tag: 'AI Native',
    operationId: `staffRecognition_${operation}`, permissions: ['rental-os:order:view'],
    summary: operation === 'readResultReference'
      ? 'Locate the original owned staff result through verified task, run and answer lineage under current order access. No candidate payload, lease, model dispatch or inspection submission.'
      : ['readCreation', 'readAnswer'].includes(operation)
      ? 'Original owned staff metadata or exact human-answer receipt under current resource/task read policies, independently of new recognition enablement. No media, lease, model or inspection submission is initiated by observation.'
      : 'Server opt-in candidate recognition through the original owner/order/stage/attachment, current policies, entitlement, capabilities and single Gateway ledger. Creation is not dispatch; answers are context, not adoption or inspection approval. Unknown uses the original evidence only.',
    requestSchema: contract.request, responseSchema: contract.response
  })),
...Object.entries(AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS).map(([operation, contract]) => ({
    method: 'post' as const,
    path: `/api/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.basePath}/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT[operation as keyof typeof AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS]}`,
    tag: 'AI Native', operationId: `staffRecognition_${operation}`, permissions: ['rental-os:order:view'],
    summary: 'Original owned staff cancellation or exact receipt under current resource and task policies, independently of new recognition enablement. Settlement requires the original never-started or released-and-measured task witness. Not provider cancellation, refund, new execution or business rollback; unknown is observed by the original revision only.',
    requestSchema: contract.request, responseSchema: contract.response
  })),
...(['readAccounting', 'reconcileAccounting'] as const).map(operation => ({
    method: 'post' as const, path: `/api/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.basePath}/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT[operation]}`, tag: 'AI Native',
    operationId: `staffRecognition_${operation}`, permissions: ['rental-os:order:view'],
    summary: 'Current same-staff task read policy and original invocation/usage only. Available independently of NEW recognition enablement, profile, input freshness or file storage. Does not dispatch, reserve, submit an inspection or prove business payment; unknown is observed by the original call key.',
    requestSchema: 'AiStaffTaskAccountingRequest', responseSchema: 'AiTaskAccountingObservation'
  })),
...Object.entries(AI_INSPECTION_TASK_POLICY_HTTP_CONTRACTS).map(([operation, contract]) => ({
    method: 'post' as const, path: `/api/${AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT.basePath}/${AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT[operation as keyof typeof AI_INSPECTION_TASK_POLICY_HTTP_CONTRACTS]}`, tag: 'AI Native',
    operationId: `staffRecognitionPolicy_${operation}`, permissions: ['rental-os:order:view'],
    summary: 'Human CAS policy management for the original owned inspection candidate task only. Stage authority and current server plan bound every operation. Not approval, Core submission or platform policy management. A current policy read is not an exact historical mutation receipt.',
    requestSchema: contract.request, responseSchema: contract.response
  })),
{ method: 'post', path: `/api/${STAFF_FULFILLMENT_RECEIPT_HTTP.basePath}/${STAFF_FULFILLMENT_RECEIPT_HTTP.operation}`, tag: 'AI Native',
    operationId: 'readOriginalStaffFulfillmentReceipt', permissions: ['rental-os:order:view'],
    summary: 'Read the original Core fulfillment receipt under current staff order and stage location access. Never uploads, submits, reacquires a lock or permits retry after an unknown observation.',
    requestSchema: STAFF_FULFILLMENT_RECEIPT_CONTRACT.request, responseSchema: STAFF_FULFILLMENT_RECEIPT_CONTRACT.response },
{ method: 'post', path: '/api/staff/v1/ai-native/inspection-assist/receipt-host-read', tag: 'AI Native',
    operationId: 'readOwnedStaffInspectionReceiptHost', permissions: ['rental-os:order:view'],
    summary: 'Open an explicitly selected original historical receipt host. Does not authorize recognition or original inspection submission.',
    requestSchema: 'AiStaffInspectionReceiptHostRequest', responseSchema: 'AiStaffInspectionReceiptHostProjection' },
{ method: 'post', path: '/api/staff/v1/ai-native/inspection-assist/result-save-receipt', tag: 'AI Native',
    operationId: 'readOwnedStaffInspectionRecognitionSaveReceipt', permissions: ['rental-os:order:view'],
    summary: 'Observe only the exact saved recognition association under current owner/order/location authority. Missing evidence is not permission to retry a write.',
    requestSchema: AI_INSPECTION_MANUAL_HTTP_CONTRACTS['result-save-receipt'].request,
    responseSchema: AI_INSPECTION_MANUAL_HTTP_CONTRACTS['result-save-receipt'].response },
...Object.entries(AI_INSPECTION_MANUAL_HTTP_CONTRACTS).filter(([operation]) => !['result-save-receipt', 'history-read', 'receipt-host-read'].includes(operation)).map(([operation, contract]) => ({
    method: 'post' as const, path: `/api/staff/v1/ai-native/inspection-assist/${operation}`, tag: 'AI Native',
    operationId: `staffInspection_${operation.replace(/-/gu, '_')}`, permissions: ['rental-os:order:view'],
    summary: 'Original staff/order/location and stage authorization. Typed bounded manual fields and historical draft state are not model evidence, adoption or inspection submission. Writes preserve the exact original operation receipt; damaged replies require original-key observation. Dynamic field names are validated by the original service and transport, not inferred from OpenAPI.',
    requestSchema: contract.request, responseSchema: contract.response
  })),
...Object.entries(AI_INSPECTION_LIFECYCLE_HTTP_CONTRACTS).map(([operation, contract]) => ({
    method: 'post' as const, path: `/api/staff/v1/ai-native/inspection-assist/${operation}`, tag: 'AI Native',
    operationId: `staffInspection_${operation.replace(/-/gu, '_')}`, permissions: ['rental-os:order:view'],
    summary: 'Original staff/order/location and stage action authorization is rechecked. Manual work and recognition require separate server opt-ins. Input preparation, saved candidate evidence, human adoption, Core submission and draft linkage are separate facts. An unknown write is observed by its original key, never automatically resent; read-only receipt observation does not repair linkage.',
    requestSchema: contract.request, responseSchema: contract.response
  })),
...Object.entries(AI_ORDER_EXPLANATION_HTTP_CONTRACTS_V2).map(([name, contract]) => ({
    method: 'post' as const, path: `/api/${AI_ORDER_EXPLANATION_HTTP_V2.basePath}/${AI_ORDER_EXPLANATION_HTTP_V2[name as keyof typeof AI_ORDER_EXPLANATION_HTTP_CONTRACTS_V2]}`,
    tag: 'AI Native', operationId: `originalOrderExplanationV2_${name}`, permissions: ['rental-os:order:view'],
    requestSchema: contract.request, responseSchema: contract.response, successStatus: contract.successStatus,
    summary: 'Opt-in read-only v2 original-order publication. Current owner, resource Guard and independent finance scope are rechecked. Original v1 requests/model hashes remain unchanged. Sources are current observations, not execution authority or reconstructed historical/provider results.'
  })),
...Object.entries(AI_SCENE_REQUEST_HTTP_CONTRACTS).map(([name, contract]) => ({
    method: 'post' as const, path: `/api/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}${AI_SCENE_REQUEST_HTTP_DRAFT[name as keyof typeof AI_SCENE_REQUEST_HTTP_CONTRACTS]
      ? `/${AI_SCENE_REQUEST_HTTP_DRAFT[name as keyof typeof AI_SCENE_REQUEST_HTTP_CONTRACTS]}` : ''}`,
    tag: 'AI Native', operationId: name === 'create' ? 'createOriginalOrderFactsRequest'
      : name === 'read' || name === 'recovery' || name === 'material' ? `readOriginalOrderFacts_${name}`
        : name === 'reconcile' ? 'reconcileOriginalOrderFactsRequest' : `originalSceneRequest_${name}`,
    permissions: ['rental-os:order:view'], requestSchema: contract.request, responseSchema: contract.response,
    successStatus: contract.successStatus,
    summary: 'Original current-owner scene request and Task metadata only, under existing resource Guard, scene policy and entitlement. Stored request, created metadata, original key observation and recovery are separate closed results; none invokes a model, approves an action or proves a Core effect. Reissue has its own original-key observation. Unknown never authorizes new-key creation. Existing POST success status is preserved.' })),
...([
    ['observeUpload', 'ObserveUploadRequestDraft', 'ObserveUploadResponseDraft'],
    ['observeRevisionUpload', 'ObserveRevisionUploadRequestDraft', 'ObserveUploadResponseDraft'],
    ['findOriginalUpload', 'FindOriginalUploadRequestDraft', 'FindOriginalUploadResponseDraft'],
    ['findOriginalRevisionUpload', 'FindOriginalRevisionUploadRequestDraft', 'FindOriginalUploadResponseDraft'],
    ['beginUpload', 'BeginUploadRequestDraft', 'BeginUploadResponseDraft'], ['completeUpload', 'CompleteUploadRequestDraft', 'CompleteUploadResponseDraft'],
    ['beginRevisionUpload', 'BeginRevisionUploadRequestDraft', 'BeginRevisionUploadResponseDraft'],
    ['completeRevisionUpload', 'CompleteRevisionUploadRequestDraft', 'CompleteRevisionUploadResponseDraft'],
    ['prepareCreate', 'PrepareRequestDraft', 'PrepareResponseDraft'], ['create', 'CreateRequestDraft', 'CommandResponseDraft'],
    ['parse', 'ParseRequestDraft', 'CommandResponseDraft'], ['reconcileParse', 'ReconcileParseRequestDraft', 'CommandResponseDraft'],
    ['revise', 'ReviseRequestDraft', 'CommandResponseDraft'], ['publish', 'PublishRequestDraft', 'CommandResponseDraft'],
    ['withdraw', 'WithdrawRequestDraft', 'CommandResponseDraft'], ['delete', 'DeleteRequestDraft', 'CommandResponseDraft'],
    ['operationStatus', 'OperationRequestDraft', 'OperationResponseDraft'],
    ['indexRead', 'IndexReadRequestDraft', 'IndexReadResponseDraft'], ['indexRequest', 'IndexRequestDraft', 'IndexMutationResponseDraft'],
    ['indexResume', 'IndexResumeRequestDraft', 'IndexMutationResponseDraft'], ['indexOperationRead', 'IndexOperationRequestDraft', 'IndexOperationResponseDraft']
  ] as const).map(([action, request, response]) => ({ method: 'post' as const,
    path: `/api/${AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT.basePath}/${AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT[action]}`, tag: 'AI Native',
    operationId: `manageCurrentAiKnowledge_${action}`, permissions: ['system:params:manage'],
    summary: 'Current operator and exact persisted document/upload action policy, ACL, version and original file integration required. No ambient file grants or model call. Human confirmation is action-specific; upload, document commit and publication are separate facts. Unknown writes require original operation observation.',
    requestSchema: `AiKnowledgeManagement${request}`, responseSchema: `AiKnowledgeManagement${response}` })),
...([
    ['readDocument', 'AiKnowledgeDocumentReadRequestDraft', 'AiKnowledgeDocumentReadResponseDraft'],
    ['openSource', 'AiKnowledgeSourceReadRequestDraft', 'AiKnowledgeSourceReadResponseDraft'],
    ['readMemory', 'AiKnowledgeMemoryReadRequestDraft', 'AiKnowledgeMemoryReadResponseDraft'],
    ['readPreferences', 'AiKnowledgePreferencesReadRequestDraft', 'AiKnowledgePreferencesReadResponseDraft']
  ] as const).map(([action, requestSchema, responseSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT.basePath}/${AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT[action]}`, tag: 'AI Native',
      operationId: `readCurrentAiKnowledge_${action}`, permissions: ['system:params:manage'],
      summary: 'Existing operator management entry permission plus exact persisted knowledge/memory action policy and original document/version/file ACL are required; management permission alone grants no resource access. Confirmed owner preferences only. Bounded read-only request, no model, task, write, download URL or business authority.',
    requestSchema, responseSchema })),
...([
    ['list', 'ListRequestDraft', 'ListResponseDraft'], ['state', 'StateRequestDraft', 'StateDraft'],
    ['read', 'ReadRequestDraft', 'MutationDraft'], ['propose', 'ProposeRequestDraft', 'MutationDraft'],
    ['confirm', 'ConfirmRequestDraft', 'MutationDraft'], ['resumeConfirmation', 'ConfirmRequestDraft', 'MutationDraft'],
    ['confirmation', 'ConfirmationRequestDraft', 'ConfirmationResponseDraft'], ['change', 'ChangeRequestDraft', 'MutationDraft'],
    ['changeStatus', 'ChangeStatusRequestDraft', 'ChangeStatusResponseDraft'], ['revoke', 'RevokeRequestDraft', 'RevokeResponseDraft'],
    ['operation', 'OperationRequestDraft', 'OperationResponseDraft']
  ] as const).map(([action, request, response]) => ({ method: 'post' as const,
    path: `/api/${AI_MEMORY_MANAGEMENT_HTTP_DRAFT.basePath}/${AI_MEMORY_MANAGEMENT_HTTP_DRAFT[action]}`, tag: 'AI Native',
    operationId: `manageOwnedAiMemory_${action}`, permissions: ['system:params:manage'],
    summary: 'Current human owner and persisted action policy required. Explicit consent is not business approval. Bounded request; uncertain writes must use the original memory operation, never automatic retry.',
    requestSchema: `AiMemoryManagement${request}`, responseSchema: `AiMemoryManagement${response}` })),
...([
    ...Object.entries(AI_KNOWLEDGE_TARGET_HTTP_CONTRACTS).map(([action, contract]) => [action as keyof typeof AI_KNOWLEDGE_TARGET_HTTP_CONTRACTS, contract.request, contract.response] as const),
    ['prepare', 'AiKnowledgePolicyChangeDraft', 'AiKnowledgePolicyPrepareHttpResponseDraft'],
    ['preparation', 'AiKnowledgePolicyPreparationSelectionDraft', 'AiKnowledgePolicyReviewHttpResponseDraft'],
    ['commit', 'AiKnowledgePolicyCommitDraft', 'AiKnowledgePolicyCommitHttpResponseDraft'],
    ['operation', 'AiKnowledgePolicyReceiptSelectionDraft', 'AiKnowledgePolicyOperationHttpResponseDraft']
  ] as const).map(([action, requestSchema, responseSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_KNOWLEDGE_POLICY_HTTP_DRAFT.basePath}/${AI_KNOWLEDGE_POLICY_HTTP_DRAFT[action]}`, tag: 'AI Native',
    operationId: `manageCurrentAiKnowledgePolicy_${action}`, permissions: ['system:params:manage'],
    summary: 'Current tenant manager plus persisted exact management authority, participants and resource basis required. No default root/policy, file access, model execution or business approval is created. Unknown writes require original operation observation.',
    requestSchema, responseSchema })),
...PLATFORM_AI_MODEL_SETTINGS_OPERATIONS,
...Object.entries(AI_TASK_CENTER_RECOVERY_CONTRACTS).map(([action, contract]) => ({
    method: 'post' as const, path: `/api/${AI_TASK_CENTER_RECOVERY_HTTP.basePath}/${AI_TASK_CENTER_RECOVERY_HTTP[action as keyof typeof AI_TASK_CENTER_RECOVERY_CONTRACTS]}`,
    tag: 'AI Native', operationId: `aiTaskCenterRecovery_${action}`, permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    requestSchema: contract.request, responseSchema: contract.response,
    summary: contract.write ? '沿原持久宿主恢复或接管已审阅的 Task/Run/计划/CAS；不创建新计划或额度，unknown 只读原操作。'
      : '当前本人、空间与原来源复验后的准确恢复定位或原收据；不领取租约、不启动模型。' })),
...(['input', 'resumeInput', 'inputReceipt', 'continueInput'] as const).map(action => ({
    method: 'post' as const, path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `aiTaskCenterOriginalClarification_${action}`, permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    requestSchema: action === 'input' ? 'AiTaskClarificationQueryDraft' : action === 'inputReceipt'
      ? 'AiTaskClarificationReceiptRequestDraft' : action === 'continueInput' ? 'AiTaskClarificationContinueQueryDraft' : 'AiTaskClarificationAnswerDraft',
    responseSchema: action === 'input' ? 'AiTaskClarificationObservationDraft' : 'AiTaskClarificationProgressDraft',
    summary: action === 'input' || action === 'inputReceipt'
      ? 'Read same-owner original question or exact answer receipt under current task/source authority. No start, model call, approval or automatic retry.'
      : 'Explicit original answer/continuation through the existing configured host. Continuation accepts the exact original reference, resolving verified stored answers internally; it does not submit answers again. Binds immutable question revision/submission key and cumulative resources; answers do not approve Core writes. Unknown: read exact input receipt, never resubmit or redispatch automatically.' })),
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.list}`,
    tag: 'AI Native', operationId: 'aiTaskCenterList', summary: 'Read current owner task metadata; no task/run creation',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: 'AiTaskMetadataQueryDraft', responseSchema: 'AiTaskMetadataPageDraft' },
...(['review', 'decision', 'decisionReceipt'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT[action]}`, tag: 'AI Native',
    operationId: `aiTaskCenterHuman_${action}`, permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    summary: action === 'review' ? 'Read deterministic original waiting-step order/settings proposal under current domain authority.'
      : action === 'decision' ? 'Explicit human decision on the exact reviewed proposal; server gate and current task/domain authority required. No runner continuation or Core execution. Unknown: read original decision receipt, never auto retry.'
        : 'Read original same-actor decision after expiry or new-execution closure. Missing is not rollback or permission to resubmit.',
    requestSchema: action === 'review' ? 'AiTaskReviewQueryDraft' : 'AiTaskDecisionQueryDraft',
    responseSchema: action === 'review' ? 'AiTaskHumanReviewDraft' : 'AiTaskHumanDecisionReceiptDraft' })),
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.business}`, tag: 'AI Native',
    operationId: 'aiTaskCenterOriginalBusinessReceipt', permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    requestSchema: 'AiTaskReviewQueryDraft', responseSchema: 'AiTaskBusinessObservationDraft',
    summary: 'Current owner exact original selection/Core order or settings operation receipt. No latest-object fallback, runner continuation, reconciliation write or inference of payment/fulfillment. Missing retains uncertainty.' },
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.continue}`, tag: 'AI Native',
    operationId: 'aiTaskCenterContinueOriginalApprovedTask', permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    requestSchema: 'AiTaskHumanContinueDraft', responseSchema: 'AiTaskHumanContinuationDraft',
    summary: 'Explicit human continuation of exact current checkpoint/review/revision with recorded same-actor approval. Delegates to the existing configured order/settings host: current claim/fencing/resource/Core authority remains mandatory. Unknown is observed by original business receipt, never auto retried.' },
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.result}`,
    tag: 'AI Native', operationId: 'aiTaskCenterOriginalModelResult',
    summary: 'Read original order/opening/quote model text via current business/source authorization. No raw artifact fallback or model invocation.',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: objectOf({ taskId: { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
      resultId: { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } }, ['taskId', 'resultId'], false),
    responseSchema: 'AiTaskModelObservationDraft' },
...(['stop', 'stopReceipt'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `aiTaskCenterOriginal_${action}`, permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    summary: action === 'stop' ? 'Explicit cancellation intent through the current owned task transition policy/CAS, including model and settings tasks. Independent of new execution, model provenance or financial admission. Not rollback, remote cancellation or refund. Unknown: read exact original receipt; never resubmit.'
      : 'Read cancellation request at exact original task revision and current owner/metadata/event authority, independent of new execution. Absence grants no retry.',
    requestSchema: 'AiTaskStopQueryDraft', responseSchema: 'AiTaskStopObservationDraft' })),
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.source}`,
    tag: 'AI Native', operationId: 'aiTaskCenterOriginalModelSource', permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    summary: 'Reopen one server-issued frozen source through current original scene authority and knowledge ACL. Hash/index are lookups, not authorization. Bounded inert text/JSON only; never a URL, download, model invocation or execution.',
    requestSchema: 'AiTaskModelSourceQueryDraft', responseSchema: 'AiTaskModelSourceObservationDraft' },
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.confirmation}`,
    tag: 'AI Native', operationId: 'aiTaskCenterOriginalConfirmationHistory',
    summary: 'Observe exact persisted confirmation phases and human decisions, independent of new execution. No approval, continuation, claim or business-success attestation.',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: objectOf({ taskId: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
      runId: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
      stepId: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } }, ['taskId', 'runId', 'stepId'], false),
    responseSchema: 'AiTaskConfirmationHistoryDraft' },
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.usageSummary}`,
    tag: 'AI Native', operationId: 'aiTaskCenterOriginalUsageSummary', summary: 'Read the current owner original task ledger summary with bounded coverage, separate units/currencies and unknown amounts. No provider bill, new dispatch, release or settlement.',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: objectOf({ taskId: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } }, ['taskId'], false),
    responseSchema: 'AiTaskBudgetUsageSummaryDraft' },
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.visibleReport}`,
    tag: 'AI Native', operationId: 'aiTaskCenterClientVisibleReport', summary: 'Record original owner/browser timing diagnostics after current source checks. Client reports are not business facts or authorization, execution, accounting, release or SLO evidence.',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: 'AiTaskClientVisibleReportDraft', responseSchema: 'AiTaskClientVisibleReceiptDraft' },
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.performance}`,
    tag: 'AI Native', operationId: 'aiTaskCenterOriginalPerformance', summary: 'Read original task/run clocks, bounded recorded model/tool observations and budget refusals. Missing first visible text/card remains unrecorded; no SLO verdict, dispatch or settlement.',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: 'AiTaskPerformanceReadDraft', responseSchema: 'AiTaskPerformanceObservationDraft' },
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.outcomes}`,
    tag: 'AI Native', operationId: 'aiTaskCenterOutcomeSample', summary: 'Read an explicit authorized scene/version task sample and original human takeover receipts. Pending tasks do not become failures; no SLO verdict, model call, lease or business execution.',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: 'AiTaskOutcomeSampleReadDraft', responseSchema: 'AiTaskOutcomeSampleDraft' },
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.usage}`,
    tag: 'AI Native', operationId: 'aiTaskCenterOriginalUsage', summary: 'Current owner original ledger page, not provider invoice or proof of business success. No new-execution gate, dispatch or settlement.',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: objectOf({ taskId: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
      limit: { type: 'integer', minimum: 1, maximum: 20 }, after: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } }, ['taskId', 'limit'], false),
    responseSchema: 'AiTaskBudgetUsagePageDraft' },
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.snapshot}`,
    tag: 'AI Native', operationId: 'aiTaskCenterSnapshot', summary: 'Read authorized task snapshot and persisted event watermark',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: objectOf({ taskId: { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } }, ['taskId'], false), responseSchema: 'AiTaskSnapshotDraft' },
{ method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.events}`,
    tag: 'AI Native', operationId: 'aiTaskCenterEvents', summary: 'Read persisted events after original cursor; reset is read-only',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: objectOf({ taskId: { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
      after: { type: 'string', maxLength: 20, pattern: '^(0|[1-9][0-9]*)$' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['taskId', 'after', 'limit'], false),
    responseSchema: { oneOf: [ref('AiTaskEventPageDraft'), ref('AiTaskEventResetDraft')] } },
{ method: 'post', path: `/api/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT.read}`,
    tag: 'AI Native', operationId: 'readCurrentTenantModelSettings', permissions: ['system:params:manage'],
    summary: 'Current tenant only. New tenant returns platform product default at revision zero with execution disabled. Masked configuration is not capability, budget or connection verification.',
    requestSchema: objectOf({}, [], false), responseSchema: 'AiTenantModelSettingsSummaryDraft' },
...(['discoverModels', 'detectProtocols'] as const).map(action => ({
    method: 'post' as const, path: `/api/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: action === 'discoverModels' ? 'discoverTenantProviderModels' : 'identifyTenantProviderProtocolFamily',
    permissions: ['system:params:manage'],
    summary: 'Explicit metadata GET only, no prompts or model inference. Exact current destination/revision for retained encrypted credentials; fresh temporary credentials are write-only. Public HTTPS/DNS pinning, no redirects, bounded response. Candidates never attest Chat/Responses/Messages capability; verify saved configuration through original probe task.',
    // JSON-Schema branch inference adds optional undefined keys to the TS union;
    // the shared, closed wire schemas themselves contain no such values.
    requestSchema: AI_PROVIDER_DISCOVERY_INPUT_SCHEMA as SchemaObject, responseSchema: AI_PROVIDER_DISCOVERY_RESULT_SCHEMA
  })),
{ method: 'post', path: `/api/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT.save}`,
    tag: 'AI Native', operationId: 'saveCurrentTenantModelSettings', permissions: ['system:params:manage'],
    summary: 'One expectedRevision CAS saves mode/service gate and retained or explicitly changed BYOK credential with its Profile. configId is the current tenant configuration, not a provider Profile. Uncertain acknowledgement must be observed, never retried with a new revision; current read is not an original operation receipt. Does not grant budget or execution.',
    requestSchema: 'AiTenantModelSettingsInputDraft', responseSchema: 'AiTenantModelSettingsSummaryDraft' },
{ method: 'post', path: `/api/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT.operation}`,
    tag: 'AI Native', operationId: 'readOriginalTenantModelConfigurationSave', permissions: ['system:params:manage'],
    summary: 'Current tenant/workspace/original actor only. Observe the operationKey saved with the original config/Profile CAS, not current head or capability proof. Unknown is never automatic retry permission.',
    requestSchema: 'AiModelConfigurationOperationReadDraft', responseSchema: 'AiModelConfigurationOperationDraft' },
{ method: 'post', path: `/api/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT.legacy}`,
    tag: 'AI Native', operationId: 'reviewPreservedLegacyTenantModelSettings', permissions: ['system:params:manage'],
    summary: 'Current authorized tenant review only. Returns a keyed original source/version reference, never old keys, masks, prompts or logs. Explicit save with legacySource requires revision zero, a replacement credential, operationKey and disabled BYOK; original settings remain unchanged and current capability/budget is not granted.',
    requestSchema: objectOf({}, [], false), responseSchema: 'AiLegacyModelConfigurationDraft' },
...(['operator', 'staff'] as const).flatMap(audience => [
    ['candidates/observation', 'outboxObservation'],
    ['candidates/read', 'readCandidate'], ['candidates/prepare', 'prepareCandidate'], ['candidates/prepare-pending', 'preparePending'],
    [AI_AUTOMATION_PENDING_BATCH_HTTP_DRAFT.readPendingBatch, 'readPendingBatch'],
    ['candidates/pending/continue', 'continuePendingBatch'],
    ['inputs/prepare', 'prepareInput'], ['inputs/read', 'readInput'], ['tasks/create', 'createTask'], ['tasks/read-creation', 'readCreation'],
    [AI_AUTOMATION_EVENT_TASK_HTTP_DRAFT.operation, 'createEventTask'],
    ['reviews/read', 'read'], ['reviews/queue', 'readQueue'], ['reviews/for-event', 'forEvent'], ['reviews/close', 'close'], ['reviews/feedback', 'feedback'], ['reviews/operation', 'operation'],
    ...Object.entries(AI_AUTOMATION_REVIEW_GRANT_HTTP_DRAFT.operations).map(([action, suffix]) => [suffix, action])
  ].map(([suffix, action]) => ({ method: 'post' as const, path: `/api/ai-native/automation/${audience}/${suffix}`, tag: 'AI Native',
    operationId: `humanAutomation_${audience}_${action}`,
    permissions: audience === 'staff' ? ['rental-os:order:view']
      : ['rental-os:order:view', 'system:integration:manage', 'rental-os:finance:view', 'rental-os:finance:reconcile'],
    summary: action === 'createEventTask'
      ? 'Explicit original event to candidate, immutable input and idempotent Task metadata, under current human resource rights and the server-selected automation policy/subject/budget. Unknown input stops before task creation; recover by reviews/for-event and the original input/creation readers. No run, worker, model, approval, notification, refund or business action is started. Named closed request/response; defaults remain disabled.'
      : action === 'readPendingBatch'
      ? '按原 operationKey 与 limit 只读已记录候选批次；重新核对当前人员、audience、租户、空间及每条原事件资源读权。策略撤销或当前故障解除不替代原记录；返回 observed、not_observed 或 unknown，不重选事件、准备候选、启动任务或授予执行权限。'
      : 'Original human audience/tenant/workspace/location and event source are revalidated. Candidates, immutable inputs, task metadata, bounded reviews and human close/feedback use named closed contracts; a review closure is never business resolution. New shadow/manual task production additionally needs server-selected original policy, independent automation identity, budget and current persisted grants. Unknown is read by its original key; no worker, model or automatic business action.',
    requestSchema: action === 'createEventTask' ? 'AiAutomationEventTaskRequestDraft'
      : AI_AUTOMATION_REVIEW_HTTP_CONTRACTS[action as keyof typeof AI_AUTOMATION_REVIEW_HTTP_CONTRACTS]?.request ?? 'GenericObject',
    responseSchema: action === 'createEventTask' ? 'AiAutomationEventTaskResponseDraft'
      : AI_AUTOMATION_REVIEW_HTTP_CONTRACTS[action as keyof typeof AI_AUTOMATION_REVIEW_HTTP_CONTRACTS]?.response ?? 'GenericObject' }))),
...(['discover', 'read', 'preview', 'prepare', 'prepareConfirmed', 'preparation', 'review', 'operation', 'commit', 'commitConfirmed'] as const).map(action => ({
    method: 'post' as const, path: `/api/ai-native/automation/operator/policies/${action === 'prepareConfirmed' ? 'prepare-confirmed'
      : action === 'commitConfirmed' ? 'commit-confirmed' : action}`, tag: 'AI Native',
    operationId: `humanAutomationPolicy_${action}`, permissions: ['system:params:manage'],
    summary: 'Current operator settings permission plus original scoped management grant. Prepare/commit use persisted CAS and original receipts. Only disabled/shadow/manual_confirmation; no default grants, real automatic execution, model or business write. Unknown must use the original preparation/operation. Named closed contracts distinguish current configuration, preview, prepared/stale/expired metadata and the original commit receipt.',
    requestSchema: AI_AUTOMATION_POLICY_HTTP_CONTRACTS[action].request,
    responseSchema: AI_AUTOMATION_POLICY_HTTP_CONTRACTS[action].response })),
...Object.entries(AI_SCENE_MODEL_HTTP_DRAFT).filter(([name]) => /Settings/u.test(name)).map(([name, action]) => ({
    method: 'post' as const, path: `/api/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${action}`, tag: 'AI Native',
    operationId: `originalNotificationSettings_${name}`, permissions: ['rental-os:price:manage'],
    summary: 'Original notification-settings lifecycle only, not arbitrary configuration. Current original business Guard, owner, persisted scene/task policies and real human approval remain mandatory. New preparation/execution additionally needs the server-only settings host gate; original receipt/metadata observations do not. Same runner and Core transaction, no model, worker, self-approval or second budget. Creation, human decision, cancellation and task-policy mutation propagate HTTP abandonment into request credential closure; it never proves rollback. Unknown requires original change/task/decision/operation observation. Named metadata, execution, checkpoint, decision, recovery and cancellation responses are closed; remaining generic outcomes are not frozen. Runner success is not an original Core receipt.',
    requestSchema: SETTINGS_TASK_CONTRACTS[name]?.[0] ?? 'GenericObject',
    responseSchema: SETTINGS_TASK_CONTRACTS[name]?.[1] ?? 'GenericObject' })),
...Object.entries(AI_CLARIFIED_QUOTE_SELECTION_HTTP_CONTRACTS).map(([name, contract]) => ({
    method: 'post' as const,
    path: `/api/${AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT.basePath}/${AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT[name as keyof typeof AI_CLARIFIED_QUOTE_SELECTION_HTTP_CONTRACTS]}`,
    tag: 'AI Native', operationId: `originalClarifiedQuoteSelection_${name}`, authRequired: true,
    permissions: name === 'select' ? ['rental-os:order:create'] : ['rental-os:order:view', 'rental-os:order:create'],
    summary: name === 'prepareSelection' ? 'Read the exact original clarified Core quote, full human selection material and current Core stock. Original answer payload or exact receipt key only; no answer resubmission, quote rebuild, selection save, runner, approval or order. Current Guard and original ownership remain required.'
      : name === 'readOriginalOperation' ? 'Read the exact original scoped selection by its original key and original human answer reference. The server verifies its own frozen order payload and full quote/selection fingerprint; clients retain no customer/order body. Missing records never grant replay. No new selection, model, approval, lease, settlement or Core write.'
      : 'Explicit human selection of the exact original clarified Core quote and answer successor before any frozen plan/input. Uses the existing configured model receipt and selection hosts; does not quote again, start a runner, approve or create an order. Named closed response; malformed post-selection delivery remains unknown. Lost replies read the same original selection key/payload only.',
    requestSchema: contract.request, responseSchema: contract.response })),
...Object.entries(AI_QUOTE_SELECTION_HTTP_CONTRACTS).map(([name, contract]) => ({
    method: 'post' as const,
    path: `/api/${AI_QUOTE_SELECTION_HTTP_DRAFT.basePath}${AI_QUOTE_SELECTION_HTTP_DRAFT[name as keyof typeof AI_QUOTE_SELECTION_HTTP_CONTRACTS]
      ? `/${AI_QUOTE_SELECTION_HTTP_DRAFT[name as keyof typeof AI_QUOTE_SELECTION_HTTP_CONTRACTS]}` : ''}`,
    tag: 'AI Native', operationId: `originalSelectedQuote_${name}_quote-selections`, authRequired: true,
    permissions: name === 'select' ? ['rental-os:order:create'] : ['rental-os:order:view', 'rental-os:order:create'],
    summary: 'Current original owner and exact Core quote under the original Guard and persistent selection transaction. Select is not approval, plan publication, stock reservation or order creation. Named closed responses distinguish a saved selection from an unobserved original key; absence never authorizes retry. Malformed post-selection delivery is unknown and must be read by the original selection command.',
    requestSchema: contract.request, responseSchema: contract.response })),
...[AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT].flatMap(contract =>
    Object.entries(contract).filter(([name]) => name !== 'basePath').map(([name, action]) => ({
      method: 'post' as const, path: `/api/${contract.basePath}${action ? `/${action}` : ''}`, tag: 'AI Native',
      operationId: `originalSelectedQuote_${name}_${contract.basePath.split('/').at(-1)}`,
      permissions: ['select', 'start', 'continueConfirmation', 'decideSelectedProposal', 'reprepareSelectedProposal',
        'readReissuePreparation', 'reissueSelectedRequest', 'readReissueOperation', 'readReissuedSelectionPreparation',
        'selectReissuedQuote', 'readReissuedSelectionOperation'].includes(name)
        ? ['rental-os:order:create'] : ['rental-os:order:view', 'rental-os:order:create'],
      summary: 'Same current owner/original input and exact persisted Core quote selection. Selection is not approval; only the existing runner consumes a real human approval through the original Core transaction. New actions require the server quote-order host/limits and current persisted policies. Disabled execution still permits original selection/approval/order receipt reads; unknown is never a new quote/order. No model, stock/payment success claim or second runtime. Response is draft-polymorphic.',
      requestSchema: (contract === AI_SELECTED_QUOTE_TASK_HTTP_DRAFT
        ? AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS[name as keyof typeof AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS]
        : AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS[name as keyof typeof AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS])?.request ?? 'GenericObject',
      responseSchema: (contract === AI_SELECTED_QUOTE_TASK_HTTP_DRAFT
        ? AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS[name as keyof typeof AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS]
        : AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS[name as keyof typeof AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS])?.response ?? 'GenericObject' }))),
{ method: 'post', path: `/api/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT.queryOrders}`,
    tag: 'AI Native', operationId: 'readAiOrderCandidates', authRequired: true, permissions: ['rental-os:order:view'],
    summary: 'Bounded current Core order page under current Guard/ALS, workspace, data and location scope. Only minimal order facts; no model call, task creation, financial totals or stock reservation. Time filters mean rental-interval overlap, not today-created or pickup/return due.',
    requestSchema: 'AiOrderCandidatesQueryDraft', responseSchema: 'AiOrderCandidatesPageDraft' },
{ method: 'post', path: `/api/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT.previewOrderExtension}`,
    tag: 'AI Native', operationId: 'previewOriginalOrderExtension',
    summary: 'Current owner-bound original next-steps request and exact order version. Reuses human Core extension permission and pricing; no persistence, inventory reservation, approval, extension or payment. Response remains a draft projection, not an execution receipt.',
    permissions: ['rental-os:order:extend', 'rental-os:order:operate'],
    requestSchema: 'AiSceneOrderExtensionPreviewDraft', responseSchema: 'AiSceneOrderExtensionPreviewResponseDraft' },
...(['quoteReview', 'quoteConfirm', 'quoteReceipt', 'compareOriginalQuotes'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `consumeOriginalQuote_${action}`,
    permissions: action === 'quoteConfirm' ? ['rental-os:order:create'] : ['rental-os:order:view', 'rental-os:order:create'],
    summary: action === 'quoteConfirm' ? 'Explicit human confirmation of the immutable original quote inputs. Original Core pricing/persistence only; no stock reservation, order approval, order creation or model call. Unknown is observed by its original quote receipt, never recreated.'
      : 'Current original-owner quote preparation or exact Core receipt. Historical receipt and current admissibility are separate; no quotation, inventory reservation, approval or new execution.',
    requestSchema: AI_ORIGINAL_SCENE_QUOTE_HTTP_CONTRACTS[action].request,
    responseSchema: AI_ORIGINAL_SCENE_QUOTE_HTTP_CONTRACTS[action].response })),
...Object.entries(AI_ORDER_READ_HTTP_CONTRACTS).map(([action, contract]) => ({ method: 'post' as const,
    path: `/api/${AI_SCENE_ORDER_READ_HTTP_DRAFT.basePath}/${AI_SCENE_ORDER_READ_HTTP_DRAFT[action as keyof typeof AI_ORDER_READ_HTTP_CONTRACTS]}`,
    tag: 'AI Native', operationId: `originalOrderReadChain_${action}`, authRequired: true,
    permissions: ['rental-os:order:view'], requestSchema: contract.request, responseSchema: contract.response,
    summary: 'Default closed without explicit trusted server execution configuration. Uses only the original owner-bound model/order/answer chain; current action/plan permissions, verified route and single financial ledger still apply. Recovery observes original effects, never redispatches unknown work. Historical read-only observation remains independently available.' })),
...([
    ['read', 'AiBudgetSettingsReadDraft', 'AiBudgetSettingsSummaryDraft'],
    ['readOperation', 'AiBudgetSettingsOperationReadDraft', 'AiBudgetSettingsOperationReceiptDraft'],
    ['change', 'AiBudgetSettingsChangeDraft', 'AiBudgetSettingsChangeResponseDraft'],
    ['initialize', 'AiBudgetSettingsInitializeDraft', 'AiBudgetSettingsChangeResponseDraft'],
    ['refreshConfiguration', 'AiBudgetSettingsRefreshConfigurationDraft', 'AiBudgetSettingsChangeResponseDraft'],
    ['platformRead', 'AiPlatformBudgetSettingsReadDraft', 'AiPlatformBudgetSettingsSummaryDraft'],
    ['platformSave', 'AiPlatformBudgetSettingsSaveDraft', 'AiPlatformBudgetSettingsSummaryDraft'],
    ['platformReadOperation', 'AiPlatformBudgetSettingsOperationReadDraft', 'AiPlatformBudgetSettingsOperationReceiptDraft'],
    ['readPriceConfiguration', 'AiGatewayPriceConfigurationReadDraft', 'AiGatewayPriceConfigurationDraft'],
    ['reviewPrice', 'AiGatewayPriceReviewDraft', 'AiGatewayPriceReviewResponseDraft'],
    ['readPriceReview', 'AiGatewayPriceReviewReadDraft', 'AiGatewayPriceReviewResponseDraft'],
    ['platformReviewPrice', 'AiGatewayPriceReviewDraft', 'AiGatewayPriceReviewResponseDraft'],
    ['platformPriceReviewReceipt', 'AiGatewayPriceReviewReadDraft', 'AiGatewayPriceReviewResponseDraft'],
    ['adoptPlatformPrice', 'AiGatewayPlatformPriceAdoptionDraft', 'AiGatewayPriceReviewResponseDraft'],
    ['previewPlatformPrice', 'AiGatewayPlatformPriceAdoptionReadDraft', 'AiGatewayPlatformPricePreviewDraft'],
    ['readPlatformPriceAdoption', 'AiGatewayPlatformPriceAdoptionReadDraft', 'AiGatewayPriceReviewResponseDraft']
  ] as const).map(([action, requestSchema, responseSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_BUDGET_MANAGEMENT_HTTP_DRAFT.basePath}/${AI_BUDGET_MANAGEMENT_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `manageAiBudgetSettings_${action}`, authRequired: true,
    permissions: [['platformPriceReviewReceipt', 'platformRead', 'platformReadOperation'].includes(action) ? 'system:ai-provider:view'
      : action.startsWith('platform') ? 'system:ai-provider:manage' : 'system:params:manage'],
    requestSchema, responseSchema,
    summary: action === 'platformRead' || action === 'platformSave' || action === 'platformReadOperation'
      ? 'Current SaaS authority manages the original platform/scene policy with CAS and server-selected configuration. Keyed saves append an immutable, actor/scope/scene/hash-bound configuration receipt in the same policy transaction; original observation requires only current platform view, not a live Profile or new execution permission. Lost replies never authorize another save or imply rollback. No tenant audit attribution, budget admission, supplier call or second ledger.'
      : action === 'readPriceConfiguration'
      ? 'Current tenant settings-read authority resolves the unique tenant-owned default BYOK Profile and revision under current selection. Bounded read with identity and configuration revalidation; no caller-selected owner, model/credential disclosure, price publication, input-count proof or execution grant. Tenant settings object ID is not the Profile ID. Original review receipts remain independent of current configuration.'
      : action === 'previewPlatformPrice'
      ? 'Current tenant settings-read authority reviews one immutable platform rate under current server-selected platform configuration and validity. No reviewer identity, provider, model, credential, adoption, input-count certification or execution grant. Preview is read-only; adoption remains an explicit separate write; original adoption receipts remain independently readable.'
      : action === 'platformReviewPrice' || action === 'platformPriceReviewReceipt' || action === 'adoptPlatformPrice' || action === 'readPlatformPriceAdoption'
      ? 'SaaS authority reviews immutable platform budget rates under the server-selected Profile, optionally including explicit cache read/write per-million rates. Tenants adopt only that exact version, without rate overrides. Reservations use the maximum reviewed input rate; settlement uses persisted disjoint token counters with one six-decimal rounding. Missing cache rates retain unknown accounting. Original review/adoption receipts remain readable under current authority after profile changes; unknown does not authorize another publication. No supplier invoice, input counting or dispatch grant. The default-disabled management gate is independent of model execution.'
      : action === 'reviewPrice'
      ? 'Retired tenant BYOK rate-write operation: always denied. BYOK records actual token usage without platform money pricing. Platform provider rates are managed by SaaS administrators only.'
      : action === 'readPriceReview'
      ? 'Observe an original immutable legacy BYOK rate review receipt only. It is not a supplier invoice, input-token certificate, new dispatch permission or new platform charge.'
      : 'Standard server-composed settings host, default unavailable without trusted management configuration; legacy explicit execution configuration remains compatible. Explicit management disable wins. Current tenant/workspace or distinct platform management Guard, version CAS and original single-ledger policies remain mandatory. No policy seed, unlimited default, model call, reservation or dispatch. Rebinding uses the current server-selected profile and disables its policy gate. Tenant writes with operationKey atomically record original actor/workspace/scene, command hash and saved revision in OperationLog; operation reads observe only that original save under current authority, independently of a live Profile. Unknown never means rollback or permission to retry. Unkeyed historical writes cannot be reconstructed from current policy values.' })),
...([
    ['priceRead', 'AiGatewayPriceReadDraft', 'AiGatewayPriceSummaryDraft'],
    ['pricePublicationRead', 'AiGatewayPricePublicationReadDraft', 'AiGatewayPriceSummaryDraft'],
    ['inputBoundRead', 'AiGatewayInputBoundReadDraft', 'AiGatewayInputBoundSummaryDraft']
  ] as const).map(([action, requestSchema, responseSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_BUDGET_MANAGEMENT_HTTP_DRAFT.basePath}/${AI_BUDGET_MANAGEMENT_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `readHistoricalGatewayPricing_${action}`, authRequired: true,
    permissions: ['system:params:manage'], requestSchema, responseSchema,
    summary: 'Standard read-only host for persisted pricing evidence under current management authority; input-bound reads also bind the current owner and original invocation scene. Producer/profile availability, rate expiry and new execution gates are not history gates. Request-local credentials close on abort or bounded wait; no late disclosure. No publication, certification, reserve or dispatch.' })),
...([
    ['prepare', 'AiTextCapabilityPrepareRequestDraft', 'AiTextCapabilityPrepareResponseDraft'],
    ['publish', 'AiTextCapabilityPrepareRequestDraft', 'AiTextCapabilityPublishResponseDraft'],
    ['readOriginal', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityReadOriginalResponseDraft'],
    ['createTask', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityCreateTaskResponseDraft'],
    ['readTask', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityReadTaskResponseDraft'],
    ['configureTaskAction', 'AiTextCapabilityConfigureActionDraft', 'AiTextCapabilityConfigureActionResponseDraft'],
    ['readTaskAction', 'AiTextCapabilityActionRequestDraft', 'AiTextCapabilityReadActionResponseDraft'],
    ['readTaskActionReceipt', 'AiTextCapabilityConfigureActionDraft', 'AiTextCapabilityActionReceiptResponseDraft'],
    ['start', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityRunResponseDraft'],
    ['inspect', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityInspectResponseDraft'],
    ['cancel', 'AiTextCapabilityCancelRequestDraft', 'AiTextCapabilityCancelResponseDraft'],
    ['reconcile', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityRunResponseDraft'],
    ['readCapabilityReceipt', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityReceiptResponseDraft'],
    ['preflight', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityPreflightResponseDraft'],
    ['readHistory', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityHistoryResponseDraft'],
    ['readAccounting', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityAccountingResponseDraft'],
    ['releaseUnsent', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityAccountingResponseDraft'],
    ['reconcileAccounting', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityAccountingResponseDraft'],
    ['readAccountingOperation', 'AiTextCapabilityAccountingOperationRequestDraft', 'AiTextCapabilityAccountingOperationResponseDraft']
  ] as const).map(([action, requestSchema, responseSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_TEXT_CAPABILITY_HTTP_DRAFT.basePath}/${AI_TEXT_CAPABILITY_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `originalProbeAccounting_${action}`, authRequired: true,
    permissions: ['system:params:manage'], requestSchema, responseSchema,
    summary: action === 'readAccountingOperation'
      ? 'Read the exact existing original release/reconcile ledger event and its trusted payload under current same-owner read authority. Original request selects the call and event key; caller amounts, usage, dispatch evidence and event keys are forbidden. No mutation replay, model dispatch, secret read or budget release. Current terminal balance without this event returns not_observed, never proof of rollback or permission to resend. Trusted probe host remains required.'
      : action === 'readTaskActionReceipt'
      ? 'Read the immutable same-owner action-policy CAS save receipt under current management authority. Policy and receipt commit atomically; original task, operation, prior revision, actor and scope must match. Does not resolve a live model or require the saved policy to remain unexpired. Missing/legacy receipt is not proof of rollback; observing a receipt grants no current policy, lease, dispatch or retry. Trusted probe host configuration is still required.'
      : 'Standard capability workflow, unavailable without separate trusted server probe configuration. Human configuration of persisted scene and same-owner task policies is required; never seeded on task creation. Immutable original input, measured runner, unique Gateway dispatch and the original single ledger remain mandatory. Probe completion is not capability evidence: read its persisted receipt. Historical observations/accounting do not dispatch; unknown uses the same original key, never automatic retry or caller usage. Calls quotas do not prove supplier token/money pricing.' })),
...AI_COUNTING_HTTP_OPERATIONS.map(([action, requestSchema, responseSchema, permission]) => ({ method: 'post' as const,
    path: `/api/${AI_COUNTING_HTTP_DRAFT.basePath}/${AI_COUNTING_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `inputCounting_${action}`, authRequired: true,
    permissions: permission === 'management' ? ['system:params:manage'] : [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema, responseSchema,
    summary: 'Explicit opt-in operator counting host. Current Auth/Guard/ALS, original task owner/action policy and one budget ledger remain mandatory. Caller provides only original identifiers; protocol/model, tool policy, count evidence, price and transport are server-owned. Count/publish acknowledgement loss uses observeCountKey/readInputBound respectively, never a replacement call or automatic refund. Task cost views distinguish missing records, unknown, calls and generation usage; they are not supplier invoices. Omitted dependencies do not register or enable this module.' })),
...AI_PLATFORM_CAPABILITY_HTTP_OPERATIONS.map(([action, requestSchema, responseSchema, permission]) => ({ method: 'post' as const,
    path: `/api/${AI_PLATFORM_CAPABILITY_HTTP_DRAFT.basePath}/${AI_PLATFORM_CAPABILITY_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `platformCapability_${action}`, authRequired: true,
    permissions: [`system:ai-provider:${permission}`], requestSchema, responseSchema,
    summary: 'Opt-in SaaS platform capability host. Publication accepts a currently verified server-prepared probe command; all later operations name the original request key. The server resolves creation/input references, current owner/action policy and the original Gateway ledger. Receipt reconciliation may record capability evidence and requires manage permission; history and financial operation receipts never dispatch. Unknown results require original-key observation, never a new ID or automatic retry. Omitted host/audit/dependencies stay unavailable; this contract does not register AppModule or execute migrations.' })),
...(['start', 'recover', 'reconcile', 'takeover', 'requestCancel', 'readExecution'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT.basePath}/${AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `originalOpeningModel_${action}`, authRequired: true,
    permissions: ['rental-os:price:manage'],
    requestSchema: action === 'requestCancel' ? 'AiSceneOrderReadCancelDraft'
      : action === 'takeover' ? 'AiSceneOrderReadTakeoverDraft' : 'AiSceneRequestReadDraft',
    responseSchema: action === 'start' ? 'AiSceneModelStartResponseDraft'
      : action === 'readExecution' ? 'AiTaskRecoverySnapshot'
      : action === 'requestCancel' ? 'AiSceneModelCancelResponseDraft'
      : action === 'reconcile' ? 'AiSceneModelReconcileResponseDraft' : 'AiSceneModelExecutionDraft',
    summary: 'Independent opt-in opening diagnosis model host; omitted configuration performs no reads or execution. Reuses the original request, current same-owner scene/action policies, immutable input/plan, measured runner and single Gateway ledger. Current opening business authority is mandatory. Existing model/result/source observations remain on their read host. All six responses use shared closed contracts; malformed post-execution replies remain unknown. Cancellation intent and its later persisted settlement remain distinct, never remote rollback or budget release. No settings approval, publication, capability attestation or automatic retry of unknown work.' })),
...(['read', 'releaseUnsent', 'reconcile', 'readOperation'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT.basePath}/${AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `originalAiTaskAccounting_${action}`, authRequired: true,
    permissions: ['rental-os:order:view'],
    requestSchema: action === 'readOperation' ? 'AiOriginalTaskAccountingOperationRequestDraft' : 'AiOriginalTaskAccountingRequestDraft',
    responseSchema: action === 'readOperation' ? 'AiOriginalTaskAccountingOperationResponseDraft' : 'AiOriginalTaskAccountingResponseDraft',
    summary: action === 'readOperation'
      ? 'Read the exact original release/reconcile ledger event and trusted payload under current same-owner task/resource authority, independent of new execution. Caller supplies only the original request, call and fixed operation; never event keys, usage or amounts. Missing event is not proof of rollback; current settled/released balance alone does not attest this operation. No mutation, reservation, dispatch or business execution.'
      : 'Standard original order recovery host, independent of new-execution configuration. Current owner, original resource and task action required. Read an original AI budget balance, release only a proved never-dispatched reservation, or reconcile persisted same-call usage. No new reservation/model call or business-funds action; uncertain responses require the exact original operation receipt, never retry dispatch. Other scenes still require their own explicit trusted composition.' })),
...(['read', 'configure', 'clear'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT.basePath}/${AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `manageOriginalTaskReadPolicy_${action}`, permissions: ['system:params:manage'], authRequired: true,
    summary: 'Current manager and same-owner original-resource access required, with bounded expiry and revision CAS. Defaults to read policies only. Explicit trusted order execution configuration additionally exposes claim/recovery/release/transition/takeover policy management for the original closed order chain. No automatic policy seed, approval, arbitrary input, lease, financial grant or dispatch.',
    requestSchema: AI_ORIGINAL_POLICY_HTTP_CONTRACTS[action === 'read' ? 'taskRead' : action === 'configure' ? 'taskConfigure' : 'taskClear'].request,
    responseSchema: AI_ORIGINAL_POLICY_HTTP_CONTRACTS[action === 'read' ? 'taskRead' : action === 'configure' ? 'taskConfigure' : 'taskClear'].response })),
...(['read', 'change'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_SCENE_PLAN_POLICY_HTTP_DRAFT.basePath}/${AI_SCENE_PLAN_POLICY_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `manageOriginalOrderPlanPolicy_${action}`, authRequired: true,
    permissions: ['system:params:manage'],
    summary: 'Default unavailable without trusted server order execution configuration. Current configuration Guard selects the workspace; the server fixes order_explanation v1 and only ai.model.text/rental.order.explain. Change uses revision CAS and same-transaction audit. No automatic task permission, approval, lease, invocation or financial occupancy. Lost write acknowledgements require original policy read.',
    requestSchema: AI_ORIGINAL_POLICY_HTTP_CONTRACTS[action === 'read' ? 'planRead' : 'planChange'].request,
    responseSchema: AI_ORIGINAL_POLICY_HTTP_CONTRACTS[action === 'read' ? 'planRead' : 'planChange'].response })),
...([
    [AI_SCENE_MODEL_HTTP_DRAFT.start, 'AiSceneRequestReadDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.refreshInput, 'AiSceneModelInputRefreshDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.submitAnswer, 'AiSceneModelResumeDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.resume, 'AiSceneModelResumeDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.continueAnswer, 'AiSceneModelAnswerQueryDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.reconcile, 'AiSceneRequestReadDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.recover, 'AiSceneRequestReadDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.takeover, 'AiSceneModelTakeoverDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.requestCancel, 'AiSceneModelCancelDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readQuotePreparation, 'AiSceneModelAnswerQueryDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.confirmClarifiedQuote, 'AiSceneModelQuoteConfirmDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readClarifiedQuoteReceipt, 'AiSceneModelAnswerQueryDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readExecution, 'AiSceneRequestReadDraft']
  ] as const).map(([action, requestSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${action}`, tag: 'AI Native',
    operationId: `executeOriginalAiQuote_${action.replace(/\//gu, '_')}`, requestSchema,
    responseSchema: action === AI_SCENE_MODEL_HTTP_DRAFT.start ? 'AiSceneModelStartResponseDraft'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.submitAnswer ? 'AiSceneModelSubmitAnswerResponseDraft'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.resume ? 'AiSceneModelResumeResponseDraft'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.continueAnswer ? 'AiSceneModelContinueAnswerResponseDraft'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.readExecution ? 'AiTaskRecoverySnapshot'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.reconcile ? 'AiSceneModelReconcileResponseDraft'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.requestCancel ? 'AiSceneModelCancelResponseDraft'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.readQuotePreparation ? 'AiSceneModelQuotePreparationResponseDraft'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.confirmClarifiedQuote ? 'AiSceneModelQuoteConfirmResponseDraft'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.readClarifiedQuoteReceipt ? 'AiSceneModelQuoteReceiptResponseDraft'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.refreshInput ? 'AiSceneModelPendingInputDraft'
      : 'AiSceneModelExecutionDraft',
    permissions: ['rental-os:order:create'], authRequired: true,
    summary: 'Explicit original quote clarification host, separately enabled by server configuration. Uses the existing persistent input runner, current owner/action/plan policy, Gateway and single ledger; no caller prompt/provider/lease. Answers and model completion are not quote selection or order approval. Confirmation uses original Core quote operation; order execution remains the independent human-selection/approval host. All quote execution/input/review/confirmation/original-receipt actions have named closed responses. The review carries current guarded parameters and unconfirmed field provenance; a malformed post-confirmation reply remains unknown and is read by its original clarified-quote receipt. Recovery never redispatches unknown calls.' })),
...([
    [AI_SCENE_MODEL_HTTP_DRAFT.requestCancellationIntent, 'AiOriginalCancellationIntentResponse'],
    [AI_SCENE_MODEL_HTTP_DRAFT.settleUnstartedCancellation, 'AiOriginalUnstartedCancellationResponse'],
    [AI_SCENE_MODEL_HTTP_DRAFT.settleReleasedInputCancellation, 'AiOriginalInputWaitCancellationResponse']
  ] as const).map(([action, responseSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${action}`, tag: 'AI Native',
    operationId: `recoverOriginalAiTask_${action.replace(/\//gu, '_')}`, requestSchema: 'AiSceneModelCancelDraft', responseSchema,
    successStatus: 200 as const, authRequired: true, permissions: ['rental-os:order:view'],
    summary: '按原请求和预期修订写入取消意图或收口原未启动/已释放输入等待任务。当前原身份、场景、资源和 transition_task 策略仍须通过；不新建模型准入，不释放资金，不把取消视为业务回滚。失回复只读取同一原取消收据。' })),
...([
    [AI_SCENE_MODEL_HTTP_DRAFT.readTaskPage, AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.readTaskPage.request],
    [AI_SCENE_MODEL_HTTP_DRAFT.readTaskEvents, AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.readTaskEvents.request],
    [AI_SCENE_MODEL_HTTP_DRAFT.readTaskUsage, 'AiSceneTaskUsageReadDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readTaskPerformance, 'AiSceneTaskPerformanceReadDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene, AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.readTaskScene.request],
    [AI_SCENE_MODEL_HTTP_DRAFT.readInput, 'AiSceneRequestReadDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readRecoverySnapshot, objectOf({ original: { $ref: '#/components/schemas/AiSceneRequestReadDraft' }, runId: { type: 'string', minLength: 1, maxLength: 191 } }, ['original', 'runId'], false)],
    [AI_SCENE_MODEL_HTTP_DRAFT.readTakeoverReceipt, objectOf({ original: { $ref: '#/components/schemas/AiSceneRequestReadDraft' },
      runId: { type: 'string', minLength: 1, maxLength: 191 }, expectedTaskRevision: { type: 'integer', minimum: 1, maximum: 4294967294 },
      expectedRunRevision: { type: 'integer', minimum: 1, maximum: 4294967294 }, expectedFencingToken: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' } },
      ['original', 'runId', 'expectedTaskRevision', 'expectedRunRevision', 'expectedFencingToken'], false)],
    [AI_SCENE_MODEL_HTTP_DRAFT.readCancellationReceipt, 'AiSceneModelCancelDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readCancellationSettlementReceipt, 'AiSceneModelCancelDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readAnswer, 'AiSceneModelAnswerQueryDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readModelResult, AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.readModelResult.request],
    [AI_SCENE_MODEL_HTTP_DRAFT.readQuoteGoalCandidates, AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.readQuoteGoalCandidates.request],
    [AI_SCENE_MODEL_HTTP_DRAFT.reopenModelSource, AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.reopenModelSource.request],
    [AI_SCENE_MODEL_HTTP_DRAFT.reopenOpeningModelSource, AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.reopenOpeningModelSource.request],
  ] as const).map(([action, requestSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${action}`, tag: 'AI Native', operationId: `observeOriginalAiTask_${action.replace(/\//gu, '_')}`,
    responseSchema: action === AI_SCENE_MODEL_HTTP_DRAFT.readTaskPage ? AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.readTaskPage.response
      : action === AI_SCENE_MODEL_HTTP_DRAFT.readTaskEvents ? AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.readTaskEvents.response
      : action === AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene ? AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.readTaskScene.response
      : action === AI_SCENE_MODEL_HTTP_DRAFT.readModelResult ? AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.readModelResult.response
      : action === AI_SCENE_MODEL_HTTP_DRAFT.readQuoteGoalCandidates ? AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.readQuoteGoalCandidates.response
      : action === AI_SCENE_MODEL_HTTP_DRAFT.reopenModelSource ? AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.reopenModelSource.response
      : action === AI_SCENE_MODEL_HTTP_DRAFT.reopenOpeningModelSource ? AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS.reopenOpeningModelSource.response
      : action === AI_SCENE_MODEL_HTTP_DRAFT.readTaskPerformance ? 'AiTaskPerformanceObservationDraft'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.readRecoverySnapshot ? 'AiSceneModelRecoverySnapshotReadResponse'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.readInput ? 'AiSceneModelPendingInputDraft'
      : action === AI_SCENE_MODEL_HTTP_DRAFT.readAnswer ? 'AiTaskInputReceiptObservationDraft' : undefined,
    permissions: action === AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene
      ? ['rental-os:order:view', 'rental-os:order:create', 'rental-os:price:manage'] : ['rental-os:order:view'], authRequired: true, requestSchema,
    summary: 'Current owner, scope, original resource and action policy are rechecked. Financial observations include exact integer-atom amounts for the visible page only: reserved, pending, settled, released reservation and settled excess, separated by unit and currency. Missing records are not zero consumption, and page amounts are neither whole-task totals nor supplier invoices. Performance observations include original recorded budget-gate rejections in a bounded invocation window: absence is not admission success and rejection is not release evidence. Fixed scene aggregation can consume original selected-quote approval/Core receipts or notification-settings preparation and waiting/receipt readers even while new execution is closed. Read-only observation without a model, runner start, execution grant or budget reservation. Missing result policy/ACL remains unavailable.' }))
];

export const AI_HTTP_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
...AI_MEMBER_NAME_SCHEMAS,
...AI_TASK_RULE_DRAFT_SCHEMAS,
...AI_TASK_RULE_SOURCE_ENTRY_SCHEMAS,
...AI_TASK_CALENDAR_DRAFT_SCHEMAS,
...AI_TASK_CALENDAR_DRAFT_PREPARATION_SCHEMAS,
...AI_TASK_ORDER_HANDOFF_SCHEMAS,
...AI_TASK_READ_POLICY_SCHEMAS,
...AI_NATIVE_COMPONENT_SCHEMAS,
...AI_TASK_DRAFT_COMPONENT_SCHEMAS,
...AI_LEAF_COMPONENT_SCHEMAS,
...RECOVERY_RESPONSE_SCHEMAS,
...DESKTOP_BUSINESS_SCHEMAS,
...AI_CREDIT_COMPONENT_SCHEMAS
};

// 客户公开/原订单 AI 合同直接引用原 Rental 投影。只从正式贡献取得其传递依赖，
// 保留同一验证规则；不复制字段，也不把整份 Rental 文档作为另一套 AI 合同维护。
const checkedSchemas = new Set<string>();
function includeRentalReferences(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(includeRentalReferences); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key !== "$ref" || typeof child !== "string" || !child.startsWith("#/components/schemas/")) {
      includeRentalReferences(child); continue;
    }
    const name = child.slice("#/components/schemas/".length);
    if (checkedSchemas.has(name)) continue;
    checkedSchemas.add(name);
    const schema = AI_HTTP_COMPONENT_SCHEMAS[name] ?? RENTAL_HTTP_COMPONENT_SCHEMAS[name];
    if (!schema) throw new Error(`AI 合同缺少原 schema 依赖：${name}`);
    AI_HTTP_COMPONENT_SCHEMAS[name] = schema;
    includeRentalReferences(schema);
  }
}
Object.values(AI_HTTP_COMPONENT_SCHEMAS).forEach(includeRentalReferences);
