"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS = void 0;
const ai_approval_application_draft_1 = require("./ai-approval-application-draft");
const ai_proposal_draft_1 = require("./ai-proposal-draft");
const ai_gateway_draft_schemas_1 = require("./ai-gateway-draft-schemas");
const id = (maxLength = 191) => ({ type: 'string', minLength: 1, maxLength, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' });
const hash = { type: 'string', minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' };
const revision = (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967294), version = (0, ai_gateway_draft_schemas_1.leafEnum)(ai_approval_application_draft_1.AI_APPROVAL_APPLICATION_DRAFT_VERSION);
const noRetry = { type: 'boolean', const: false };
const originalFields = { contractVersion: (0, ai_gateway_draft_schemas_1.leafEnum)(ai_proposal_draft_1.AI_PROPOSAL_DRAFT_VERSION), proposalId: id(36), proposalRevision: revision, reviewedPayloadHash: hash };
const original = (0, ai_gateway_draft_schemas_1.leafClosed)(originalFields), money = { type: 'number', minimum: 0 };
const eligibility = (state, canRequestReprepare, nextAction) => (0, ai_gateway_draft_schemas_1.leafClosed)({ draftVersion: version, original,
    state: (0, ai_gateway_draft_schemas_1.leafEnum)(state), canRequestReprepare: { type: 'boolean', const: canRequestReprepare }, nextAction: (0, ai_gateway_draft_schemas_1.leafEnum)(nextAction) });
const receipt = { draftVersion: version, operationKey: id(), receiptId: id(36), originalTaskId: id(36), original, replacementTaskId: id(36) };
exports.AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS = {
    AiApprovalApplicationReferenceDraft: original,
    AiApprovalApplicationDecisionDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...originalFields, decision: (0, ai_gateway_draft_schemas_1.leafEnum)('approve', 'reject') }),
    AiApprovalApplicationReceiptDraft: { oneOf: [(0, ai_gateway_draft_schemas_1.leafClosed)({ kind: (0, ai_gateway_draft_schemas_1.leafEnum)('recorded'), record: (0, ai_gateway_draft_schemas_1.leafRef)('AiApprovalRecordDraft') }),
            (0, ai_gateway_draft_schemas_1.leafClosed)({ kind: (0, ai_gateway_draft_schemas_1.leafEnum)('absent'), retryable: noRetry }), (0, ai_gateway_draft_schemas_1.leafClosed)({ kind: (0, ai_gateway_draft_schemas_1.leafEnum)('unknown'), retryable: noRetry, nextAction: (0, ai_gateway_draft_schemas_1.leafEnum)('read_decision_receipt') })] },
    AiApprovalApplicationReviewDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ draftVersion: version, proposal: (0, ai_gateway_draft_schemas_1.leafRef)('AiProposalRecordDraft'),
        deterministic: (0, ai_gateway_draft_schemas_1.leafClosed)({ target: (0, ai_gateway_draft_schemas_1.leafClosed)({ resourceType: (0, ai_gateway_draft_schemas_1.leafEnum)('order', 'quote', 'configuration', 'customer', 'inspection', 'category'), resourceId: id(), version: id() }),
            quoteAmounts: (0, ai_gateway_draft_schemas_1.leafClosed)({ rentalAmount: money, discountAmount: money, couponAmount: money, serviceAmount: money, fulfillmentAmount: money,
                depositAmount: money, preAuthAmount: money, payableAmount: money, receivableAmount: money }),
            currency: { type: 'string', minLength: 1, maxLength: 16 }, quoteExpiresAt: ai_gateway_draft_schemas_1.leafTime, decisionExpiresAt: ai_gateway_draft_schemas_1.leafTime }), generatedText: { type: 'null' } }),
    AiApprovalReprepareEligibilityRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ draftVersion: version, original, intent: (0, ai_gateway_draft_schemas_1.leafEnum)('inspect', 'change_plan') }),
    AiApprovalReprepareEligibilityDraft: { oneOf: [eligibility('pending', false, 'review_or_decide'),
            eligibility('change_requested', true, 'provide_new_materials'), eligibility('rejected', true, 'provide_new_materials'),
            eligibility('expired', true, 'provide_new_materials'), eligibility('approved_uncommitted', false, 'reconcile_original'),
            eligibility('unknown', false, 'reconcile_original'), eligibility('committed', false, 'read_original_result'),
            eligibility('superseded', false, 'read_reprepare_receipt')] },
    AiApprovalReprepareCommandDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ draftVersion: version, operationKey: id(), originalTaskId: id(36), original,
        reason: (0, ai_gateway_draft_schemas_1.leafEnum)('rejected', 'expired', 'change_plan'), replacement: (0, ai_gateway_draft_schemas_1.leafClosed)({ taskId: id(36), runId: id(36), stepId: id(36), actionId: id(),
            inputRef: id(36), fingerprint: hash, originalInputRef: id(), quoteSelectionRef: id(36), planHash: hash }) }),
    AiApprovalReprepareReceiptDraft: { oneOf: [(0, ai_gateway_draft_schemas_1.leafClosed)({ ...receipt, state: (0, ai_gateway_draft_schemas_1.leafEnum)('prepared'), proposal: original, nextAction: (0, ai_gateway_draft_schemas_1.leafEnum)('review_and_decide') }),
            (0, ai_gateway_draft_schemas_1.leafClosed)({ ...receipt, state: (0, ai_gateway_draft_schemas_1.leafEnum)('unknown'), retryable: noRetry, nextAction: (0, ai_gateway_draft_schemas_1.leafEnum)('read_reprepare_receipt') })] },
    AiApprovalApplicationErrorDraft: { oneOf: [
            ...[['invalid_request', 'correct_request'], ['access_denied', 'reauthorize'], ['revision_conflict', 'reread_original'], ['unavailable', 'manual']]
                .map(([code, nextAction]) => (0, ai_gateway_draft_schemas_1.leafClosed)({ code: (0, ai_gateway_draft_schemas_1.leafEnum)(code), retryable: noRetry, nextAction: (0, ai_gateway_draft_schemas_1.leafEnum)(nextAction) })),
            (0, ai_gateway_draft_schemas_1.leafClosed)({ code: (0, ai_gateway_draft_schemas_1.leafEnum)('result_unknown'), retryable: noRetry, nextAction: (0, ai_gateway_draft_schemas_1.leafEnum)('read_decision_receipt', 'read_reprepare_receipt', 'reconcile_original') })
        ] }
};
//# sourceMappingURL=ai-approval-application-draft-schemas.js.map