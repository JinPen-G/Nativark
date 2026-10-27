import { AI_APPROVED_SETTINGS_DRAFT_VERSION, AI_APPROVED_SETTINGS_TOOL_CODE } from './ai-approved-settings-draft';
import { AI_PROPOSAL_DRAFT_VERSION } from './ai-proposal-draft';
import { AI_TOOL_DRAFT_VERSION } from './ai-native';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_TASK_TRANSITION_REASONS_DRAFT } from './ai-task-draft';

const id = (maxLength = 191) => ({ type: 'string', minLength: 1, maxLength, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revision = { type: 'integer', minimum: 1, maximum: 4294967294 };
const time = { type: 'string', format: 'date-time' };
const literal = (value: unknown) => ({ const: value });
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const draftVersion = literal(AI_APPROVED_SETTINGS_DRAFT_VERSION);
const base = { draftVersion, taskId: id(36), proposalId: id(36), proposalRevision: revision };
const reference = { ...base, reviewedPayloadHash: hash };
const stringArray = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 191 }, maxItems: 64, uniqueItems: true };
const channels = { type: 'array', items: { enum: ['sms', 'app_push', 'wechat', 'email'] }, minItems: 1, maxItems: 4, uniqueItems: true };
const snapshot = object({ recordId: id(36), revision: literal(1), contentHash: hash });
const taskRevision = { type: 'integer', minimum: 1, maximum: 4294967295 };
const createdTask = object({ taskId: id(36), runId: id(36), status: { enum: AI_TASK_STATUSES_DRAFT },
  revision: taskRevision, replayed: { type: 'boolean' } });
const creationBase = { original: object({ changeId: id(36), changeHash: hash }),
  execution: literal('not_attested'), approval: literal('not_granted') };
const cancelBase = { cancellation: literal('not_business_rollback'), automaticRetry: literal(false), financialRelease: literal('not_performed') };
const cursor = { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' };
const cancelEvent = object({ contractVersion: literal(AI_TASK_DRAFT_VERSION), taskId: id(36),
  type: literal('task.transition'), cursor: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' },
  taskRevision, occurredAt: time, data: object({ from: { enum: AI_TASK_STATUSES_DRAFT },
    to: { enum: ['cancel_requested', 'cancelled'] }, reason: { enum: AI_TASK_TRANSITION_REASONS_DRAFT } }) });
const cancelObservation = { taskId: id(36), expectedRevision: taskRevision,
  snapshot: object({ revision: taskRevision, cursor, status: { enum: AI_TASK_STATUSES_DRAFT } }),
  cancellation: { enum: ['request_not_rollback', 'task_cancelled_not_business_rollback'] },
  remoteCancellation: literal('not_attested'), automaticRetry: literal(false), admission: literal('not_granted'),
  absenceSemantics: literal('not_observed_is_not_proof_of_uncommitted') };

export const AI_APPROVED_SETTINGS_DRAFT_SCHEMAS = {
  AiApprovedSettingsCurrentReadDraft: object({}),
  AiApprovedSettingsChangePrepareDraft: object({ changeKey: id(128), baseRevision: revision, expiresAt: time,
    notifications: object({ enabledEvents: stringArray, editableChannels: channels }) }),
  AiApprovedSettingsChangeReceiptReadDraft: object({ changeKey: id(128) }),
  AiApprovedSettingsCurrentDraft: object({ settingsRevision: { type: 'integer', minimum: 1, maximum: 4294967295 },
    notifications: object({ enabledEvents: stringArray, editableChannels: channels }) }),
  AiApprovedSettingsChangePreparationResultDraft: object({ change: ref('AiApprovedSettingsChangeReviewDraft'),
    task: literal('not_created'), approval: literal('not_granted'), activeSettings: literal('not_modified') }),
  AiApprovedSettingsChangeReceiptDraft: { oneOf: [
    object({ state: literal('prepared_not_approved'), change: ref('AiApprovedSettingsChangeReviewDraft') }),
    object({ state: literal('not_observed'), nextAction: literal('read_change_receipt') })] },
  AiApprovedSettingsTaskCreationDraft: object({ creationKey: id(128), changeKey: id(128) }),
  AiApprovedSettingsTaskCreatedDraft: object({ ...creationBase, receipt: createdTask }),
  AiApprovedSettingsTaskCreationReadDraft: object({ ...creationBase, receipt: { oneOf: [
    object({ state: literal('observed'), creationKey: id(128), retryable: literal(false), nextAction: literal('read_original_task'), task: createdTask }),
    object({ state: { enum: ['unknown', 'not_observed'] }, creationKey: id(128), retryable: literal(false), nextAction: literal('reconcile'), task: { type: 'null' } })] } }),
  AiApprovedSettingsTaskCancellationResultDraft: object({ ...cancelBase, receipt: {
    ...object({ event: cancelEvent, runRevision: { anyOf: [taskRevision, { type: 'null' }] } }), required: ['event'] } }),
  AiApprovedSettingsTaskCancellationReadDraft: object({ ...cancelBase, receipt: { oneOf: [
    object({ ...cancelObservation, status: literal('observed'), event: cancelEvent }),
    object({ ...cancelObservation, status: literal('not_observed'), event: { type: 'null' } })] } }),
  AiApprovedSettingsTaskRunDraft: { oneOf: [
    object({ kind: literal('not_started'), reason: { enum: ['host_aborted', 'plan_unavailable', 'task_not_runnable',
      'lease_held', 'recovery_lease_unavailable', 'confirmation_lease_unavailable'] } }),
    object({ kind: literal('run_outcome'), outcome: ref('AiTaskRunnerOutcomeDraft') })] },
  AiApprovedSettingsTaskRunRequestDraft: object({ taskId: id(36), runId: id(36) }),
  AiApprovedSettingsTaskCheckpointReadDraft: object({ taskId: id(36), runId: id(36), stepId: id(36) }),
  AiApprovedSettingsTaskContinueDraft: object({ taskId: id(36), runId: id(36), checkpointRef: id(36) }),
  AiApprovedSettingsTaskCancelDraft: object({ taskId: id(36), expectedRevision: revision }),
  AiApprovedSettingsTaskCheckpointDraft: object({ taskId: id(36), runId: id(36), stepId: id(36), taskRevision,
    checkpointRef: id(36), proposal: object({ contractVersion: literal(AI_PROPOSAL_DRAFT_VERSION),
      proposalId: id(36), proposalRevision: revision, reviewedPayloadHash: hash }), execution: literal('not_attested') }),
  AiApprovedSettingsTaskRecoveryDraft: { oneOf: [ref('AiApprovedSettingsTaskRunDraft'),
    object({ mode: literal('read_only'), snapshot: ref('AiTaskRecoverySnapshot'), retryable: literal(false),
      execution: literal('original_result_read_no_restart'), operation: object({ state: literal('committed'),
        receipt: ref('AiApprovedSettingsOperationReceiptDraft') }), businessOutcome: literal('committed') }),
    object({ mode: literal('read_only'), snapshot: ref('AiTaskRecoverySnapshot'), retryable: literal(false),
      execution: literal('original_result_read_no_restart'), operation: { type: 'null' },
      businessOutcome: { enum: ['unknown', 'not_observed'] } })] },
  AiApprovedSettingsTaskCancelResponseDraft: object({ receipt: object({ event: cancelEvent, runRevision: { type: 'null' } }),
    cancellation: literal('requested_not_rollback'), reconciliation: { oneOf: [ref('AiApprovedSettingsTaskRecoveryDraft'),
      object({ kind: literal('unavailable'), errorCode: { enum: ['AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE',
        'AI_REVISION_CONFLICT', 'AI_STORAGE_UNAVAILABLE'] }, nextAction: literal('read_original_task'), retryable: literal(false) })] } }),
  AiApprovedSettingsTaskEventsReadDraft: object({ creationKey: id(128), changeKey: id(128),
    after: { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }),
  AiApprovedSettingsTaskResultDraft: { oneOf: [
    object({ snapshot: ref('AiTaskRecoverySnapshot'), operation: ref('AiApprovedSettingsOperationReceiptDraft'),
      businessOutcome: literal('committed'), originalOperation: literal('original_task_step_key_read'),
      execution: literal('not_invoked'), automaticRetry: literal(false) }),
    object({ snapshot: ref('AiTaskRecoverySnapshot'), operation: { type: 'null' },
      businessOutcome: { enum: ['unknown', 'not_observed'] },
      originalOperation: { enum: ['original_task_step_key_read', 'no_registered_step'] },
      execution: literal('not_invoked'), automaticRetry: literal(false) })] },
  AiApprovedSettingsTaskConfirmationReadDraft: { oneOf: [
    object({ state: literal('not_waiting'), snapshot: ref('AiTaskSnapshotDraft'),
      history: { oneOf: [ref('AiTaskConfirmationHistoryDraft'), { type: 'null' }] },
      execution: literal('not_attested'), continuation: literal('not_invoked') }),
    object({ state: literal('waiting_confirmation'), checkpoint: ref('AiApprovedSettingsTaskCheckpointDraft'),
      reference: ref('AiApprovedSettingsReferenceDraft'), review: ref('AiApprovedSettingsReviewDraft'),
      decision: ref('AiApprovedSettingsDecisionReceiptDraft'),
      execution: literal('not_attested'), continuation: literal('not_invoked') })] },
  AiApprovedSettingsTaskEventsDraft: { oneOf: [ref('AiTaskEventPageDraft'), ref('AiTaskEventResetDraft')] },
  AiApprovedSettingsTaskCancellationDraft: object({ creationKey: id(128), changeKey: id(128),
    expectedRevision: { type: 'integer', minimum: 1, maximum: 4294967293 } }),
  AiApprovedSettingsTaskPolicyReadDraft: object({ creationKey: id(128), changeKey: id(128), operation: id() }),
  AiApprovedSettingsTaskPolicyConfigureDraft: object({ creationKey: id(128), changeKey: id(128), operation: id(),
    expectedRevision: { anyOf: [revision, { type: 'null' }] } }),
  AiApprovedSettingsTaskPolicyClearDraft: object({ creationKey: id(128), changeKey: id(128), operation: id(),
    expectedRevision: { type: 'integer', minimum: 1, maximum: 4294967293 } }),
  AiApprovedSettingsTaskPolicyOperationReadDraft: { oneOf: [
    object({ creationKey: id(128), changeKey: id(128), operation: id(), mutation: literal('configure'),
      expectedRevision: { anyOf: [{ type: 'integer', minimum: 1, maximum: 4294967293 }, { type: 'null' }] } }),
    object({ creationKey: id(128), changeKey: id(128), operation: id(), mutation: literal('clear'),
      expectedRevision: { type: 'integer', minimum: 1, maximum: 4294967293 } })] },
  AiApprovedSettingsTaskPolicyValueDraft: object({ taskId: id(36), operation: id(), revision,
    requiredPermissions: { ...stringArray, minItems: 1 }, expiresAt: time }),
  AiApprovedSettingsTaskPolicyMutationDraft: object({ receipt: ref('AiApprovedSettingsTaskPolicyValueDraft'),
    semantics: literal('policy_not_approval_or_dispatch') }),
  AiApprovedSettingsTaskPolicyReadResultDraft: object({ semantics: literal('policy_not_approval_or_dispatch'), receipt: { oneOf: [
    object({ state: literal('observed'), policy: ref('AiApprovedSettingsTaskPolicyValueDraft'), retryable: literal(false), nextAction: literal('read_original_policy') }),
    object({ state: literal('not_observed'), retryable: literal(false), nextAction: literal('reconcile') })] } }),
  AiApprovedSettingsTaskPolicyOperationDraft: object({ mutation: { enum: ['configure', 'clear'] },
    expectedRevision: { anyOf: [{ type: 'integer', minimum: 1, maximum: 4294967293 }, { type: 'null' }] },
    receipt: { oneOf: [object({ state: literal('recorded'), policy: ref('AiApprovedSettingsTaskPolicyValueDraft'), retryable: literal(false) }),
      object({ state: literal('not_observed'), policy: { type: 'null' }, retryable: literal(false) })] },
    semantics: literal('original_policy_mutation_not_current_permission') }),
  AiApprovedSettingsReferenceDraft: object(reference),
  AiApprovedSettingsPrepareDraft: object({ ...base, runId: id(36), stepId: id(36), changeId: id(36), changeHash: hash }),
  AiApprovedSettingsPreparationReceiptDraft: { oneOf: [object({ draftVersion, state: literal('prepared'), reference: ref('AiApprovedSettingsReferenceDraft') }),
    object({ draftVersion, state: literal('not_observed'), nextAction: literal('read_preparation_receipt') })] },
  AiApprovedSettingsDecisionDraft: object({ ...reference, decision: { enum: ['approve', 'reject'] } }),
  AiApprovedSettingsCommitDraft: object({ ...reference, operationKey: id(), approvalId: id(36) }),
  AiApprovedSettingsReadOperationDraft: object({ draftVersion, operationKey: id() }),
  AiApprovedSettingsPayloadDraft: object({ contractVersion: literal(AI_PROPOSAL_DRAFT_VERSION), proposalId: id(36), taskId: id(36), revision,
    audience: { enum: ['operator', 'staff'] }, scope: object({ kind: literal('workspace'), tenantId: id(), workspaceId: id() }),
    actions: { type: 'array', minItems: 1, maxItems: 1, items: object({ actionId: id(), toolCode: literal(AI_APPROVED_SETTINGS_TOOL_CODE),
      toolVersion: literal(AI_TOOL_DRAFT_VERSION), input: snapshot, preview: snapshot,
      target: object({ resourceType: literal('configuration'), resourceId: id(), version: { type: 'string', pattern: '^[1-9][0-9]*$' } }) }) },
    atomicity: literal('single_action'), failurePolicy: literal('stop_and_reconcile'), expiresAt: time }),
  AiApprovedSettingsChangeReviewDraft: object({ changeId: id(36), changeHash: hash, baseRevision: revision, expiresAt: time,
    diff: object({ 'notifications.enabledEvents': object({ before: stringArray, after: stringArray }),
      'notifications.editableChannels': object({ before: channels, after: channels }) }) }),
  AiApprovedSettingsReviewDraft: object({ draftVersion, proposal: object({ payload: ref('AiApprovedSettingsPayloadDraft'), payloadHash: hash,
    status: { enum: ['pending_confirmation', 'confirmed', 'superseded', 'cancelled', 'expired'] } }), change: ref('AiApprovedSettingsChangeReviewDraft'), generatedText: { type: 'null' } }),
  AiApprovedSettingsOperationReceiptDraft: object({ receiptId: id(36), operationKey: id(), changeId: id(36), changeHash: hash,
    baseRevision: revision, resultRevision: { type: 'integer', minimum: 2, maximum: 4294967295 }, resultHash: hash, committedAt: time }),
  AiApprovedSettingsOperationResultDraft: { oneOf: [object({ draftVersion, state: literal('committed'), receipt: ref('AiApprovedSettingsOperationReceiptDraft'), cacheRefreshed: { type: 'boolean' } }),
    object({ draftVersion, state: literal('not_observed'), nextAction: literal('read_operation') })] },
  AiApprovedSettingsDecisionReceiptDraft: { oneOf: [object({ draftVersion, state: literal('recorded'), approval: ref('AiApprovalRecordDraft') }),
    object({ draftVersion, state: literal('not_observed'), nextAction: literal('read_decision_receipt') })] },
  AiApprovedSettingsErrorDraft: object({ draftVersion, code: { enum: ['AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_REVISION_CONFLICT', 'AI_RESOURCE_UNAVAILABLE', 'AI_RESULT_UNKNOWN', 'SETTINGS_RESULT_UNKNOWN'] },
    retryable: literal(false), nextAction: { enum: ['read_preparation_receipt', 'read_decision_receipt', 'read_change_receipt', 'read_task_input', 'read_operation', 'revalidate_or_manual'] } })
} as const;
