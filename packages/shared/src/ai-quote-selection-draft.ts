import type { CreateRentalOrderRequest } from './core';
import type { AiSceneRequestReadDraft } from './ai-scene-request-draft';
import type { AiTaskInputSubmissionDraft } from './ai-task-input-draft';

export const AI_QUOTE_SELECTION_DRAFT_VERSION = 'ain-quote-selection-draft-1' as const;
/** Opt-in only; registration does not grant identity, approval or execution. */
export const AI_QUOTE_SELECTION_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/quote-selections', select: '', read: 'read', reconcile: 'reconcile'
} as const);
/** Explicit handoff of the exact clarified quote to its unplanned successor.
 * Selection still does not start the order runner or grant human approval. */
export const AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_QUOTE_SELECTION_HTTP_DRAFT.basePath}/clarified`, select: 'select', readOperation: 'operation'
} as const);
export interface AiClarifiedQuoteSelectionRequestDraft {
  selection: AiQuoteSelectionCreateDraft;
  clarification: { original: AiSceneRequestReadDraft; submission: AiTaskInputSubmissionDraft };
}
/** Human review/decision transport only. Core execution remains runner-owned. */
export const AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_QUOTE_SELECTION_HTTP_DRAFT.basePath}/approval`,
  readSelectedProposal: 'review', decideSelectedProposal: 'decide', readSelectedDecisionReceipt: 'decision-receipt',
  readSelectedOrderResult: 'order-result', readSelectedReprepareEligibility: 'reprepare-eligibility',
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
