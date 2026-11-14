import { AI_INSPECTION_DRAFT_VERSION, AI_INSPECTION_TASK_POLICY_OPERATIONS } from "./ai-inspection-draft";
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT } from './ai-task-draft';
import { AI_INSPECTION_LIFECYCLE_HTTP_SCHEMAS } from './ai-inspection-lifecycle-http-draft';
import { AI_TASK_RECOVERY_HTTP_SCHEMAS } from './ai-task-recovery-draft';
import { AI_TASK_INPUT_DRAFT_SCHEMAS } from './ai-task-input-draft-schemas';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id, leafInt as int, leafList as list, leafText as text, leafTime, type AiLeafSchemaDraft } from "./ai-gateway-draft-schemas";
const coordinate = { type: "number", minimum: 0, maximum: 1 };
const dimension = { type: "number", exclusiveMinimum: 0, maximum: 1 };
const source = { attachmentId: id(), attachmentRevision: int(1) };
const candidate = { candidateId: id(), fieldCode: id(), sourceText: text(2000, 0) };
const taskId = { ...id(), maxLength: 128 };
const no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const taskSummary = obj({ taskId: { ...id(), maxLength: 36 }, runId: { ...id(), maxLength: 36 }, status: choice(...AI_TASK_STATUSES_DRAFT),
  revision: int(1, 4294967295), replayed: { type: 'boolean' } });
const taskObservation = { creationKey: { type: 'string', pattern: '^inspection:[a-f0-9]{64}$' }, execution: choice('not_attested'), retryable: no };
const taskSemantics = choice('original_metadata_not_dispatch_or_candidate_evidence');
const policyRequest = { reference: ref('AiInspectionRecognitionTaskReference'), operation: choice(...AI_INSPECTION_TASK_POLICY_OPERATIONS) };
const policySemantics = { purpose: choice('original_inspection_candidate_runtime_only'), approval: choice('not_granted'), inspectionSubmission: choice('not_attempted') };
const policy = obj({ taskId: id(), operation: policyRequest.operation, revision: int(1, 4294967294),
  requiredPermissions: { ...list(id(), 64, 1), uniqueItems: true }, expiresAt: leafTime });
const taskExecution: AiLeafSchemaDraft = { oneOf: AI_TASK_RECOVERY_HTTP_SCHEMAS.AiSceneModelExecutionDraft.oneOf!.slice(0, 2) };
const continuation = AI_TASK_RECOVERY_HTTP_SCHEMAS.AiSceneModelResumeResponseDraft.properties!.continuation.oneOf!;
const receipt = AI_TASK_RECOVERY_HTTP_SCHEMAS.AiSceneModelCancelResponseDraft.properties!.receipt;
const transition = (settled: boolean, terminal: 'cancelled' | 'succeeded' | 'partially_succeeded' = 'cancelled') => ({ ...receipt, required: ['event'], properties: { ...receipt.properties!,
  event: { ...receipt.properties!.event, properties: { ...receipt.properties!.event.properties!,
    cursor: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' },
    data: obj({ from: settled ? choice('cancel_requested') : choice(...AI_TASK_STATUSES_DRAFT), to: choice(settled ? terminal : 'cancel_requested'),
      reason: choice(settled ? 'cancel_settled' : 'cancel_requested') }) } } } });
const settlementTargets = ['cancelled', 'succeeded', 'partially_succeeded'] as const;
const cancellationMeaning = (terminal: typeof settlementTargets[number]) => terminal === 'cancelled'
  ? 'task_cancelled_not_business_rollback' : 'request_settled_not_business_rollback';
const cancellationObservation = (settled: boolean): AiLeafSchemaDraft => ({ oneOf:
  (settled ? settlementTargets : ['cancelled'] as const).flatMap((terminal, index) =>
    (index === 0 ? ['observed', 'not_observed'] : ['observed']).map(status => obj({
      taskId: id(), expectedRevision: int(1, 4294967294), status: choice(status),
      event: status === 'observed' ? transition(settled, terminal).properties.event : { type: 'null' },
      snapshot: obj({ revision: int(1, 4294967295), cursor: { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' },
        status: settled && status === 'observed' ? choice(terminal) : choice(...AI_TASK_STATUSES_DRAFT) }),
      cancellation: choice(settled ? cancellationMeaning(terminal) : 'request_not_rollback'),
      remoteCancellation: choice('not_attested'), automaticRetry: no, admission: choice('not_granted'),
      absenceSemantics: choice('not_observed_is_not_proof_of_uncommitted')
    }))) });
export const AI_INSPECTION_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiInspectionTaskResultReferenceObservation: { oneOf: [
    obj({ contractVersion: choice(AI_TASK_DRAFT_VERSION), task: taskSummary, state: choice('observed'),
      reference: AI_INSPECTION_LIFECYCLE_HTTP_SCHEMAS.AiInspectionResultReadRequest,
      execution: choice('read_only_no_lease_or_dispatch'), retryable: no, nextAction: choice('read_original_result') }),
    obj({ contractVersion: choice(AI_TASK_DRAFT_VERSION), task: { oneOf: [taskSummary, { type: 'null' }] }, state: choice('not_observed'),
      reference: { type: 'null' }, execution: choice('read_only_no_lease_or_dispatch'), retryable: no, nextAction: choice('read_original_task') })
  ] },
  AiInspectionTaskPolicyRequest: obj(policyRequest),
  AiInspectionTaskPolicyConfigureRequest: obj({ ...policyRequest, expectedRevision: { oneOf: [int(1, 4294967293), { type: 'null' }] } }),
  AiInspectionTaskPolicyClearRequest: obj({ ...policyRequest, expectedRevision: int(1, 4294967293) }),
  AiInspectionTaskPolicyReadResponse: obj({ ...policySemantics, result: { oneOf: [
    obj({ state: choice('observed'), policy, retryable: no, nextAction: choice('read_original_policy') }),
    obj({ state: choice('not_observed'), retryable: no, nextAction: choice('reconcile') })] } }),
  AiInspectionTaskPolicyChangeResponse: obj({ ...policySemantics, result: policy }),
  AiInspectionTaskCreationResponse: obj({ task: taskSummary, execution: choice('not_attested'), purpose: choice('inspection_candidates_only') }),
  AiInspectionTaskCreationObservation: { oneOf: [
    obj({ ...taskObservation, state: choice('not_observed'), task: { type: 'null' }, nextAction: choice('read_original_task') }),
    obj({ ...taskObservation, state: choice('not_observed', 'unknown'), task: { type: 'null' }, nextAction: choice('reconcile'), semantics: taskSemantics }),
    obj({ ...taskObservation, state: choice('observed'), task: taskSummary, nextAction: choice('read_original_task'), semantics: taskSemantics })] },
  AiInspectionTaskExecutionResponse: taskExecution,
  AiInspectionTaskPendingInputResponse: ref('AiSceneModelPendingInputDraft'),
  AiInspectionTaskResumeResponse: obj({ receipt: ref('AiTaskInputSavedReceiptDraft'),
    continuation: { oneOf: [taskExecution, continuation[1], continuation[2]] } }),
  AiInspectionTaskAnswerObservation: ref('AiTaskInputReceiptObservationDraft'),
  AiInspectionTaskContinueResponse: { oneOf: [
    obj({ receipt: obj({ state: choice('not_observed'), retryable: no }), continuation: choice('unavailable') }),
    obj({ receipt: AI_TASK_INPUT_DRAFT_SCHEMAS.AiTaskInputReceiptObservationDraft.oneOf![1], result: taskExecution })] },
  AiInspectionRecognitionTaskReference: obj({ orderId: taskId, allocationId: taskId, stage: choice("pickup", "return"),
    templateId: taskId, draftId: taskId, inputId: taskId, expectedRevision: int(1, 999) }),
  AiInspectionRecognitionTaskCancelRequest: obj({ reference: ref("AiInspectionRecognitionTaskReference"), expectedRevision: int(1, 4294967294) }),
  AiInspectionTaskCancelResponse: obj({ receipt: transition(false), cancellation: choice('requested_not_rollback') }),
  AiInspectionTaskSettlementResponse: { oneOf: settlementTargets.map(terminal => obj({ receipt: transition(true, terminal),
    cancellation: choice(cancellationMeaning(terminal)), remoteCancellation: choice('not_attested'), automaticRetry: no, admission: choice('not_granted') })) },
  AiInspectionTaskCancelObservation: cancellationObservation(false),
  AiInspectionTaskSettlementObservation: cancellationObservation(true),
  AiInspectionRecognitionTaskResumeRequest: obj({ reference: ref("AiInspectionRecognitionTaskReference"), submission: ref("AiTaskInputSubmissionDraft") }),
  AiInspectionSourceDraft: { oneOf: [obj({ ...source, kind: choice("image"), region: obj({ x: coordinate, y: coordinate, width: dimension, height: dimension }) }), obj({ ...source, kind: choice("audio"), span: obj({ startMs: int(0, 86400000), endMs: int(0, 86400000) }) })] },
  AiInspectionValueDraft: { oneOf: [obj({ kind: choice("number"), value: { type: "number", minimum: -1e12, maximum: 1e12 } }), obj({ kind: choice("boolean"), value: { type: "boolean" } }), obj({ kind: choice("text", "select"), value: text(2000, 0) }), obj({ kind: choice("photo"), ...source })] },
  AiInspectionCandidateDraft: { oneOf: [obj({ ...candidate, sources: list(ref("AiInspectionSourceDraft"), 16, 1), status: choice("candidate"), value: ref("AiInspectionValueDraft"), confidence: coordinate }, ['candidateId', 'fieldCode', 'sources', 'status', 'value', 'confidence']), obj({ ...candidate, sources: list(ref("AiInspectionSourceDraft"), 16), status: choice("missing", "blurred"), reason: text(512) }, ['candidateId', 'fieldCode', 'sources', 'status', 'reason'])] },
  AiInspectionCorrectionDraft: obj({ correctionId: id(), candidateId: id(), expectedDraftRevision: int(1), value: ref("AiInspectionValueDraft"), reason: text(512), recordedAt: leafTime }),
  AiInspectionExtractDraft: obj({ draftVersion: choice(AI_INSPECTION_DRAFT_VERSION), draftId: id(), revision: int(1), scope: ref("AiWorkspaceScope"), orderId: id(), assetId: id(), allocationId: id(), stage: choice("pickup", "return"), frozenTemplate: obj({ templateId: id(), version: text(64) }), status: choice("awaiting_review", "pending_submission"), candidates: list(ref("AiInspectionCandidateDraft"), 100), corrections: list(ref("AiInspectionCorrectionDraft"), 100), reviewIssues: { ...list(choice("baseline_missing", "meter_replaced", "reading_backwards", "field_unavailable", "source_unclear"), 5), uniqueItems: true } })
};
