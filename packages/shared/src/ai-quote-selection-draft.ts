import type { CreateRentalOrderRequest } from './core';

export const AI_QUOTE_SELECTION_DRAFT_VERSION = 'ain-quote-selection-draft-1' as const;
/** Opt-in only; registration does not grant identity, approval or execution. */
export const AI_QUOTE_SELECTION_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/quote-selections', select: '', read: 'read', reconcile: 'reconcile'
} as const);
/** Human review/decision transport only. Core execution remains runner-owned. */
export const AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_QUOTE_SELECTION_HTTP_DRAFT.basePath}/approval`,
  readSelectedProposal: 'review', decideSelectedProposal: 'decide', readSelectedDecisionReceipt: 'decision-receipt',
  readSelectedOrderResult: 'order-result', readSelectedReprepareEligibility: 'reprepare-eligibility',
  reprepareSelectedProposal: 'reprepare', readSelectedReprepareReceipt: 'reprepare-receipt'
} as const);
export type AiQuoteSelectedOrderDraft = Pick<CreateRentalOrderRequest,
  'quoteId' | 'customerId' | 'customerName' | 'contactPhone' | 'fulfillmentMode' | 'fulfillmentLocationId' | 'returnLocationId' | 'startAt' | 'endAt' | 'lines'> & {
    customerType: 'personal'; customerId: string; bookingIdentity?: { bookingIdentity: 'personal' };
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
