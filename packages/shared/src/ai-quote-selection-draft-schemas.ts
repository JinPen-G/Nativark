import { AI_QUOTE_SELECTION_DRAFT_VERSION } from './ai-quote-selection-draft';
import { RENTAL_FULFILLMENT_MODES } from './core';
import { AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS } from './ai-approval-application-draft-schemas';
import { AI_TASK_INPUT_DRAFT_SCHEMAS } from './ai-task-input-draft-schemas';
import { AI_SCENE_REQUEST_DRAFT_VERSION } from './ai-scene-request-draft';
import { leafClosed as object, leafEnum as choice, leafId as id, leafText as text, leafInt as integer, leafList as list, leafTime, leafRef as ref, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

const version = choice(AI_QUOTE_SELECTION_DRAFT_VERSION), uuid = { type: 'string', format: 'uuid' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const order = object({ quoteId: id(), customerType: choice('personal'), customerId: id(), customerName: text(), contactPhone: text(32),
  bookingIdentity: { oneOf: [object({ bookingIdentity: choice('personal') }),
    object({ bookingIdentity: choice('enterprise_employee'), corporateCustomerId: id(), enterpriseContractAndPayer: { type: 'boolean' } })] },
  fulfillmentMode: choice(...RENTAL_FULFILLMENT_MODES), fulfillmentLocationId: id(),
  returnLocationId: id(), startAt: leafTime, endAt: leafTime,
  lines: list(object({ itemGroupId: id(), pricingGroupId: id(), quantity: integer(1, 10000), note: text(191) }, ['itemGroupId', 'quantity']), 50, 1)
}, ['quoteId', 'customerType', 'customerId', 'customerName', 'fulfillmentMode', 'fulfillmentLocationId', 'startAt', 'endAt', 'lines']);
const reference = { draftVersion: version, originalInputRef: uuid, selectionId: uuid };
const selectionProof = object({ ...reference, taskId: uuid, runId: uuid, inputHash: hash });
const selectionCreate = object({ draftVersion: version, originalInputRef: uuid, taskId: uuid, runId: uuid,
  selectionKey: { ...id(), maxLength: 128 }, expectedSelectionRevision: integer(0, 4294967293), order });
export const AI_QUOTE_SELECTION_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiSelectedQuoteTaskRequestDraft: object({ selection: selectionProof }),
  AiSelectedQuoteTaskConfirmationRequestDraft: object({ selection: selectionProof, stepId: uuid }),
  AiSelectedQuoteTaskContinueRequestDraft: object({ selection: selectionProof, checkpointRef: uuid }),
  AiSelectedQuoteTaskCancelRequestDraft: object({ selection: selectionProof, expectedRevision: integer(1, 4294967294) }),
  AiHumanQuoteOrderReviewRequestDraft: object({ selection: selectionProof,
    proposal: AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS.AiApprovalApplicationReferenceDraft }),
  AiHumanQuoteOrderDecisionRequestDraft: object({ selection: selectionProof,
    proposal: AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS.AiApprovalApplicationDecisionDraft }),
  AiHumanQuoteOrderReprepareEligibilityRequestDraft: object({ selection: selectionProof,
    request: AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS.AiApprovalReprepareEligibilityRequestDraft }),
  AiHumanQuoteOrderReprepareRequestDraft: object({ selection: selectionProof,
    command: AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS.AiApprovalReprepareCommandDraft }),
  AiQuoteSelectionCreateDraft: selectionCreate,
  AiClarifiedQuoteSelectionRequestDraft: object({ selection: selectionCreate, clarification: object({
    original: object({ draftVersion: choice(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: uuid }),
    submission: AI_TASK_INPUT_DRAFT_SCHEMAS.AiTaskInputSubmissionDraft }) }),
  AiQuoteSelectionSelectResponseDraft: object({ receipt: ref('AiQuoteSelectionReceiptDraft'), replayed: { type: 'boolean' } }),
  AiQuoteSelectionReconcileResponseDraft: { oneOf: [
    object({ state: choice('not_observed'), retryable: { type: 'boolean', const: false } }),
    object({ state: choice('observed'), receipt: ref('AiQuoteSelectionReceiptDraft'), retryable: { type: 'boolean', const: false } })] },
  AiQuoteSelectionReadDraft: object(reference),
  AiQuoteSelectionProofRequest: selectionProof,
  AiQuoteSelectionReceiptDraft: object({ ...reference, selectionKey: { ...id(), maxLength: 128 }, revision: integer(1, 4294967294),
    taskId: uuid, runId: uuid, quoteId: id(), quoteHash: hash, inputHash: hash, expiresAt: leafTime,
    state: choice('selected_not_approved', 'expired', 'superseded'), approval: choice('not_granted'), order: choice('not_created_by_selection') })
};
