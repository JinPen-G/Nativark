import type { CreateRentalOrderRequest } from './core';
import type { AiSceneModelAnswerQueryDraft } from './ai-scene-request-draft';
import type { AiTaskRunnerOutcomeDraft } from './ai-task-recovery-draft';
import type { AiTaskConfirmationHistoryDraft } from './ai-task-confirmation-history-draft';
import type { AiTaskEventDraft } from './ai-task-draft';
import type { AiApprovalRecordDraft } from './ai-proposal-draft';
import type { AiApprovalApplicationReviewDraft, AiApprovalOrderMaterialDraft, AiApprovalReprepareReceiptDraft, AiApprovalApplicationReferenceDraft,
  AiApprovalApplicationDecisionDraft, AiApprovalReprepareEligibilityRequestDraft, AiApprovalReprepareCommandDraft } from './ai-approval-application-draft';

export const AI_QUOTE_SELECTION_DRAFT_VERSION = 'ain-quote-selection-draft-1' as const;
/** Opt-in only; registration does not grant identity, approval or execution. */
export const AI_QUOTE_SELECTION_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/quote-selections', select: '', read: 'read', reconcile: 'reconcile'
} as const);
/** Explicit handoff of the exact clarified quote to its unplanned successor.
 * Selection still does not start the order runner or grant human approval. */
export const AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_QUOTE_SELECTION_HTTP_DRAFT.basePath}/clarified`, prepareSelection: 'prepare', select: 'select', readOperation: 'operation', readOriginalOperation: 'original-operation'
} as const);
export interface AiClarifiedQuoteSelectionRequestDraft {
  selection: AiQuoteSelectionCreateDraft;
  clarification: AiSceneModelAnswerQueryDraft;
}
/** Original Core quote and current stock, read only. The exact receipt key may
 * reopen a saved human answer; neither form submits answers or grants approval. */
export interface AiClarifiedQuoteSelectionPreparationInputDraft {
  clarification: AiSceneModelAnswerQueryDraft; selectionKey: string; expectedSelectionRevision: number;
}
export interface AiClarifiedQuoteSelectionPreparationDraft {
  selection: AiQuoteSelectionCreateDraft; clarification: AiSceneModelAnswerQueryDraft; material: AiApprovalOrderMaterialDraft;
  quote: { id: string; originalOperation: 'read_only' }; selectionState: 'not_saved'; quotation: 'original_unchanged';
  approval: 'not_granted'; order: 'not_created'; nextAction: 'explicit_human_selection_then_original_approval';
}
/** Exact original key only. The server reconstructs its own frozen selection;
 * this locator supplies no customer/address/order payload or execution grant. */
export interface AiQuoteSelectionOperationLocatorDraft {
  draftVersion: typeof AI_QUOTE_SELECTION_DRAFT_VERSION; originalInputRef: string; taskId: string; runId: string;
  selectionKey: string; expectedSelectionRevision: number; quoteId: string;
}
export interface AiClarifiedQuoteSelectionOriginalOperationReadDraft {
  selection: AiQuoteSelectionOperationLocatorDraft; clarification: AiSceneModelAnswerQueryDraft;
}
/** Human review/decision transport only. Core execution remains runner-owned. */
export const AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_QUOTE_SELECTION_HTTP_DRAFT.basePath}/approval`,
  readSelectedProposal: 'review', decideSelectedProposal: 'decide', readSelectedDecisionReceipt: 'decision-receipt',
  readSelectedOrderResult: 'order-result', readSelectedReprepareEligibility: 'reprepare-eligibility',
  readSelectedRepreparePreparation: 'reprepare-preparation',
  reprepareSelectedProposal: 'reprepare', readSelectedReprepareReceipt: 'reprepare-receipt'
} as const);
export const AI_SELECTED_QUOTE_TASK_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_QUOTE_SELECTION_HTTP_DRAFT.basePath}/task`,
  start: 'start', readConfirmation: 'confirmation', continueConfirmation: 'continue', reconcile: 'reconcile', requestCancel: 'cancel',
  readResult: 'result', readScene: 'scene', readTaskPage: 'tasks', readTaskEvents: 'events'
} as const);
export interface AiQuoteSelectionProofDraft extends AiQuoteSelectionReadDraft {
  taskId: string;
  runId: string;
  inputHash: string;
}
export interface AiSelectedQuoteTaskRequestDraft { selection: AiQuoteSelectionProofDraft }
export interface AiSelectedQuoteTaskConfirmationRequestDraft extends AiSelectedQuoteTaskRequestDraft { stepId: string }
export interface AiSelectedQuoteTaskContinueRequestDraft extends AiSelectedQuoteTaskRequestDraft { checkpointRef: string }
export interface AiSelectedQuoteTaskCancelRequestDraft extends AiSelectedQuoteTaskRequestDraft { expectedRevision: number }
export interface AiHumanQuoteOrderReviewRequestDraft extends AiSelectedQuoteTaskRequestDraft { proposal: AiApprovalApplicationReferenceDraft }
export interface AiHumanQuoteOrderDecisionRequestDraft extends AiSelectedQuoteTaskRequestDraft { proposal: AiApprovalApplicationDecisionDraft }
export interface AiHumanQuoteOrderReprepareEligibilityRequestDraft extends AiSelectedQuoteTaskRequestDraft { request: AiApprovalReprepareEligibilityRequestDraft }
export interface AiHumanQuoteOrderReprepareRequestDraft extends AiSelectedQuoteTaskRequestDraft { command: AiApprovalReprepareCommandDraft }
/** Server locates the new normal-run selection/input/plan from the owned task.
 * The human never supplies Step/ActionInput/plan hashes or a lease. */
export interface AiHumanQuoteOrderRepreparePreparationInputDraft extends AiSelectedQuoteTaskRequestDraft {
  original: AiApprovalApplicationReferenceDraft; replacementTaskId: string;
  operationKey: string; intent: 'inspect' | 'change_plan';
}
export interface AiHumanQuoteOrderRepreparePreparationDraft {
  selection: AiQuoteSelectionProofDraft; replacement: AiQuoteSelectionProofDraft;
  command: AiApprovalReprepareCommandDraft; originalReview: AiApprovalApplicationReviewDraft;
  replacementReview: AiApprovalApplicationReviewDraft;
  state: 'read_only'; supersession: 'not_attempted'; approval: 'not_granted'; order: 'not_created';
}
/** Legacy original-result locator. Its phase coordinates must match the stored
 * approval consumption; they never grant a lease, submission or replay. New
 * callers should use the task result read with the selection reference only. */
export interface AiHumanQuoteOrderResultReadRequestDraft extends AiSelectedQuoteTaskRequestDraft {
  command: { taskId: string; proposalId: string; approvalId: string; actionId: string; proposalRevision: number;
    reviewedPayloadHash: string; lease: { runId: string; holderId: string; revision: number; fencingToken: string } };
}
export type AiQuoteSelectedOrderDraft = Pick<CreateRentalOrderRequest,
  'quoteId' | 'customerId' | 'customerName' | 'contactPhone' | 'fulfillmentMode' | 'fulfillmentLocationId' | 'returnLocationId' | 'startAt' | 'endAt' | 'lines'> & {
    customerType: 'personal'; customerId: string; bookingIdentity?: { bookingIdentity: 'personal' }
      | { bookingIdentity: 'enterprise_employee'; corporateCustomerId: string; enterpriseContractAndPayer: boolean };
  };
export interface AiQuoteSelectionCreateDraft {
  draftVersion: typeof AI_QUOTE_SELECTION_DRAFT_VERSION;
  originalInputRef: string;
  taskId: string;
  runId: string;
  selectionKey: string;
  expectedSelectionRevision: number;
  order: AiQuoteSelectedOrderDraft;
}
export interface AiQuoteSelectionReadDraft {
  draftVersion: typeof AI_QUOTE_SELECTION_DRAFT_VERSION;
  originalInputRef: string;
  selectionId: string;
}
/** Saved selection, not a task execution or approval receipt. Replaying only
 * observes the same original operation and never replaces its order payload. */
export interface AiQuoteSelectionSelectResponseDraft {
  receipt: AiQuoteSelectionReceiptDraft;
  replayed: boolean;
}
export type AiQuoteSelectionReconcileResponseDraft =
  | { state: 'not_observed'; retryable: false }
  | { state: 'observed'; receipt: AiQuoteSelectionReceiptDraft; retryable: false };

/** Named HTTP contracts for the original selection and clarified handoff.
 * No route or permission is enabled by publishing these schema names. */
export const AI_QUOTE_SELECTION_HTTP_CONTRACTS = Object.freeze({
  select: { request: 'AiQuoteSelectionCreateDraft', response: 'AiQuoteSelectionSelectResponseDraft' },
  read: { request: 'AiQuoteSelectionReadDraft', response: 'AiQuoteSelectionReceiptDraft' },
  reconcile: { request: 'AiQuoteSelectionCreateDraft', response: 'AiQuoteSelectionReconcileResponseDraft' }
} as const);
export const AI_CLARIFIED_QUOTE_SELECTION_HTTP_CONTRACTS = Object.freeze({
  readOriginalOperation: { request: 'AiClarifiedQuoteSelectionOriginalOperationReadDraft', response: 'AiQuoteSelectionReconcileResponseDraft' },
  prepareSelection: { request: 'AiClarifiedQuoteSelectionPreparationInputDraft', response: 'AiClarifiedQuoteSelectionPreparationDraft' },
  select: { request: 'AiClarifiedQuoteSelectionRequestDraft', response: 'AiQuoteSelectionSelectResponseDraft' },
  readOperation: { request: 'AiClarifiedQuoteSelectionRequestDraft', response: 'AiQuoteSelectionReconcileResponseDraft' }
} as const);
/** Human decisions and runner-owned execution have separate observations.
 * A successful task or saved approval never substitutes for a Core receipt. */
export const AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS = Object.freeze({
  readTaskPage: { request: 'AiTaskMetadataQueryDraft', response: 'AiTaskMetadataPageDraft' },
  readTaskEvents: { request: 'AiOriginalTaskEventsReadDraft', response: 'AiTaskEventsObservationDraft' },
  readScene: { request: 'AiSceneModelTaskSceneDraft', response: 'AiTaskSceneObservationDraft' },
  start: { request: 'AiSelectedQuoteTaskRequestDraft', response: 'AiSelectedQuoteTaskRunDraft' },
  readConfirmation: { request: 'AiSelectedQuoteTaskConfirmationRequestDraft', response: 'AiSelectedQuoteTaskConfirmationDraft' },
  continueConfirmation: { request: 'AiSelectedQuoteTaskContinueRequestDraft', response: 'AiSelectedQuoteTaskRunDraft' },
  reconcile: { request: 'AiSelectedQuoteTaskRequestDraft', response: 'AiSelectedQuoteTaskRecoveryDraft' },
  readResult: { request: 'AiSelectedQuoteTaskRequestDraft', response: 'AiSelectedQuoteTaskResultDraft' },
  requestCancel: { request: 'AiSelectedQuoteTaskCancelRequestDraft', response: 'AiSelectedQuoteTaskCancelResponseDraft' }
} as const);
export const AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS = Object.freeze({
  readSelectedOrderResult: { request: 'AiHumanQuoteOrderResultReadRequestDraft', response: 'AiSelectedQuoteTaskResultDraft' },
  readSelectedProposal: { request: 'AiHumanQuoteOrderReviewRequestDraft', response: 'AiApprovalApplicationReviewDraft' },
  decideSelectedProposal: { request: 'AiHumanQuoteOrderDecisionRequestDraft', response: 'AiHumanQuoteOrderDecisionResponseDraft' },
  readSelectedDecisionReceipt: { request: 'AiHumanQuoteOrderDecisionRequestDraft', response: 'AiApprovalApplicationReceiptDraft' },
  readSelectedReprepareEligibility: { request: 'AiHumanQuoteOrderReprepareEligibilityRequestDraft', response: 'AiApprovalReprepareEligibilityDraft' },
  readSelectedRepreparePreparation: { request: 'AiHumanQuoteOrderRepreparePreparationInputDraft', response: 'AiHumanQuoteOrderRepreparePreparationDraft' },
  reprepareSelectedProposal: { request: 'AiHumanQuoteOrderReprepareRequestDraft', response: 'AiHumanQuoteOrderReprepareResponseDraft' },
  readSelectedReprepareReceipt: { request: 'AiHumanQuoteOrderReprepareRequestDraft', response: 'AiHumanQuoteOrderReprepareResponseDraft' }
} as const);
export type AiSelectedQuoteTaskRunDraft =
  | { kind: 'not_started'; reason: 'host_aborted' | 'plan_unavailable' | 'task_not_runnable' | 'lease_held'
      | 'recovery_lease_unavailable' | 'confirmation_lease_unavailable' }
  | { kind: 'run_outcome'; outcome: AiTaskRunnerOutcomeDraft };
export interface AiSelectedQuoteTaskCheckpointDraft {
  taskId: string; runId: string; stepId: string; taskRevision: number; checkpointRef: string;
  proposal: { contractVersion: AiApprovalApplicationReviewDraft['proposal']['payload']['contractVersion'];
    proposalId: string; proposalRevision: number; reviewedPayloadHash: string }; execution: 'not_attested';
}
export type AiSelectedQuoteTaskConfirmationDraft = AiSelectedQuoteTaskCheckpointDraft
  | { state: 'not_waiting'; history: AiTaskConfirmationHistoryDraft; execution: 'not_attested'; continuation: 'not_invoked' };
export type AiSelectedQuoteTaskResultDraft =
  | { status: 'committed'; replayed: boolean; order: { id: string; status: string; quoteId: string };
      source: { resourceType: 'order'; resourceId: string }; payment: 'not_inferred'; fulfillment: 'not_inferred'; taskOutcome: 'owned_by_runner' }
  | { status: 'unknown'; errorCode: 'AI_RESULT_UNKNOWN'; retryable: false; nextAction: 'read_selected_order_result'; sideEffect: 'may_have_committed' }
  | { status: 'not_observed'; retryable: false; nextAction: 'read_selected_order_result'; sideEffect: 'not_attested';
      taskOutcome: 'owned_by_runner'; payment: 'not_inferred'; fulfillment: 'not_inferred' };
export type AiSelectedQuoteTaskRecoveryDraft = AiSelectedQuoteTaskRunDraft | AiSelectedQuoteTaskResultDraft;
export interface AiSelectedQuoteTaskCancelResponseDraft {
  receipt: { event: Extract<AiTaskEventDraft, { type: 'task.transition' }>; runRevision: number | null };
  cancellation: 'requested_not_rollback';
}
export interface AiHumanQuoteOrderDecisionResponseDraft { approval: AiApprovalRecordDraft; order: 'not_created_by_decision' }
export interface AiHumanQuoteOrderReprepareResponseDraft {
  receipt: AiApprovalReprepareReceiptDraft;
  replacement: { selection: AiQuoteSelectionProofDraft; review: AiApprovalApplicationReviewDraft } | null;
  order: 'not_created_by_reprepare';
}

export interface AiQuoteSelectionReceiptDraft {
  draftVersion: typeof AI_QUOTE_SELECTION_DRAFT_VERSION;
  selectionId: string;
  selectionKey: string;
  revision: number;
  originalInputRef: string;
  taskId: string;
  runId: string;
  quoteId: string;
  quoteHash: string;
  inputHash: string;
  expiresAt: string;
  state: 'selected_not_approved' | 'expired' | 'superseded';
  approval: 'not_granted';
  order: 'not_created_by_selection';
}
