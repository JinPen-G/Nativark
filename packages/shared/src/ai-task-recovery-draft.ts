import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT,
  type AiTaskEventDraft, type AiTaskStatusDraft, type AiStepStatusDraft } from './ai-task-draft';
import type { AiSceneRequestReadDraft, AiSceneRequestReceiptDraft } from './ai-scene-request-draft';
import { AI_ERROR_CODES, type AiErrorCode } from './ai-native';
import type { AiTaskInputContractDraft, AiTaskInputSavedReceiptDraft, AiTaskInputReceiptObservationDraft } from './ai-task-input-draft';
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, leafTime, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_TASK_RECOVERY_READ_VERSION = 'ain-task-recovery-read-1' as const;
/** Existing task-resource units, not monetary/provider usage. */
export type AiTaskResourceKindDraft = 'steps' | 'calls' | 'active_ms' | 'output_bytes';

/** Canonical persisted observation. Decimal strings preserve counters; null is
 * absent evidence, never zero. No raw tool/model payload, credentials or lease.
 * Artifact measurement, business effect and task completion are separate facts.
 * Originally the runner's internal projection; kept as one shared type. */
export interface AiTaskRecoverySnapshot {
  task: { taskId: string; revision: number; status: AiTaskStatusDraft; cancelRequestedAt: string | null; eventCursor: string };
  run: { runId: string; revision: number; status: string; fencingToken: string };
  plan: { planHash: string; policyVersion: string } | null;
  steps: readonly {
    stepId: string; sequence: number; revision: number; actionId: string; fingerprint: string;
    toolCode: string; toolVersion: string; status: AiStepStatusDraft; effect: 'none' | 'possible' | 'committed';
    inputRef: string | null; resultRef: string | null; errorCode: string | null;
    artifacts: readonly { resultRef: string; outcome: AiStepStatusDraft; completeMeasurement: boolean;
      contentHash: string; outputBytes: string; activeMs: string; fencingToken: string }[];
    charges: readonly { chargeId: string; resource: AiTaskResourceKindDraft; status: 'reserved' | 'recorded' | 'unknown';
      amount: string; actualAmount: string | null; evidenceRef: string | null; gatewayInvocationId: string | null }[];
  }[];
  /** Task-wide cumulative counters, not a sum of just this run's steps. */
  resources: { revision: number; policyVersion: string;
    counters: Record<AiTaskResourceKindDraft, { limit: string; reserved: string; consumed: string }> } | null;
}
export interface AiSceneModelRecoverySnapshotReadResponse {
  contractVersion: typeof AI_TASK_RECOVERY_READ_VERSION;
  original: AiSceneRequestReadDraft;
  snapshot: AiTaskRecoverySnapshot;
  execution: 'read_only_no_lease_or_dispatch';
  resources: 'task_cumulative_not_new_allowance';
}

/** Wire outcome of the existing runner, not a second state machine. Unknown
 * never implies permission to retry or release the original reservation. */
export type AiTaskRunnerOutcomeDraft =
  | { status: 'succeeded' | 'partially_succeeded' | 'paused' | 'cancel_requested' | 'cancelled' | 'unknown'; completedSteps: number; cleanupFailed: number }
  | { status: 'unavailable'; completedSteps: number; cleanupFailed: number;
      stopReason?: 'input_limit_reached'; nextAction?: 'manual_handoff' }
  | { status: 'failed'; completedSteps: number; cleanupFailed: number; errorCode: string };
export type AiSceneModelExecutionDraft =
  | { kind: 'not_started'; reason: 'host_aborted' | 'plan_unavailable' | 'task_not_runnable' | 'lease_held' | 'recovery_lease_unavailable' }
  | { kind: 'run_outcome'; outcome: AiTaskRunnerOutcomeDraft }
  | { kind: 'run_outcome'; outcome: AiTaskRunnerOutcomeDraft;
      takeover: 'same_owner_recovery_only'; businessExecution: 'not_inferred_from_model_result' };
export interface AiSceneModelStartResponseDraft {
  original: AiSceneRequestReceiptDraft;
  taskId: string;
  runId: string;
  execution: AiSceneModelExecutionDraft;
  businessExecution: 'not_inferred_from_model_result';
}
export type AiModelCancellationTransitionReceiptDraft = {
  event: Extract<AiTaskEventDraft, { type: 'task.transition' }>;
  runRevision: null;
};
export type AiSceneModelReconcileResponseDraft = AiSceneModelExecutionDraft
  | { kind: 'cancellation_settled'; receipt: AiModelCancellationTransitionReceiptDraft };
export interface AiSceneModelCancelResponseDraft {
  receipt: AiModelCancellationTransitionReceiptDraft;
  cancellation: 'requested_not_rollback';
  settlement: AiModelCancellationTransitionReceiptDraft | null;
}

export type AiSceneModelPendingInputDraft = null | {
  requestId: string; revision: number; expiresAt: string; contract: AiTaskInputContractDraft;
};
export interface AiSceneModelSubmitAnswerResponseDraft {
  receipt: AiTaskInputSavedReceiptDraft;
  continuation: { kind: 'not_started'; reason: 'answer_saved_without_execution' };
  orderApproval: 'not_granted';
}
export interface AiSceneModelResumeResponseDraft {
  receipt: AiTaskInputSavedReceiptDraft;
  continuation: AiSceneModelExecutionDraft | { kind: 'not_started'; reason: 'receipt_replayed' }
    | { kind: 'unavailable'; errorCode: AiErrorCode | 'AI_RESOURCE_UNAVAILABLE' | 'AI_REVISION_CONFLICT' | 'AI_STORAGE_UNAVAILABLE' | 'AI_RUN_LIMIT' };
}
export type AiSceneModelContinueAnswerResponseDraft =
  | { receipt: Extract<AiTaskInputReceiptObservationDraft, { state: 'not_observed' }>; continuation: 'unavailable' }
  | { receipt: Extract<AiTaskInputReceiptObservationDraft, { state: 'observed' }>;
      execution: AiSceneModelExecutionDraft; businessExecution: 'not_inferred_from_model_result' };

// Decimal strings deliberately stay strings: no Number conversion or totals
// inferred from a partial run. Limits mirror the existing bounded repository.
const uint64: AiLeafSchemaDraft = { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' };
const nullable = (schema: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [schema, { type: 'null' }] });
const revision = integer(1, 4294967295);
const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const ref = (name: string): AiLeafSchemaDraft => ({ $ref: `#/components/schemas/${name}` });
const inputId: AiLeafSchemaDraft = { ...id(), maxLength: 36 };
const counters = object({ limit: uint64, reserved: uint64, consumed: uint64 });
const outcomeBase = { completedSteps: integer(0, 4294967295), cleanupFailed: integer(0, 4294967295) };
const cancellationReceipt = (to: 'cancel_requested' | 'cancelled', reason: 'cancel_requested' | 'cancel_settled') => object({
  event: object({ contractVersion: choice(AI_TASK_DRAFT_VERSION), taskId: id(), cursor: uint64, taskRevision: revision,
    occurredAt: leafTime, type: choice('task.transition'),
    data: object({ from: choice(...AI_TASK_STATUSES_DRAFT), to: choice(to), reason: choice(reason) }) }),
  runRevision: { type: 'null' }
});

export const AI_TASK_RECOVERY_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiSceneModelPendingInputDraft: nullable(object({ requestId: inputId, revision: integer(1, 4294967294),
    expiresAt: leafTime, contract: ref('AiTaskInputContractDraft') })),
  AiSceneModelSubmitAnswerResponseDraft: object({ receipt: ref('AiTaskInputSavedReceiptDraft'),
    continuation: object({ kind: choice('not_started'), reason: choice('answer_saved_without_execution') }),
    orderApproval: choice('not_granted') }),
  AiSceneModelResumeResponseDraft: object({ receipt: ref('AiTaskInputSavedReceiptDraft'), continuation: { oneOf: [
    ref('AiSceneModelExecutionDraft'), object({ kind: choice('not_started'), reason: choice('receipt_replayed') }),
    object({ kind: choice('unavailable'), errorCode: choice(...AI_ERROR_CODES,
      'AI_RESOURCE_UNAVAILABLE', 'AI_REVISION_CONFLICT', 'AI_STORAGE_UNAVAILABLE', 'AI_RUN_LIMIT') })] } }),
  AiSceneModelContinueAnswerResponseDraft: { oneOf: [
    object({ receipt: object({ state: choice('not_observed'), retryable: { type: 'boolean', const: false } }), continuation: choice('unavailable') }),
    object({ receipt: object({ state: choice('observed'), retryable: { type: 'boolean', const: false },
      taskId: inputId, requestId: inputId, receiptId: inputId, taskRevision: integer(1, 4294967294), runId: inputId,
      execution: choice('not_inferred_from_receipt') }), execution: ref('AiSceneModelExecutionDraft'),
      businessExecution: choice('not_inferred_from_model_result') })] },
  AiTaskRecoverySnapshot: object({
    task: object({ taskId: id(), revision, status: choice(...AI_TASK_STATUSES_DRAFT),
      cancelRequestedAt: nullable(leafTime), eventCursor: uint64 }),
    run: object({ runId: id(), revision, status: id(), fencingToken: uint64 }),
    plan: nullable(object({ planHash: hash, policyVersion: id() })),
    steps: list(object({ stepId: id(), sequence: integer(0, 4294967295), revision, actionId: id(), fingerprint: hash,
      toolCode: id(), toolVersion: id(), status: choice(...AI_STEP_STATUSES_DRAFT), effect: choice('none', 'possible', 'committed'),
      inputRef: nullable(id()), resultRef: nullable(id()), errorCode: nullable(id()),
      artifacts: list(object({ resultRef: id(), outcome: choice(...AI_STEP_STATUSES_DRAFT), completeMeasurement: { type: 'boolean' },
        contentHash: hash, outputBytes: uint64, activeMs: uint64, fencingToken: uint64 }), 2000),
      charges: list(object({ chargeId: id(), resource: choice('steps', 'calls', 'active_ms', 'output_bytes'),
        status: choice('reserved', 'recorded', 'unknown'), amount: uint64, actualAmount: nullable(uint64),
        evidenceRef: nullable(id()), gatewayInvocationId: nullable(id()) }), 4000)
    }), 1000),
    resources: nullable(object({ revision, policyVersion: id(), counters: object({
      steps: counters, calls: counters, active_ms: counters, output_bytes: counters
    }) }))
  }),
  AiTaskRunnerOutcomeDraft: { oneOf: [
    object({ ...outcomeBase, status: choice('succeeded', 'partially_succeeded', 'paused', 'cancel_requested', 'cancelled', 'unknown') }),
    object({ ...outcomeBase, status: choice('unavailable'), stopReason: choice('input_limit_reached'), nextAction: choice('manual_handoff') },
      ['status', 'completedSteps', 'cleanupFailed']),
    object({ ...outcomeBase, status: choice('failed'), errorCode: id() })
  ] },
  AiSceneModelExecutionDraft: { oneOf: [
    object({ kind: choice('not_started'), reason: choice('host_aborted', 'plan_unavailable', 'task_not_runnable', 'lease_held', 'recovery_lease_unavailable') }),
    object({ kind: choice('run_outcome'), outcome: ref('AiTaskRunnerOutcomeDraft') }),
    object({ kind: choice('run_outcome'), outcome: ref('AiTaskRunnerOutcomeDraft'),
      takeover: choice('same_owner_recovery_only'), businessExecution: choice('not_inferred_from_model_result') })
  ] },
  AiSceneModelStartResponseDraft: object({ original: ref('AiSceneRequestReceiptDraft'), taskId: id(), runId: id(),
    execution: ref('AiSceneModelExecutionDraft'), businessExecution: choice('not_inferred_from_model_result') }),
  AiSceneModelReconcileResponseDraft: { oneOf: [ref('AiSceneModelExecutionDraft'),
    object({ kind: choice('cancellation_settled'), receipt: cancellationReceipt('cancelled', 'cancel_settled') })] },
  AiSceneModelCancelResponseDraft: object({ receipt: cancellationReceipt('cancel_requested', 'cancel_requested'),
    cancellation: choice('requested_not_rollback'), settlement: nullable(cancellationReceipt('cancelled', 'cancel_settled')) }),
  AiSceneModelRecoverySnapshotReadResponse: object({ contractVersion: choice(AI_TASK_RECOVERY_READ_VERSION),
    original: ref('AiSceneRequestReadDraft'), snapshot: ref('AiTaskRecoverySnapshot'),
    execution: choice('read_only_no_lease_or_dispatch'), resources: choice('task_cumulative_not_new_allowance') })
};
