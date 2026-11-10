import { AI_QUOTE_SELECTION_DRAFT_VERSION } from './ai-quote-selection-draft';
import { RENTAL_FULFILLMENT_MODES } from './core';
import { AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS, AI_APPROVAL_ORDER_MATERIAL_SCHEMA } from './ai-approval-application-draft-schemas';
import { AI_TASK_INPUT_DRAFT_SCHEMAS } from './ai-task-input-draft-schemas';
import { AI_SCENE_REQUEST_DRAFT_VERSION } from './ai-scene-request-draft';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT } from './ai-task-draft';
import { AI_PROPOSAL_DRAFT_VERSION } from './ai-proposal-draft';
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
const operationLocator = object({ draftVersion: version, originalInputRef: uuid, taskId: uuid, runId: uuid,
  selectionKey: { ...id(), maxLength: 128 }, expectedSelectionRevision: integer(0, 4294967293), quoteId: id() });
const clarification = { oneOf: [object({ original: object({ draftVersion: choice(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: uuid }),
  submission: AI_TASK_INPUT_DRAFT_SCHEMAS.AiTaskInputSubmissionDraft }),
object({ original: object({ draftVersion: choice(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: uuid }),
  reference: AI_TASK_INPUT_DRAFT_SCHEMAS.AiTaskInputReceiptReferenceDraft })] };
const no = { type: 'boolean', const: false }, revision = integer(1, 4294967295);
const runResult = { oneOf: [
  object({ kind: choice('not_started'), reason: choice('host_aborted', 'plan_unavailable', 'task_not_runnable', 'lease_held',
    'recovery_lease_unavailable', 'confirmation_lease_unavailable') }),
  object({ kind: choice('run_outcome'), outcome: ref('AiTaskRunnerOutcomeDraft') })] };
const checkpoint = object({ taskId: uuid, runId: uuid, stepId: uuid, taskRevision: revision, checkpointRef: uuid,
  proposal: object({ contractVersion: choice(AI_PROPOSAL_DRAFT_VERSION), proposalId: { ...id(), maxLength: 36 },
    proposalRevision: integer(1, 4294967294), reviewedPayloadHash: hash }), execution: choice('not_attested') });
const orderResult = { oneOf: [
  object({ status: choice('committed'), replayed: { type: 'boolean' }, order: object({ id: id(), status: text(64), quoteId: id() }),
    source: object({ resourceType: choice('order'), resourceId: id() }), payment: choice('not_inferred'), fulfillment: choice('not_inferred'),
    taskOutcome: choice('owned_by_runner') }),
  object({ status: choice('unknown'), errorCode: choice('AI_RESULT_UNKNOWN'), retryable: no,
    nextAction: choice('read_selected_order_result'), sideEffect: choice('may_have_committed') }),
  object({ status: choice('not_observed'), retryable: no, nextAction: choice('read_selected_order_result'), sideEffect: choice('not_attested'),
    taskOutcome: choice('owned_by_runner'), payment: choice('not_inferred'), fulfillment: choice('not_inferred') })] };
const reprepare = AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS.AiApprovalReprepareReceiptDraft.oneOf!;
export const AI_QUOTE_SELECTION_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiOriginalTaskEventsReadDraft: object({ original: ref('AiSceneRequestReadDraft'), after: {
    type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' }, limit: integer(1, 100) }),
  AiSelectedQuoteTaskRunDraft: runResult,
  AiSelectedQuoteTaskCheckpointDraft: checkpoint,
  AiSelectedQuoteTaskConfirmationDraft: { oneOf: [checkpoint, object({ state: choice('not_waiting'),
    history: ref('AiTaskConfirmationHistoryDraft'), execution: choice('not_attested'), continuation: choice('not_invoked') })] },
  AiSelectedQuoteTaskResultDraft: orderResult,
  AiSelectedQuoteTaskRecoveryDraft: { oneOf: [runResult, orderResult] },
  AiSelectedQuoteTaskCancelResponseDraft: object({ receipt: object({ event: object({ contractVersion: choice(AI_TASK_DRAFT_VERSION),
    taskId: uuid, cursor: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' }, taskRevision: revision, occurredAt: leafTime,
    type: choice('task.transition'), data: object({ from: choice(...AI_TASK_STATUSES_DRAFT), to: choice('cancel_requested'), reason: choice('cancel_requested') }) }),
    runRevision: { oneOf: [revision, { type: 'null' }] } }), cancellation: choice('requested_not_rollback') }),
  AiHumanQuoteOrderDecisionResponseDraft: object({ approval: ref('AiApprovalRecordDraft'), order: choice('not_created_by_decision') }),
  AiHumanQuoteOrderReprepareResponseDraft: { oneOf: [
    object({ receipt: reprepare[0], replacement: object({ selection: selectionProof, review: ref('AiApprovalApplicationReviewDraft') }),
      order: choice('not_created_by_reprepare') }),
    object({ receipt: reprepare[1], replacement: { type: 'null' }, order: choice('not_created_by_reprepare') })] },
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
  AiHumanQuoteOrderRepreparePreparationInputDraft: object({ selection: selectionProof, replacementTaskId: uuid,
    original: AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS.AiApprovalApplicationReferenceDraft,
    operationKey: { ...id(), maxLength: 128 }, intent: choice('inspect', 'change_plan') }),
  AiHumanQuoteOrderRepreparePreparationDraft: object({ selection: selectionProof, replacement: selectionProof,
    command: AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS.AiApprovalReprepareCommandDraft,
    originalReview: ref('AiApprovalApplicationReviewDraft'), replacementReview: ref('AiApprovalApplicationReviewDraft'),
    state: choice('read_only'), supersession: choice('not_attempted'), approval: choice('not_granted'), order: choice('not_created') }),
  AiHumanQuoteOrderResultReadRequestDraft: object({ selection: selectionProof, command: object({
    taskId: { ...id(), maxLength: 36 }, proposalId: { ...id(), maxLength: 36 }, approvalId: { ...id(), maxLength: 36 }, actionId: id(),
    proposalRevision: integer(1, 4294967294), reviewedPayloadHash: hash,
    lease: object({ runId: { ...id(), maxLength: 36 }, holderId: id(), revision: integer(1, 4294967294),
      fencingToken: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' } }) }) }),
  AiQuoteSelectionCreateDraft: selectionCreate,
  AiClarifiedQuoteSelectionRequestDraft: object({ selection: selectionCreate, clarification }),
  AiQuoteSelectionOperationLocatorDraft: operationLocator,
  AiClarifiedQuoteSelectionOriginalOperationReadDraft: object({ selection: operationLocator, clarification }),
  AiClarifiedQuoteSelectionPreparationInputDraft: object({ clarification, selectionKey: { ...id(), maxLength: 128 }, expectedSelectionRevision: integer(0, 4294967293) }),
  AiClarifiedQuoteSelectionPreparationDraft: object({ selection: selectionCreate, clarification, material: AI_APPROVAL_ORDER_MATERIAL_SCHEMA,
    quote: object({ id: id(), originalOperation: choice('read_only') }), selectionState: choice('not_saved'), quotation: choice('original_unchanged'),
    approval: choice('not_granted'), order: choice('not_created'), nextAction: choice('explicit_human_selection_then_original_approval') }),
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
