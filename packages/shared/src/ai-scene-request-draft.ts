import type { RentalFulfillmentMode, RENTAL_PRICING_UNIT_CODES } from './core';
import type { AiTaskStatusDraft, AiStepStateDraft } from './ai-task-draft';
import type { AiUsageQuantityDraft, AiUsageRecordDraft } from './ai-usage-draft';

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
  quoteConfirm: 'quote-confirm', quoteReceipt: 'quote-receipt'
} as const);
/** Server opt-in only. Bodies reuse original references and the existing input
 * submission contract; callers never supply leases, prompts or model settings. */
export const AI_SCENE_MODEL_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/model`, method: 'POST',
  start: 'start', readInput: 'input', refreshInput: 'input/refresh', resume: 'resume', reconcile: 'reconcile',
  readExecution: 'execution', recover: 'recover', takeover: 'takeover',
  readAnswer: 'input/receipt', continueAnswer: 'input/continue',
  readQuotePreparation: 'input/quote-preparation',
  confirmClarifiedQuote: 'input/quote-confirm', readClarifiedQuoteReceipt: 'input/quote-receipt',
  requestCancel: 'cancel', readModelResult: 'result', reopenModelSource: 'source',
  readTaskPage: 'tasks', readTaskEvents: 'events', readTaskUsage: 'usage', readTaskScene: 'scene',
  startSettingsTask: 'settings/start', readSettingsConfirmation: 'settings/confirmation',
  decideSettingsProposal: 'settings/decision', readSettingsDecision: 'settings/decision-receipt', continueSettingsConfirmation: 'settings/continue',
  reconcileSettingsTask: 'settings/reconcile', cancelSettingsTask: 'settings/cancel'
} as const);
