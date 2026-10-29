/** Public projections of the existing fixed model/order/answer chain. Original
 * readers own authority and recovery; model text is not a business receipt. */
import type { AiSceneRequestReceiptDraft } from './ai-scene-request-draft';
import type { AiSceneOrderFactsObservationDraft, AiTaskSceneObservationDraft } from './ai-task-scene-observation-draft';
import type { AiOrderReadFactsDraft } from './ai-order-facts-draft';
import type { AiOrderNextCandidateDraft } from './ai-business-material-draft';
import type { AiWorkspaceScope } from './ai-native';
import { AI_TASK_STATUSES_DRAFT, type AiTaskEventDraft, type AiTaskStatusDraft } from './ai-task-draft';
import { AI_TASK_RECOVERY_HTTP_SCHEMAS, type AiTaskRunnerOutcomeDraft, type AiModelCancellationTransitionReceiptDraft } from './ai-task-recovery-draft';
import { AI_TASK_SCENE_OBSERVATION_SCHEMAS } from './ai-task-scene-observation-draft-schemas';
import { AI_ORDER_FACTS_DRAFT_SCHEMAS } from './ai-order-facts-draft-schemas';
import { AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS } from './ai-business-material-draft-schemas';
import { AI_SCENE_REQUEST_DRAFT_SCHEMAS } from './ai-scene-request-draft-schemas';
import { AI_SCENE_MODEL_OBSERVATION_SCHEMAS } from './ai-scene-model-observation-draft-schemas';
import { AI_TASK_OBSERVATION_DRAFT_SCHEMAS } from './ai-task-observation-draft-schemas';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id, leafInt as integer,
  leafTime as time, leafList as list, leafText as text, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

type Original = Omit<AiSceneRequestReceiptDraft, 'sceneCode'> & { sceneCode: 'order_explanation' };
type AnswerFacts = Pick<AiOrderReadFactsDraft, 'audience' | 'scope' | 'order' | 'paymentEvidence' | 'historicalFeeEvidence'>;
export interface AiOrderReadPreparationResponseDraft {
  original: Original;
  preparation: { publishedInputs: number; requiredInputs: number; missing: Array<'model_request' | 'order_read' | 'model_answer'>;
    planPublished: boolean; execution: 'not_attested' };
  observation: 'revalidated_not_atomic'; automaticRetry: false;
}
export type AiOrderReadExecutionDraft =
  | { kind: 'not_started'; reason: 'host_aborted' | 'plan_unavailable' | 'task_not_runnable' | 'lease_held' | 'recovery_lease_unavailable' }
  | { kind: 'run_outcome'; outcome: AiTaskRunnerOutcomeDraft };
export type AiOrderReadStartResponseDraft = { outcome: { kind: 'not_started'; reason: 'host_aborted' } }
  | { original: Original; outcome: AiOrderReadExecutionDraft; businessExecution: 'readonly_not_business_commit' };
export type AiOrderReadRecoverResponseDraft = { original: Original; outcome: AiOrderReadExecutionDraft; automaticRetry: false };
export type AiOrderReadResumeResponseDraft = AiOrderReadRecoverResponseDraft & {
  preparation: 'original_inputs_only'; businessExecution: 'readonly_not_business_commit';
};
export type AiOrderReadTakeoverResponseDraft = {
  original: Original; automaticRetry: false; takeover: 'same_owner_recovery_only'; businessExecution: 'readonly_not_business_commit';
  outcome: { kind: 'not_started'; reason: 'host_aborted' } | { kind: 'run_outcome'; outcome: AiTaskRunnerOutcomeDraft;
    takeover: 'same_owner_recovery_only'; automaticRetry: false; businessExecution: 'readonly_not_business_commit' };
};
export type AiOrderReadAnswerResponseDraft = { original: Original; result:
  | { status: 'not_observed'; text: null; automaticRetry: false }
  | { resultId: string; status: 'unknown' | 'failed'; text: null; automaticRetry: false; businessExecution: 'readonly_not_business_commit' }
  | { resultId: string; status: 'stale'; text: null; automaticRetry: false; nextAction: 'new_explicit_request'; businessExecution: 'readonly_not_business_commit' }
  | { resultId: string; status: 'available'; text: string; originalReadResultId: string; facts: AnswerFacts; snapshotObservedAt: string;
      automaticRetry: false; textSemantics: 'model_text_not_core_fact'; businessExecution: 'readonly_not_business_commit' }
};
export interface AiOrderNextStepsResponseDraft {
  original: Original;
  next: { requestId: string; scope: AiWorkspaceScope; orderId: string; observedAt: string; status: 'candidates_only';
    allowedActions: 'unavailable'; candidates: AiOrderNextCandidateDraft[];
    manual: { kind: 'order_resource'; scope: AiWorkspaceScope; orderId: string; navigation: 'host_existing_order_route';
      authorization: 'destination_rechecks_permissions' };
    forbiddenAutomation: readonly ['refund', 'funds_disposition', 'exception_confirmation'] };
  execution: 'not_attempted'; approval: 'not_granted';
}
export type AiOrderReadSceneResponseDraft = Extract<AiTaskSceneObservationDraft, { kind: 'original' }> & {
  handoff: AiOrderNextStepsResponseDraft; answer?: AiOrderReadAnswerResponseDraft;
};
export type AiOrderReadCancellationObservationDraft = {
  taskId: string; expectedRevision: number; snapshot: { revision: number; cursor: string; status: AiTaskStatusDraft };
  cancellation: 'request_not_rollback' | 'task_cancelled_not_business_rollback'; remoteCancellation: 'not_attested';
  automaticRetry: false; admission: 'not_granted'; absenceSemantics: 'not_observed_is_not_proof_of_uncommitted';
} & ({ status: 'observed'; event: Extract<AiTaskEventDraft, { type: 'task.transition' }> }
  | { status: 'not_observed'; event: null });
export type AiOrderReadTakeoverReceiptDraft = {
  taskId: string; runId: string; admission: 'not_granted'; automaticRetry: false; consistency: 'revalidated_reads_not_atomic_snapshot';
  remoteCancellation: 'not_attested'; absenceSemantics: 'not_observed_is_not_proof_of_rollback';
} & ({ status: 'observed'; receiptId: string; recordedRunRevision: number; recordedFencingToken: string;
      currentGeneration: 'recorded_generation' | 'not_attested' }
  | { status: 'not_observed'; currentGeneration: 'not_attested' });
export type AiOrderReadCancelResponseDraft = { original: Original; receipt: AiModelCancellationTransitionReceiptDraft;
  cancellation: 'requested_not_rollback'; automaticRetry: false };
export type AiOrderReadSettlementResponseDraft = { original: Original; receipt: AiModelCancellationTransitionReceiptDraft;
  cancellation: 'unstarted_task_cancelled_not_business_rollback'; automaticRetry: false };
export type AiOrderReadCancelReceiptResponseDraft = { original: Original; receipt: AiOrderReadCancellationObservationDraft; automaticRetry: false };
export type AiOrderReadTakeoverReceiptResponseDraft = { original: Original; receipt: AiOrderReadTakeoverReceiptDraft; automaticRetry: false };
export type AiOrderReadSettlementReceiptResponseDraft = AiOrderReadCancelReceiptResponseDraft;
export type AiOrderReadFactsResponseDraft = Omit<AiSceneOrderFactsObservationDraft, 'original'> & { original: Original };
export type AiOrderReadModelResponseDraft = import('./ai-scene-model-observation-draft').AiSceneModelResultObservationDraft & { sceneCode: 'order_explanation' };
export type AiOrderReadSourceResponseDraft = Exclude<import('./ai-scene-model-observation-draft').AiSceneModelSourceReadResponseDraft,
  { sourceKind: 'knowledge' }> & { sourceIndex: 0 };
export type AiOrderReadSnapshotResponseDraft = import('./ai-task-draft').AiTaskSnapshotDraft & { sceneCode: 'order_explanation' };
export interface AiOrderReadHttpResponses {
  start: AiOrderReadStartResponseDraft; recover: AiOrderReadRecoverResponseDraft; resumePrepared: AiOrderReadResumeResponseDraft;
  readPreparation: AiOrderReadPreparationResponseDraft; readAnswer: AiOrderReadAnswerResponseDraft;
  readOrderResult: AiOrderReadFactsResponseDraft; readNextSteps: AiOrderNextStepsResponseDraft; readTaskScene: AiOrderReadSceneResponseDraft;
  readModelResult: AiOrderReadModelResponseDraft;
  reopenModelSource: AiOrderReadSourceResponseDraft;
  readTaskSnapshot: AiOrderReadSnapshotResponseDraft;
  takeover: AiOrderReadTakeoverResponseDraft; readTakeoverReceipt: AiOrderReadTakeoverReceiptResponseDraft;
  requestCancel: AiOrderReadCancelResponseDraft; readCancellationReceipt: AiOrderReadCancelReceiptResponseDraft;
  settleUnstartedCancellation: AiOrderReadSettlementResponseDraft; readCancellationSettlementReceipt: AiOrderReadSettlementReceiptResponseDraft;
}

const no: AiLeafSchemaDraft = { type: 'boolean', const: false }, nil: AiLeafSchemaDraft = { type: 'null' };
const original = { ...AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReceiptDraft,
  properties: { ...AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReceiptDraft.properties!, sceneCode: choice('order_explanation') } };
const execution = AI_TASK_RECOVERY_HTTP_SCHEMAS.AiSceneModelExecutionDraft.oneOf!;
const readonlyBusiness = choice('readonly_not_business_commit');
const answerFactProperties = AI_ORDER_FACTS_DRAFT_SCHEMAS.AiOrderReadFactsDraft.properties!;
const answerBase = { resultId: id(), automaticRetry: no, businessExecution: readonlyBusiness };
const wrapped = (properties: Record<string, AiLeafSchemaDraft>) => obj({ original, ...properties });
const cancellationReceipt = AI_TASK_RECOVERY_HTTP_SCHEMAS.AiSceneModelCancelResponseDraft.properties!.receipt;
const cancellationEvent = cancellationReceipt.properties!.event;
const cancellationTransition = (settled: boolean) => ({ ...cancellationReceipt,
  properties: { ...cancellationReceipt.properties!, event: { ...cancellationEvent,
    properties: { ...cancellationEvent.properties!, data: obj({ from: choice(...AI_TASK_STATUSES_DRAFT),
      to: choice(settled ? 'cancelled' : 'cancel_requested'), reason: choice(settled ? 'cancel_settled' : 'cancel_requested') }) } } } });
export const AI_ORDER_READ_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiOrderReadModelResponseDraft: { oneOf: AI_SCENE_MODEL_OBSERVATION_SCHEMAS.AiSceneModelResultObservationDraft.oneOf!
    .filter(branch => (branch.properties!.sceneCode.enum as readonly string[]).includes('order_explanation')) },
  AiOrderReadSourceResponseDraft: { ...AI_SCENE_MODEL_OBSERVATION_SCHEMAS.AiSceneModelSourceReadResponseDraft.oneOf![0],
    properties: { ...AI_SCENE_MODEL_OBSERVATION_SCHEMAS.AiSceneModelSourceReadResponseDraft.oneOf![0].properties!, sourceIndex: integer(0, 0) } },
  AiOrderReadSnapshotResponseDraft: { ...AI_TASK_OBSERVATION_DRAFT_SCHEMAS.AiTaskSnapshotDraft,
    properties: { ...AI_TASK_OBSERVATION_DRAFT_SCHEMAS.AiTaskSnapshotDraft.properties!, sceneCode: choice('order_explanation') } },
  AiOrderReadFactsResponseDraft: { ...AI_TASK_SCENE_OBSERVATION_SCHEMAS.AiSceneOrderFactsObservationDraft,
    properties: { ...AI_TASK_SCENE_OBSERVATION_SCHEMAS.AiSceneOrderFactsObservationDraft.properties!, original } },
  AiOrderReadExecutionDraft: { oneOf: [execution[0], execution[1]] },
  AiOrderReadStartResponseDraft: { oneOf: [obj({ outcome: obj({ kind: choice('not_started'), reason: choice('host_aborted') }) }),
    wrapped({ outcome: ref('AiOrderReadExecutionDraft'), businessExecution: readonlyBusiness })] },
  AiOrderReadRecoverResponseDraft: wrapped({ outcome: ref('AiOrderReadExecutionDraft'), automaticRetry: no }),
  AiOrderReadResumeResponseDraft: wrapped({ outcome: ref('AiOrderReadExecutionDraft'), automaticRetry: no,
    preparation: choice('original_inputs_only'), businessExecution: readonlyBusiness }),
  AiOrderReadTakeoverResponseDraft: wrapped({ outcome: { oneOf: [obj({ kind: choice('not_started'), reason: choice('host_aborted') }),
    obj({ kind: choice('run_outcome'), outcome: ref('AiTaskRunnerOutcomeDraft'), takeover: choice('same_owner_recovery_only'),
      automaticRetry: no, businessExecution: readonlyBusiness })] }, automaticRetry: no,
    takeover: choice('same_owner_recovery_only'), businessExecution: readonlyBusiness }),
  AiOrderReadPreparationResponseDraft: wrapped({ preparation: obj({ publishedInputs: integer(0, 3), requiredInputs: integer(2, 3),
    missing: { ...list(choice('model_request', 'order_read', 'model_answer'), 3), uniqueItems: true },
    planPublished: { type: 'boolean' }, execution: choice('not_attested') }), observation: choice('revalidated_not_atomic'), automaticRetry: no }),
  AiOrderReadAnswerResponseDraft: wrapped({ result: { oneOf: [obj({ status: choice('not_observed'), text: nil, automaticRetry: no }),
    obj({ ...answerBase, status: choice('unknown', 'failed'), text: nil }),
    obj({ ...answerBase, status: choice('stale'), text: nil, nextAction: choice('new_explicit_request') }),
    obj({ ...answerBase, status: choice('available'), text: text(131072, 0), originalReadResultId: id(), snapshotObservedAt: time,
      facts: obj(Object.fromEntries(['audience', 'scope', 'order', 'paymentEvidence', 'historicalFeeEvidence'].map(key => [key, answerFactProperties[key]]))),
      textSemantics: choice('model_text_not_core_fact') })] } }),
  AiOrderNextStepsResponseDraft: wrapped({ next: obj({ requestId: id(), scope: ref('AiWorkspaceScope'), orderId: id(), observedAt: time,
    status: choice('candidates_only'), allowedActions: choice('unavailable'),
    candidates: AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS.AiOrderExplanationMaterialDraft.properties!.payload.oneOf![0].properties!.handoff.properties!.candidates,
    manual: obj({ kind: choice('order_resource'), scope: ref('AiWorkspaceScope'), orderId: id(), navigation: choice('host_existing_order_route'),
      authorization: choice('destination_rechecks_permissions') }),
    forbiddenAutomation: { ...list(choice('refund', 'funds_disposition', 'exception_confirmation'), 3, 3), uniqueItems: true } }),
    execution: choice('not_attempted'), approval: choice('not_granted') }),
  AiOrderReadCancelResponseDraft: wrapped({ receipt: cancellationTransition(false), cancellation: choice('requested_not_rollback'), automaticRetry: no }),
  AiOrderReadSettlementResponseDraft: wrapped({ receipt: cancellationTransition(true), cancellation: choice('unstarted_task_cancelled_not_business_rollback'), automaticRetry: no }),
  AiOrderReadTakeoverReceiptResponseDraft: wrapped({ receipt: { oneOf: [
    ...['observed', 'not_observed'].map(status => obj({ taskId: id(), runId: id(), status: choice(status),
      ...(status === 'observed' ? { receiptId: id(), recordedRunRevision: integer(2, 4294967295),
        recordedFencingToken: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' } } : {}),
      currentGeneration: status === 'observed' ? choice('recorded_generation', 'not_attested') : choice('not_attested'),
      admission: choice('not_granted'), automaticRetry: no, consistency: choice('revalidated_reads_not_atomic_snapshot'),
      remoteCancellation: choice('not_attested'), absenceSemantics: choice('not_observed_is_not_proof_of_rollback') }))
  ] }, automaticRetry: no })
};
const cancelObservation = (settled: boolean) => wrapped({ receipt: { oneOf: ['observed', 'not_observed'].map(status => obj({
  taskId: id(), expectedRevision: integer(1, 4294967294), status: choice(status),
  event: status === 'observed' ? cancellationTransition(settled).properties.event : nil,
  snapshot: obj({ revision: integer(1, 4294967295), cursor: { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' }, status: choice(...AI_TASK_STATUSES_DRAFT) }),
  cancellation: choice(settled ? 'task_cancelled_not_business_rollback' : 'request_not_rollback'), remoteCancellation: choice('not_attested'),
  automaticRetry: no, admission: choice('not_granted'), absenceSemantics: choice('not_observed_is_not_proof_of_uncommitted')
})) }, automaticRetry: no });
AI_ORDER_READ_HTTP_SCHEMAS.AiOrderReadCancelReceiptResponseDraft = cancelObservation(false);
AI_ORDER_READ_HTTP_SCHEMAS.AiOrderReadSettlementReceiptResponseDraft = cancelObservation(true);
const originalScene = AI_TASK_SCENE_OBSERVATION_SCHEMAS.AiTaskSceneObservationDraft.oneOf![0];
AI_ORDER_READ_HTTP_SCHEMAS.AiOrderReadSceneResponseDraft = {
  ...originalScene, properties: { ...originalScene.properties!, handoff: ref('AiOrderNextStepsResponseDraft'), answer: ref('AiOrderReadAnswerResponseDraft') },
  required: [...originalScene.required!, 'handoff']
};

/** One operation registry for the explicit controller and OpenAPI. It does not
 * register routes or enable execution; request schemas preserve the old wire. */
export const AI_ORDER_READ_HTTP_CONTRACTS = Object.freeze({
  start: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadStartResponseDraft', write: true, unknownAction: 'read_execution' },
  recover: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadRecoverResponseDraft', write: true, unknownAction: 'read_execution' },
  resumePrepared: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadResumeResponseDraft', write: true, unknownAction: 'read_execution' },
  readPreparation: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadPreparationResponseDraft', write: false },
  readAnswer: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadAnswerResponseDraft', write: false },
  readOrderResult: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadFactsResponseDraft', write: false },
  readModelResult: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadModelResponseDraft', write: false },
  readTaskScene: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadSceneResponseDraft', write: false },
  readNextSteps: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderNextStepsResponseDraft', write: false },
  readTaskSnapshot: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadSnapshotResponseDraft', write: false },
  reopenModelSource: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadSourceResponseDraft', write: false },
  takeover: { request: 'AiSceneOrderReadTakeoverDraft', response: 'AiOrderReadTakeoverResponseDraft', write: true, unknownAction: 'read_takeover_receipt' },
  readTakeoverReceipt: { request: 'AiSceneOrderReadTakeoverDraft', response: 'AiOrderReadTakeoverReceiptResponseDraft', write: false, unknownAction: 'read_takeover_receipt' },
  requestCancel: { request: 'AiSceneOrderReadCancelDraft', response: 'AiOrderReadCancelResponseDraft', write: true, unknownAction: 'read_cancellation_receipt' },
  readCancellationReceipt: { request: 'AiSceneOrderReadCancelDraft', response: 'AiOrderReadCancelReceiptResponseDraft', write: false, unknownAction: 'read_cancellation_receipt' },
  settleUnstartedCancellation: { request: 'AiSceneOrderReadCancelDraft', response: 'AiOrderReadSettlementResponseDraft', write: true, unknownAction: 'read_cancellation_settlement_receipt' },
  readCancellationSettlementReceipt: { request: 'AiSceneOrderReadCancelDraft', response: 'AiOrderReadSettlementReceiptResponseDraft', write: false, unknownAction: 'read_cancellation_settlement_receipt' }
} as const);
