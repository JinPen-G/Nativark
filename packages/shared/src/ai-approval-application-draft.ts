import type { AiApprovalRecordDraft, AiProposalDecisionRequestDraft, AiProposalRecordDraft } from './ai-proposal-draft';
import type { RentalFulfillmentMode, RentalPricingUnit } from './core';

export const AI_APPROVAL_APPLICATION_DRAFT_VERSION = 'ain-approval-application-draft-1' as const;
export type AiApprovalApplicationReferenceDraft = Omit<AiProposalDecisionRequestDraft, 'decision'>;
export type AiApprovalApplicationDecisionDraft = AiProposalDecisionRequestDraft & {
  /** New order approval acknowledges the material contract, never supplies facts or authority. Old receipts may omit it. */
  reviewVersion?: typeof AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION;
};
export type AiApprovalApplicationReceiptDraft =
  | { kind: 'recorded'; record: AiApprovalRecordDraft }
  | { kind: 'absent'; retryable: false }
  | { kind: 'unknown'; retryable: false; nextAction: 'read_decision_receipt' };
/** Review v2 is display-only; original decision/reprepare/receipt keys stay v1. */
export const AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION = 'ain-approval-order-review-draft-2' as const;
export interface AiApprovalOrderMaterialDraft {
  customer: { id: string; type: 'personal' | 'corporate'; name?: string };
  booking: { identity: 'personal' | 'enterprise_employee'; corporateCustomerId?: string;
    corporateCustomerName?: string; enterpriseContractAndPayer: boolean };
  lines: Array<{ itemGroupId: string; pricingGroupId?: string; name?: string; quantity: number; pricingUnit?: RentalPricingUnit }>;
  period: { startAt: string; endAt: string; timeZone?: string };
  fulfillment: { mode: RentalFulfillmentMode; pickupLocationId: string; returnLocationId: string;
    deliveryAddress?: { recipient: string; countryCode: string; province: string; city: string;
      district?: string; detail: string; postalCode?: string } };
  services: Array<{ serviceId: string; name: string; quantity: number; startAt: string; endAt: string;
    locationId: string; requiredByRule: boolean }>;
}
/** Legacy review remains a separate read-only compatibility contract. */
export interface AiApprovalApplicationReviewDraftV1 {
  draftVersion: typeof AI_APPROVAL_APPLICATION_DRAFT_VERSION;
  proposal: AiProposalRecordDraft;
  deterministic: {
    target: AiProposalRecordDraft['payload']['actions'][number]['target'];
    quoteAmounts: { rentalAmount: number; discountAmount: number; couponAmount: number; serviceAmount: number;
      fulfillmentAmount: number; depositAmount: number; preAuthAmount: number; payableAmount: number; receivableAmount: number };
    currency: string;
    quoteExpiresAt: string;
    decisionExpiresAt: string;
  };
  generatedText: null;
}
export interface AiApprovalApplicationReviewDraft extends Omit<AiApprovalApplicationReviewDraftV1, 'draftVersion' | 'deterministic'> {
  draftVersion: typeof AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION;
  deterministic: AiApprovalApplicationReviewDraftV1['deterministic'] & { order: AiApprovalOrderMaterialDraft };
}
export interface AiApprovalReprepareEligibilityRequestDraft {
  draftVersion: typeof AI_APPROVAL_APPLICATION_DRAFT_VERSION;
  original: AiApprovalApplicationReferenceDraft;
  intent: 'inspect' | 'change_plan';
}
export type AiApprovalReprepareEligibilityDraft = {
  draftVersion: typeof AI_APPROVAL_APPLICATION_DRAFT_VERSION;
  original: AiApprovalApplicationReferenceDraft;
} & (
  | { state: 'pending'; canRequestReprepare: false; nextAction: 'review_or_decide' }
  | { state: 'change_requested' | 'rejected' | 'expired'; canRequestReprepare: true; nextAction: 'provide_new_materials' }
  | { state: 'approved_uncommitted' | 'unknown'; canRequestReprepare: false; nextAction: 'reconcile_original' }
  | { state: 'committed'; canRequestReprepare: false; nextAction: 'read_original_result' }
  | { state: 'superseded'; canRequestReprepare: false; nextAction: 'read_reprepare_receipt' }
);
export interface AiApprovalReprepareCommandDraft {
  draftVersion: typeof AI_APPROVAL_APPLICATION_DRAFT_VERSION;
  operationKey: string;
  originalTaskId: string;
  original: AiApprovalApplicationReferenceDraft;
  reason: 'rejected' | 'expired' | 'change_plan';
  replacement: { taskId: string; runId: string; stepId: string; actionId: string; inputRef: string; fingerprint: string;
    originalInputRef: string; quoteSelectionRef: string; planHash: string };
}
export type AiApprovalReprepareReceiptDraft = {
  draftVersion: typeof AI_APPROVAL_APPLICATION_DRAFT_VERSION;
  operationKey: string;
  receiptId: string;
  originalTaskId: string;
  original: AiApprovalApplicationReferenceDraft;
  replacementTaskId: string;
} & (
  | { state: 'prepared'; proposal: AiApprovalApplicationReferenceDraft; nextAction: 'review_and_decide' }
  | { state: 'unknown'; retryable: false; nextAction: 'read_reprepare_receipt' }
);
export type AiApprovalApplicationErrorDraft =
  | { code: 'invalid_request' | 'access_denied' | 'revision_conflict' | 'unavailable'; retryable: false;
      nextAction: 'correct_request' | 'reauthorize' | 'reread_original' | 'manual' }
  | { code: 'result_unknown'; retryable: false; nextAction: 'read_decision_receipt' | 'read_reprepare_receipt' | 'reconcile_original' };
