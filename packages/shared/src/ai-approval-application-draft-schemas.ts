import { AI_APPROVAL_APPLICATION_DRAFT_VERSION } from './ai-approval-application-draft';
import { AI_PROPOSAL_DRAFT_VERSION } from './ai-proposal-draft';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafInt as int, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

const id = (maxLength = 191) => ({ type: 'string', minLength: 1, maxLength, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' });
const hash = { type: 'string', minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' };
const revision = int(1, 4294967294), version = choice(AI_APPROVAL_APPLICATION_DRAFT_VERSION);
const noRetry = { type: 'boolean', const: false };
const originalFields = { contractVersion: choice(AI_PROPOSAL_DRAFT_VERSION), proposalId: id(36), proposalRevision: revision, reviewedPayloadHash: hash };
const original = obj(originalFields), money = { type: 'number', minimum: 0 };
const eligibility = (state: string, canRequestReprepare: boolean, nextAction: string) => obj({ draftVersion: version, original,
  state: choice(state), canRequestReprepare: { type: 'boolean', const: canRequestReprepare }, nextAction: choice(nextAction) });
const receipt = { draftVersion: version, operationKey: id(), receiptId: id(36), originalTaskId: id(36), original, replacementTaskId: id(36) };
export const AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiApprovalApplicationReferenceDraft: original,
  AiApprovalApplicationDecisionDraft: obj({ ...originalFields, decision: choice('approve', 'reject') }),
  AiApprovalApplicationReceiptDraft: { oneOf: [obj({ kind: choice('recorded'), record: ref('AiApprovalRecordDraft') }),
    obj({ kind: choice('absent'), retryable: noRetry }), obj({ kind: choice('unknown'), retryable: noRetry, nextAction: choice('read_decision_receipt') })] },
  AiApprovalApplicationReviewDraft: obj({ draftVersion: version, proposal: ref('AiProposalRecordDraft'),
    deterministic: obj({ target: obj({ resourceType: choice('order', 'quote', 'configuration', 'customer', 'inspection', 'category'), resourceId: id(), version: id() }),
      quoteAmounts: obj({ rentalAmount: money, discountAmount: money, couponAmount: money, serviceAmount: money, fulfillmentAmount: money,
        depositAmount: money, preAuthAmount: money, payableAmount: money, receivableAmount: money }),
      currency: { type: 'string', minLength: 1, maxLength: 16 }, quoteExpiresAt: time, decisionExpiresAt: time }), generatedText: { type: 'null' } }),
  AiApprovalReprepareEligibilityRequestDraft: obj({ draftVersion: version, original, intent: choice('inspect', 'change_plan') }),
  AiApprovalReprepareEligibilityDraft: { oneOf: [eligibility('pending', false, 'review_or_decide'),
    eligibility('change_requested', true, 'provide_new_materials'), eligibility('rejected', true, 'provide_new_materials'),
    eligibility('expired', true, 'provide_new_materials'), eligibility('approved_uncommitted', false, 'reconcile_original'),
    eligibility('unknown', false, 'reconcile_original'), eligibility('committed', false, 'read_original_result'),
    eligibility('superseded', false, 'read_reprepare_receipt')] },
  AiApprovalReprepareCommandDraft: obj({ draftVersion: version, operationKey: id(), originalTaskId: id(36), original,
    reason: choice('rejected', 'expired', 'change_plan'), replacement: obj({ taskId: id(36), runId: id(36), stepId: id(36), actionId: id(),
      inputRef: id(36), fingerprint: hash, originalInputRef: id(), quoteSelectionRef: id(36), planHash: hash }) }),
  AiApprovalReprepareReceiptDraft: { oneOf: [obj({ ...receipt, state: choice('prepared'), proposal: original, nextAction: choice('review_and_decide') }),
    obj({ ...receipt, state: choice('unknown'), retryable: noRetry, nextAction: choice('read_reprepare_receipt') })] },
  AiApprovalApplicationErrorDraft: { oneOf: [
    ...[['invalid_request', 'correct_request'], ['access_denied', 'reauthorize'], ['revision_conflict', 'reread_original'], ['unavailable', 'manual']]
      .map(([code, nextAction]) => obj({ code: choice(code), retryable: noRetry, nextAction: choice(nextAction) })),
    obj({ code: choice('result_unknown'), retryable: noRetry, nextAction: choice('read_decision_receipt', 'read_reprepare_receipt', 'reconcile_original') })
  ] }
};
