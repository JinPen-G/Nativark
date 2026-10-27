/** Closed projections of the existing task-scene aggregation. The nested
 * original readers retain their own authority and submission semantics. */
import { AI_TASK_RECOVERY_HTTP_SCHEMAS } from './ai-task-recovery-draft';
import { AI_APPROVED_SETTINGS_DRAFT_SCHEMAS } from './ai-approved-settings-draft-schemas';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id,
  leafInt as integer, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
const notRequested = obj({ availability: choice('not_requested') }), unavailable = obj({ availability: choice('unavailable') });
const nullable = (schema: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [schema, { type: 'null' }] });
const snapshot = { oneOf: [unavailable, obj({ availability: choice('available'), value: ref('AiTaskSnapshotDraft') })] };
const revision = integer(1, 4294967295), hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const observation = { consistency: choice('independent_authorized_reads'), execution: choice('read_only_no_start_no_reconnect_side_effect') };
const task = { oneOf: [obj({ original: ref('AiSceneRequestReceiptDraft'), task: ref('AiSceneTaskReceiptDraft'), recovery: notRequested }),
  obj({ original: obj({ receipt: ref('AiSceneRequestReceiptDraft'), sceneCode: choice('order_explanation', 'opening_diagnosis', 'quote_clarification'),
    sceneVersion: id(), inputRef: id(), inputRevision: revision, inputHash: hash, scope: ref('AiWorkspaceScope'), audience: choice('operator', 'staff') }),
    task: ref('AiSceneTaskReceiptDraft'), recovery: { oneOf: [ref('AiSceneRequestRecoveryDraft'),
      obj({ nextAction: choice('reconcile_request_or_explicit_create_task'), automaticExecution: { type: 'boolean', const: false } })] },
    result: obj({ status: choice('available_to_authorized_result_reader', 'not_available'), execution: choice('not_inferred_from_metadata') }),
    execution: observation.execution })] };
const orderFactBase = { taskId: id(), runId: id(), resultId: id(), observedAt: time, automaticRetry: { type: 'boolean', const: false },
  businessExecution: choice('readonly_not_business_commit') };
const orderFacts = obj({ original: ref('AiSceneRequestReceiptDraft'), taskId: id(), runId: id(), result: { oneOf: [
  obj({ ...orderFactBase, status: choice('available'), facts: ref('AiOrderReadFactsDraft'), nextAction: choice('read_only'), modelText: choice('not_used_as_business_evidence') }),
  obj({ ...orderFactBase, status: choice('stale'), facts: { type: 'null' }, nextAction: choice('reread_current_facts'), modelText: choice('not_used_as_business_evidence') }),
  obj({ ...orderFactBase, status: choice('unknown'), facts: { type: 'null' }, nextAction: choice('reconcile_original_task') }),
  obj({ ...orderFactBase, status: choice('failed'), facts: { type: 'null' }, nextAction: choice('manual_review') }),
  obj({ status: choice('unknown', 'failed', 'candidate_not_executed'), facts: { type: 'null' }, automaticRetry: { type: 'boolean', const: false },
    businessExecution: orderFactBase.businessExecution })] } });
// The existing settings family uses an untyped object helper; this view only
// describes its schema nodes, without replacing or relaxing their constraints.
const settingsSchemas = AI_APPROVED_SETTINGS_DRAFT_SCHEMAS as Readonly<Record<keyof typeof AI_APPROVED_SETTINGS_DRAFT_SCHEMAS, AiLeafSchemaDraft>>;
const settingsOperation = { oneOf: [nullable(ref('AiApprovedSettingsOperationResultDraft')),
  obj({ draftVersion: settingsSchemas.AiApprovedSettingsOperationResultDraft.oneOf![0].properties!.draftVersion,
    state: choice('committed'), receipt: ref('AiApprovedSettingsOperationReceiptDraft') })] };
const settings = { oneOf: [obj({ mode: choice('read_only'), businessOutcome: choice('unknown'), retryable: { type: 'boolean', const: false },
  nextAction: settingsSchemas.AiApprovedSettingsErrorDraft.properties!.nextAction }),
  obj({ mode: choice('read_only'), observedAt: time, scope: ref('AiWorkspaceScope'),
    task: AI_TASK_RECOVERY_HTTP_SCHEMAS.AiTaskRecoverySnapshot.properties!.task,
    run: AI_TASK_RECOVERY_HTTP_SCHEMAS.AiTaskRecoverySnapshot.properties!.run,
    step: obj({ stepId: id(), revision, status: choice('pending', 'running', 'succeeded', 'failed', 'unknown', 'cancelled'),
      effect: choice('none', 'possible', 'committed'), inputRef: nullable(id()), fingerprint: hash, resultRef: nullable(id()) }),
    current: ref('AiApprovedSettingsCurrentDraft'), change: nullable(ref('AiApprovedSettingsChangeReviewDraft')),
    currentMatchesChangeBase: { type: ['boolean', 'null'] }, preparation: ref('AiApprovedSettingsPreparationReceiptDraft'),
    review: nullable(ref('AiApprovedSettingsReviewDraft')), decision: nullable(ref('AiApprovedSettingsDecisionReceiptDraft')), operation: settingsOperation,
    confirmation: nullable(ref('AiApprovedSettingsTaskCheckpointDraft')), inputPublication: choice('published_reference'), execution: choice('not_attested'),
    workflowStatus: AI_TASK_RECOVERY_HTTP_SCHEMAS.AiTaskRecoverySnapshot.properties!.task.properties!.status,
    cancellation: choice('requested_not_rollback', 'not_requested'), businessOutcome: choice('committed', 'unknown', 'not_observed'),
    retryable: { type: 'boolean', const: false }, originalOperation: choice('original_key_read', 'persisted_original_binding_read', 'original_result_not_observed') })] };
const original = obj({ ...observation, kind: choice('original'), taskId: id(), runId: id(), originRunId: id(), task, snapshot,
  originalInput: { oneOf: [obj({ receipt: ref('AiSceneRequestReceiptDraft'), request: ref('AiSceneRequestBodyDraft') }),
    obj({ receipt: ref('AiSceneRequestReceiptDraft'), material: notRequested })] },
  pendingInput: { oneOf: [notRequested, unavailable, obj({ taskId: id(), runId: id(), input: ref('AiSceneModelPendingInputDraft'), execution: observation.execution })] },
  model: { oneOf: [notRequested, ref('AiSceneModelResultObservationDraft')] },
  review: { oneOf: [notRequested, obj({ taskId: id(), review: ref('AiApprovalApplicationReviewDraft'), order: choice('not_created_by_read') })] },
  decision: { oneOf: [notRequested, obj({ taskId: id(), receipt: ref('AiApprovalApplicationReceiptDraft'), order: choice('not_created_by_read') })] },
  business: { oneOf: [notRequested, obj({ taskId: id(), runId: id(), result: ref('AiSelectedQuoteTaskResultDraft'), execution: observation.execution })] },
  orderFacts: { oneOf: [notRequested, ref('AiSceneOrderFactsObservationDraft')] }, submission: choice('not_attested_by_approval') });
original.required = original.required!.filter(key => key !== 'orderFacts');
export const AI_TASK_SCENE_OBSERVATION_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiSceneOrderFactsObservationDraft: orderFacts,
  AiSettingsBusinessObservationDraft: settings,
  AiTaskSceneObservationDraft: { oneOf: [original,
    obj({ ...observation, kind: choice('settings'), taskId: id(), runId: id(), business: settings, snapshot,
      originalInput: obj({ inputRef: nullable(id()), fingerprint: hash, change: nullable(ref('AiApprovedSettingsChangeReviewDraft')) }),
      submission: choice('not_attested_by_approval') }, ['consistency', 'execution', 'kind', 'taskId', 'runId', 'business', 'snapshot'])] }
};
