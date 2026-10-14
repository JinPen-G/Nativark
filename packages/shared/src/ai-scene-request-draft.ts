import type { RentalFulfillmentMode, RENTAL_PRICING_UNIT_CODES } from './core';
import type { AiTaskStatusDraft, AiStepStateDraft } from './ai-task-draft';
import type { AiUsageQuantityDraft, AiUsageRecordDraft } from './ai-usage-draft';
import type { AiWorkspaceScope } from './ai-native';
import type { AI_TASK_DRAFT_VERSION } from './ai-task-draft';

export const AI_SCENE_REQUEST_DRAFT_VERSION = 'ain-scene-request-draft-1' as const;
export const AI_SCENE_REQUEST_MAX_BYTES = 32768;
export const AI_SCENE_CODES = ['order_explanation', 'opening_diagnosis', 'quote_clarification'] as const;
export type AiSceneCode = typeof AI_SCENE_CODES[number];
export interface AiSceneQuoteCandidate {
  customerType: 'personal' | 'corporate';
  customerId?: string;
  customerName?: string;
  items?: Array<{ productName?: string; itemGroupId?: string; quantity: number; pricingUnit?: typeof RENTAL_PRICING_UNIT_CODES[number]; usageQuantity?: number }>;
  start?: string;
  end?: string;
  fulfillmentMode?: RentalFulfillmentMode;
  locationName?: string;
  returnLocationName?: string;
  locationId?: string;
  returnLocationId?: string;
  selectionRevision?: string;
}
export type AiSceneRequestBody =
  | { sceneCode: 'order_explanation'; input: { orderId: string; question: 'status' | 'fees' | 'payments' | 'next_steps' } }
  | { sceneCode: 'opening_diagnosis'; input: { sections: string[] } }
  | { sceneCode: 'quote_clarification'; input: { candidate: AiSceneQuoteCandidate } };
export type AiSceneRequestCreateDraft = AiSceneRequestBody & {
  draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION;
  requestKey: string;
};
export type AiSceneRequestReissueDraft = AiSceneRequestCreateDraft & { previousInputRef: string };
export interface AiSceneRequestReadDraft {
  draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION;
  inputRef: string;
}
/** Reopen only a readiness section selected by the original request. This is
 * a current authorized observation, not a URL or historical configuration. */
export interface AiSceneOpeningModelSourceReadDraft {
  original: AiSceneRequestReadDraft;
  resultId: string;
  key: string;
}
export interface AiSceneTaskUsageReadDraft {
  original: AiSceneRequestReadDraft; taskId?: string; limit: number; after?: string;
}
export interface AiTaskBudgetUsagePageDraft {
  taskId: string;
  items: Array<{ invocationId: string; callId: string } & (
    | { accounting: 'not_recorded' }
    | { accounting: 'recorded'; reservationId: string; sceneCode: string; runId: string; stepId: string;
        revision: number; observedVersionAt: string; status: Exclude<AiUsageRecordDraft['status'], 'estimated'>;
        reserved: AiUsageQuantityDraft; actual: AiUsageQuantityDraft | null; budgetDispatchMarked: boolean;
        modelPolicy: { mode: 'platform_managed'; serviceName: 'Rental OS AI' } | { mode: 'tenant_managed'; model: string } }
  )>;
  nextAfter: string | null; observedAt: string; coverage: 'page_not_total'; totals: 'not_computed';
  consistency: 'revalidated_reads_not_atomic_snapshot'; absenceSemantics: 'no_record_is_not_proof_of_no_consumption';
  businessExecution: 'not_inferred_from_usage'; admission: 'not_granted';
}
/** Explicit same-owner recovery takeover. Revisions describe an observed
 * original run; they are not permission or a caller-selected worker lease. */
export interface AiSceneModelTakeoverDraft {
  original: AiSceneRequestReadDraft;
  expectedTaskRevision: number;
  expectedRunRevision: number;
  expectedFencingToken: string;
}
/** Exact previously observed run, including a prior clarification generation.
 * This reference is observation only and cannot select a run for execution. */
export interface AiSceneModelTakeoverReceiptReadDraft extends AiSceneModelTakeoverDraft {
  runId: string;
}
/** expectedRevision is the exact revision before the observed transition.
 * Cancellation intent and its later settlement are separate observations. */
export interface AiSceneModelCancellationReceiptReadDraft {
  original: AiSceneRequestReadDraft;
  expectedRevision: number;
}
/** A previously observed owned run, not a lease or authority to execute. */
export interface AiSceneModelRecoverySnapshotReadDraft {
  original: AiSceneRequestReadDraft;
  runId: string;
}
/** Confirms only the displayed Core quote parameters, not order creation or
 * approval. Hashes bind the current authorized preparation, not authority. */
export interface AiSceneQuoteReceiptReadDraft extends AiSceneRequestReadDraft {
  /** Optional legacy display hints; historical lookup uses the server-owned
   * original reference, not today's candidates or these caller values. */
  selectionRevision?: string;
  inputFingerprint?: string;
}
export interface AiSceneQuoteConfirmDraft extends AiSceneQuoteReceiptReadDraft {
  selectionRevision: string;
  inputFingerprint: string;
  confirmQuote: true;
}
/** Two server-owned original operations, never caller quote bodies or prices.
 * Comparison preserves each receipt's unknown/expiry and grants no approval. */
export interface AiSceneOriginalQuotesCompareDraft {
  previous: AiSceneRequestReadDraft;
  current: AiSceneRequestReadDraft;
}
export interface AiSceneRequestReceiptDraft {
  draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION;
  inputRef: string;
  revision: number;
  contentHash: string;
  sceneCode: AiSceneCode;
  sceneVersion: string;
  requestKey: string;
  previousInputRef: string | null;
  expiresAt: string;
  createdAt: string;
  state: 'stored' | 'expired' | 'revoked';
}
/** Current authorized diagnostic projection. `ready` remains the Core
 * workspace aggregate, never a success recalculated from selected sections. */
export interface AiOpeningReadFactsDraft {
  requestId: string;
  scope: AiWorkspaceScope;
  observedAt: string;
  ready: boolean;
  readinessBasis: 'core_workspace_aggregate';
  coverage: 'requested_sections' | 'all_readiness_sections';
  items: Array<{ key: string; title: string; missing: string; optional: boolean;
    status: 'unavailable' | 'ready' | 'missing' }>;
}
/** No historical payload or execution/approval grant accompanies this source. */
export interface AiOriginalOpeningReadSourceDraft {
  original: AiSceneRequestReceiptDraft;
  source: {
    original: { contractVersion: typeof AI_TASK_DRAFT_VERSION; taskId: string; resultId: string;
      runId: string; stepId: string; actionId: string; status: 'succeeded'; errorCode: null;
      contentHash: string; outputBytes: string; activeMs: string; completeMeasurement: true; observedAt: string };
    facts: AiOpeningReadFactsDraft;
    observation: 'current_authorized_reobservation';
    originalPayload: 'not_returned';
    execution: 'not_invoked';
  };
}
export type AiSceneTaskReceiptDraft =
  | { state: 'not_observed'; retryable: false }
  | { state: 'observed'; taskId: string; runId: string; status: AiTaskStatusDraft; revision: number;
      plan: 'stored' | 'not_observed'; resultAvailable: boolean; execution: 'not_inferred_from_metadata' };
export interface AiSceneRecoveryStepDraft {
  stepId: string;
  runId: string;
  actionId: string;
  revision: number;
  status: AiStepStateDraft['outcome']['status'];
  effect: AiStepStateDraft['outcome']['effect'];
  resultAvailable: boolean;
  nextAction: 'reconcile_original_action' | 'read_authorized_result' | 'runner_owned';
}
export const AI_SCENE_REQUEST_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/scene-requests', method: 'POST',
  create: '', read: 'read', reissue: 'reissue', reconcile: 'reconcile', reconcileReissue: 'reconcile-reissue',
  createTask: 'create-task', material: 'material', recovery: 'recovery', quoteReview: 'quote-review',
  quoteConfirm: 'quote-confirm', quoteReceipt: 'quote-receipt', compareOriginalQuotes: 'quote-compare'
} as const);
/** Owner-only operator policy management; never execution or business approval. */
export const AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/task-actions`, method: 'POST',
  configure: 'configure', read: 'read', clear: 'clear'
} as const);
/** Current workspace manager, with a closed server-selected scene/tool registry. */
export const AI_SCENE_PLAN_POLICY_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/plan-policies`, method: 'POST', read: 'read', change: 'change'
} as const);
/** Server opt-in only. Bodies reuse original references and the existing input
 * submission contract; callers never supply leases, prompts or model settings. */
export const AI_SCENE_MODEL_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/model`, method: 'POST',
  start: 'start', readInput: 'input', refreshInput: 'input/refresh', resume: 'resume', reconcile: 'reconcile',
  readExecution: 'execution', readRecoverySnapshot: 'execution/snapshot', recover: 'recover', takeover: 'takeover', readTakeoverReceipt: 'takeover/receipt',
  readAnswer: 'input/receipt', continueAnswer: 'input/continue',
  readQuotePreparation: 'input/quote-preparation',
  confirmClarifiedQuote: 'input/quote-confirm', readClarifiedQuoteReceipt: 'input/quote-receipt',
  requestCancel: 'cancel', requestCancellationIntent: 'cancel/intent', readCancellationReceipt: 'cancel/receipt',
  settleUnstartedCancellation: 'cancel/settle-unstarted',
  settleReleasedInputCancellation: 'cancel/settle-input-wait',
  readCancellationSettlementReceipt: 'cancel/settlement-receipt', readModelResult: 'result', reopenModelSource: 'source',
  reopenOpeningModelSource: 'source/opening-section',
  readTaskPage: 'tasks', readTaskEvents: 'events', readTaskUsage: 'usage', readTaskScene: 'scene',
  startSettingsTask: 'settings/start', readSettingsConfirmation: 'settings/confirmation',
  createSettingsTask: 'settings/create-task', readSettingsTaskCreation: 'settings/create-task/receipt',
  readCurrentSettings: 'settings/current', prepareOriginalSettingsChange: 'settings/change/prepare',
  readOriginalSettingsChange: 'settings/change/receipt',
  readOriginalSettingsSnapshot: 'settings/original/snapshot', readOriginalSettingsEvents: 'settings/original/events',
  readOriginalSettingsConfirmation: 'settings/original/confirmation',
  readOriginalSettingsResult: 'settings/original/result',
  readSettingsTaskPolicy: 'settings/task-policy/read', configureSettingsTaskPolicy: 'settings/task-policy/configure',
  clearSettingsTaskPolicy: 'settings/task-policy/clear', startOriginalSettingsTask: 'settings/start-original',
  requestOriginalSettingsCancellation: 'settings/original/cancel', readOriginalSettingsCancellation: 'settings/original/cancel/receipt',
  settleUnstartedSettingsCancellation: 'settings/original/cancel/settle-unstarted',
  readOriginalSettingsCancellationSettlement: 'settings/original/cancel/settlement-receipt',
  decideSettingsProposal: 'settings/decision', readSettingsDecision: 'settings/decision-receipt', continueSettingsConfirmation: 'settings/continue',
  reconcileSettingsTask: 'settings/reconcile', cancelSettingsTask: 'settings/cancel'
} as const);

/** Explicit original opening READ host, not model execution or production
 * activation. Inputs reuse the original request, takeover, cancellation and
 * result-reference drafts above; clients cannot choose a Task or tool. */
export const AI_OPENING_READ_TASK_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/opening-read`, method: 'POST',
  start: 'start', recover: 'recover', reconcile: 'reconcile', inspect: 'execution',
  takeover: 'takeover', readTakeoverReceipt: 'takeover/receipt', reopenSource: 'source',
  requestCancellationIntent: 'cancel/intent', readCancellationReceipt: 'cancel/receipt',
  settleUnstartedCancellation: 'cancel/settle-unstarted', readCancellationSettlementReceipt: 'cancel/settlement-receipt'
} as const);

/** Distinct server-opt-in fixed order read chain. Every operation resolves
 * the original task/run/result on the server; never a client-selected resultId. */
export const AI_SCENE_ORDER_READ_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/order-read`, method: 'POST',
  start: 'start', recover: 'recover', readOrderResult: 'order-result',
  readPreparation: 'preparation', resumePrepared: 'preparation/resume', readAnswer: 'answer',
  readModelResult: 'model-result', readTaskScene: 'scene', readNextSteps: 'next-steps',
  readTaskSnapshot: 'snapshot', reopenModelSource: 'source', requestCancel: 'cancel', takeover: 'takeover',
  readTakeoverReceipt: 'takeover/receipt', readCancellationReceipt: 'cancel/receipt',
  settleUnstartedCancellation: 'cancel/settle-unstarted', readCancellationSettlementReceipt: 'cancel/settlement-receipt'
} as const);
