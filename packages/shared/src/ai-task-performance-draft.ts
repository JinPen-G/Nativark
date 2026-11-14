/** Persisted observations, not an SLO verdict, provider bill or execution grant. */
import type { AiTaskBudgetUsagePageDraft, AiTaskBudgetUsageSummaryDraft } from './ai-scene-request-draft';
import { AI_TASK_STATUSES_DRAFT, type AiTaskStatusDraft } from './ai-task-draft';
import { validateAiLeafSchemaValue } from './ai-leaf-schema-validation';
import { leafClosed as object, leafEnum as choice, leafId as identifier, leafInt as integer, leafList as list,
  leafText as text, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export type AiTaskPerformanceObservationDraft = {
  version: 'task-performance-1'; observedAt: string;
  task: { taskId: string; sceneCode: string; sceneVersion: string; status: string; revision: number;
    createdAt: string; lastChangedAt: string; cancelRequestedAt: string | null };
  timing: { ageMs: string; firstRecordedStartAt: string | null; terminalEndedAt: string | null; endToEndMs: string | null };
  resources: { state: 'not_recorded' } | { state: 'recorded'; revision: number; policyVersion: string;
    counters: Array<{ resource: 'steps' | 'calls' | 'active_ms' | 'output_bytes'; limit: string;
      consumed: string; reservedAndUnknown: string; remaining: string; exhausted: boolean }> };
  runs: { items: Array<{ runId: string; sequence: number; status: string; startedAt: string | null;
    endedAt: string | null; elapsedMs: string | null }>; truncated: boolean; coverage: 'bounded_window' };
  steps: { items: Array<{ stepId: string; runId: string; sequence: number; toolCode: string; toolVersion: string;
    status: string; effect: string; revision: number;
    activeTime: { state: 'not_recorded' } | { state: 'recorded'; recordedMs: string | null; reservedMs: string;
      unknownMs: string; basis: 'persistent_resource_not_provider_latency' } }>; truncated: boolean; coverage: 'bounded_window' };
  financial: AiTaskBudgetUsagePageDraft;
  taskFinancial?: AiTaskBudgetUsageSummaryDraft;
  modelDelivery: { items: Array<{ invocationId: string; runId: string; stepId: string; callId: string; mode: 'invoke' | 'stream';
    transportWallMs: string; firstValidatedTextMs: string | null; basis: 'gateway_transport_including_usage_and_consumer_wait' }>;
    unobservedInWindow: number; truncated: boolean; coverage: 'completed_gateway_observations_only' };
  budgetAdmission?: { denials: Array<{ invocationId: string; runId: string; stepId: string; callId: string;
    observedAt: string; code: 'budget_unavailable'; observation: 'gate_rejected_not_release_evidence' }>;
    truncated: boolean; coverage: 'recorded_rejections_only' };
  clientVisible?: AiTaskClientVisibleObservationDraft;
  lifecycle?: AiTaskLifecycleObservationDraft;
  measurements: { firstToken: 'not_recorded' | 'client_reported'; firstCard: 'not_recorded' | 'client_reported'; toolLatency: 'not_recorded' | 'resource_active_time_only';
    modelLatency: 'not_recorded' | 'gateway_transport_wall_time_only';
    rates: 'not_computed'; slo: 'not_evaluated' };
  consistency: 'revalidated_reads_not_atomic_snapshot'; execution: 'read_only_no_dispatch_or_release';
};

/** One explicitly selected, authorized scene/version sample. Unfinished tasks
 * keep the final success rate pending. Takeovers mean original recorded human
 * recovery receipts, not suggestions, worker expiry or business completion. */
export interface AiTaskOutcomeSampleDraft {
  version: 'task-outcome-sample-1'; observedAt: string; sceneCode: string; sceneVersion: string;
  taskIds: string[]; sampleSize: number; statusCounts: Record<AiTaskStatusDraft, number>;
  successRate: { state: 'recorded' | 'pending'; succeeded: number; terminal: number; total: number; percent: string | null };
  takeoverRate: { tasksWithReceipt: number; total: number; percent: string; basis: 'original_same_owner_takeover_receipts' };
  lifecycleRates?: AiTaskLifecycleSampleRatesDraft;
  coverage: 'requested_authorized_one_owner_workspace_scene_version';
  consistency: 'revalidated_reads_not_atomic_snapshot'; slo: 'not_evaluated'; execution: 'read_only_no_lease_or_model';
}

/** Original requested cancellation and fenced recovery evidence. Completion
 * means only the recorded lifecycle; it cannot grant a refund or retry. */
export interface AiTaskLifecycleObservationDraft {
  version: 'task-lifecycle-1';
  cancellation: { state: 'not_recorded' | 'pending' | 'recorded'; requestRevision: number | null;
    settlementRevision: number | null; requestedAt: string | null; settledAt: string | null; elapsedMs: string | null;
    outcome: 'succeeded' | 'partially_succeeded' | 'cancelled' | null; semantics: 'request_settlement_not_business_rollback' };
  recovery: { state: 'not_recorded' | 'observed'; items: Array<{ runId: string; fencingToken: string;
    origin: 'takeover_receipt' | 'recovery_run_interval'; referenceId: string; state: 'pending' | 'recorded';
    startedAt: string | null; completedAt: string | null; elapsedMs: string | null;
    outcome: 'succeeded' | 'partially_succeeded' | 'failed' | 'cancelled' | null }>;
    truncated: boolean; coverage: 'original_fenced_recovery_generations' };
  consistency: 'revalidated_reads_not_atomic_snapshot'; execution: 'read_only_no_lease_model_dispatch_or_release';
}
/** A selected authorized sample only, never a tenant-wide or SLO result.
 * Pending or truncated evidence keeps the affected percentage null. */
export interface AiTaskLifecycleSampleRatesDraft {
  version: 'task-lifecycle-rates-1';
  cancellation: { state: 'not_recorded' | 'pending' | 'recorded'; requested: number; recorded: number;
    pending: number; notRecordedTasks: number; percent: string | null;
    basis: 'original_request_settlement_not_business_rollback' };
  recovery: { state: 'not_recorded' | 'pending' | 'recorded'; attempts: number; recorded: number;
    pending: number; succeeded: number; notRecordedTasks: number; truncated: boolean; percent: string | null;
    basis: 'original_fenced_recovery_terminal_evidence' };
}

/** Browser-reported original host observations only. They grant no business,
 * model, accounting or SLO authority and never contain rendered content. */
export type AiTaskClientVisibleSourceDraft = { kind: 'model_result'; resultId: string }
  | { kind: 'approval_card'; stepId: string; proposalId: string; proposalRevision: number };
export interface AiTaskClientVisibleReportDraft {
  version: 'client-visible-1'; observationId: string; documentId: string;
  taskId: string; runId: string; surface: 'task_center' | 'server_conversation';
  kind: 'text' | 'card'; source: AiTaskClientVisibleSourceDraft;
  trigger: 'original_model_start' | 'original_input_resume' | 'original_model_control'; originKey: string;
  conversationId?: string; turnId?: string;
  clientEpoch: number; elapsedMs: number; viewport: 'compact_viewport' | 'wide_viewport';
  sampleSize: 1; basis: 'viewport_intersection_after_two_frames'; provenance: 'client_reported_not_business_fact';
}
export interface AiTaskClientVisibleReceiptDraft {
  version: 'client-visible-1'; observationId: string; taskId: string; runId: string; kind: 'text' | 'card';
  status: 'recorded'; recordedAt: string; provenance: 'client_reported_not_business_fact';
  effects: 'no_authorization_execution_accounting_or_slo';
}
export type AiTaskClientVisibleObservationDraft = { state: 'not_recorded' } | {
  state: 'client_reported'; observations: Array<AiTaskClientVisibleReportDraft & { recordedAt: string }>;
  truncated: boolean; coverage: 'original_host_reports_not_task_or_tenant_rate';
  evaluation: 'not_slo_evidence'; currentDisplay: 'not_asserted';
};

const id = text(36), revision = integer(1, 4294967295), flag: AiLeafSchemaDraft = { type: 'boolean' };
const count: AiLeafSchemaDraft = { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' };
const nullable = (schema: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [schema, { type: 'null' }] });
const percentage = nullable({ type: 'string', pattern: '^(100|[0-9]{1,2})\\.[0-9]{2}$' });
const lifecycle = object({ version: choice('task-lifecycle-1'),
  cancellation: object({ state: choice('not_recorded', 'pending', 'recorded'), requestRevision: nullable(revision),
    settlementRevision: nullable(revision), requestedAt: nullable(time), settledAt: nullable(time), elapsedMs: nullable(count),
    outcome: nullable(choice('succeeded', 'partially_succeeded', 'cancelled')),
    semantics: choice('request_settlement_not_business_rollback') }),
  recovery: object({ state: choice('not_recorded', 'observed'), items: list(object({ runId: id,
    fencingToken: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' }, origin: choice('takeover_receipt', 'recovery_run_interval'),
    referenceId: { ...identifier(), maxLength: 191 }, state: choice('pending', 'recorded'), startedAt: nullable(time),
    completedAt: nullable(time), elapsedMs: nullable(count), outcome: nullable(choice('succeeded', 'partially_succeeded', 'failed', 'cancelled')) }), 20),
    truncated: flag, coverage: choice('original_fenced_recovery_generations') }),
  consistency: choice('revalidated_reads_not_atomic_snapshot'), execution: choice('read_only_no_lease_model_dispatch_or_release') });
const lifecycleRates = object({ version: choice('task-lifecycle-rates-1'),
  cancellation: object({ state: choice('not_recorded', 'pending', 'recorded'), requested: integer(0, 50), recorded: integer(0, 50),
    pending: integer(0, 50), notRecordedTasks: integer(0, 50), percent: percentage,
    basis: choice('original_request_settlement_not_business_rollback') }),
  recovery: object({ state: choice('not_recorded', 'pending', 'recorded'), attempts: integer(0, 1000), recorded: integer(0, 1000),
    pending: integer(0, 1000), succeeded: integer(0, 1000), notRecordedTasks: integer(0, 50), truncated: flag, percent: percentage,
    basis: choice('original_fenced_recovery_terminal_evidence') }) });
const visibleSource = { oneOf: [object({ kind: choice('model_result'), resultId: id }),
  object({ kind: choice('approval_card'), stepId: id, proposalId: id, proposalRevision: revision })] };
const visibleFields = { version: choice('client-visible-1'), observationId: { type: 'string', format: 'uuid' },
  documentId: { type: 'string', format: 'uuid' }, taskId: id, runId: id, surface: choice('task_center', 'server_conversation'),
  kind: choice('text', 'card'), source: visibleSource, clientEpoch: integer(0, Number.MAX_SAFE_INTEGER),
  elapsedMs: integer(0, 600000), viewport: choice('compact_viewport', 'wide_viewport'), sampleSize: integer(1, 1),
  basis: choice('viewport_intersection_after_two_frames'), provenance: choice('client_reported_not_business_fact') };
// A model control has its own original operation key. It cannot masquerade as
// a conversation start, answer receipt or approval-card observation.
const visibleReport = (extra: Record<string, AiLeafSchemaDraft> = {}): AiLeafSchemaDraft => ({ oneOf: [
  object({ ...visibleFields, trigger: choice('original_model_start', 'original_input_resume'),
    originKey: { type: 'string', format: 'uuid' }, conversationId: text(191), turnId: text(191), ...extra },
    [...Object.keys(visibleFields), 'trigger', 'originKey', ...Object.keys(extra)]),
  object({ ...visibleFields, surface: choice('task_center'), kind: choice('text'),
    source: object({ kind: choice('model_result'), resultId: id }), trigger: choice('original_model_control'),
    originKey: { ...identifier(), maxLength: 128 }, ...extra }),
] });
export const AI_TASK_PERFORMANCE_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiTaskLifecycleObservationDraft: lifecycle,
  AiTaskLifecycleSampleRatesDraft: lifecycleRates,
  AiTaskClientVisibleReportDraft: visibleReport(),
  AiTaskClientVisibleReceiptDraft: object({ version: choice('client-visible-1'), observationId: { type: 'string', format: 'uuid' },
    taskId: id, runId: id, kind: choice('text', 'card'), status: choice('recorded'), recordedAt: time,
    provenance: choice('client_reported_not_business_fact'), effects: choice('no_authorization_execution_accounting_or_slo') }),
  AiTaskClientVisibleObservationDraft: { oneOf: [object({ state: choice('not_recorded') }), object({ state: choice('client_reported'),
    observations: list(visibleReport({ recordedAt: time }), 20, 1), truncated: flag,
    coverage: choice('original_host_reports_not_task_or_tenant_rate'), evaluation: choice('not_slo_evidence'), currentDisplay: choice('not_asserted') })] },
  AiTaskPerformanceReadDraft: object({ taskId: id, usageLimit: integer(1, 20), usageAfter: id, includeTaskFinancial: flag }, ['taskId', 'usageLimit']),
  AiTaskOutcomeSampleReadDraft: object({ taskIds: { ...list(id, 50, 1), uniqueItems: true } }),
  AiTaskOutcomeSampleDraft: object({ version: choice('task-outcome-sample-1'), observedAt: time,
    sceneCode: text(128), sceneVersion: text(64), taskIds: { ...list(id, 50, 1), uniqueItems: true }, sampleSize: integer(1, 50),
    statusCounts: object(Object.fromEntries(AI_TASK_STATUSES_DRAFT.map(status => [status, integer(0, 50)]))),
    successRate: object({ state: choice('recorded', 'pending'), succeeded: integer(0, 50), terminal: integer(0, 50),
      total: integer(1, 50), percent: nullable({ type: 'string', pattern: '^(100|[0-9]{1,2})\\.[0-9]{2}$' }) }),
    takeoverRate: object({ tasksWithReceipt: integer(0, 50), total: integer(1, 50),
      percent: { type: 'string', pattern: '^(100|[0-9]{1,2})\\.[0-9]{2}$' }, basis: choice('original_same_owner_takeover_receipts') }),
    lifecycleRates,
    coverage: choice('requested_authorized_one_owner_workspace_scene_version'), consistency: choice('revalidated_reads_not_atomic_snapshot'),
    slo: choice('not_evaluated'), execution: choice('read_only_no_lease_or_model') },
    ['version', 'observedAt', 'sceneCode', 'sceneVersion', 'taskIds', 'sampleSize', 'statusCounts', 'successRate', 'takeoverRate', 'coverage', 'consistency', 'slo', 'execution']),
  AiSceneTaskPerformanceReadDraft: object({ original: { $ref: '#/components/schemas/AiSceneRequestReadDraft' },
    taskId: id, usageLimit: integer(1, 20), usageAfter: id, includeTaskFinancial: flag }, ['original', 'usageLimit']),
  AiTaskPerformanceObservationDraft: object({ version: choice('task-performance-1'), observedAt: time,
    task: object({ taskId: id, sceneCode: text(128), sceneVersion: text(64), status: text(32), revision,
      createdAt: time, lastChangedAt: time, cancelRequestedAt: nullable(time) }),
    timing: object({ ageMs: count, firstRecordedStartAt: nullable(time), terminalEndedAt: nullable(time), endToEndMs: nullable(count) }),
    resources: { oneOf: [object({ state: choice('not_recorded') }), object({ state: choice('recorded'), revision,
      policyVersion: text(64), counters: list(object({ resource: choice('steps', 'calls', 'active_ms', 'output_bytes'),
        limit: count, consumed: count, reservedAndUnknown: count, remaining: count, exhausted: flag }), 4, 4) })] },
    runs: object({ items: list(object({ runId: id, sequence: revision, status: text(32), startedAt: nullable(time),
      endedAt: nullable(time), elapsedMs: nullable(count) }), 50), truncated: flag, coverage: choice('bounded_window') }),
    steps: object({ items: list(object({ stepId: id, runId: id, sequence: revision, toolCode: text(191), toolVersion: text(191),
      status: text(32), effect: text(32), revision,
      activeTime: { oneOf: [object({ state: choice('not_recorded') }), object({ state: choice('recorded'), recordedMs: nullable(count),
        reservedMs: count, unknownMs: count, basis: choice('persistent_resource_not_provider_latency') })] } }), 200),
      truncated: flag, coverage: choice('bounded_window') }),
    financial: { $ref: '#/components/schemas/AiTaskBudgetUsagePageDraft' },
    taskFinancial: { $ref: '#/components/schemas/AiTaskBudgetUsageSummaryDraft' },
    modelDelivery: object({ items: list(object({ invocationId: id, runId: id, stepId: id, callId: text(128),
      mode: choice('invoke', 'stream'), transportWallMs: count, firstValidatedTextMs: nullable(count),
      basis: choice('gateway_transport_including_usage_and_consumer_wait') }), 50),
      unobservedInWindow: integer(0, 50), truncated: flag, coverage: choice('completed_gateway_observations_only') }),
    budgetAdmission: object({ denials: list(object({ invocationId: id, runId: id, stepId: id, callId: text(128),
      observedAt: time, code: choice('budget_unavailable'), observation: choice('gate_rejected_not_release_evidence') }), 50),
      truncated: flag, coverage: choice('recorded_rejections_only') }),
    clientVisible: { $ref: '#/components/schemas/AiTaskClientVisibleObservationDraft' },
    lifecycle,
    measurements: object({ firstToken: choice('not_recorded', 'client_reported'), firstCard: choice('not_recorded', 'client_reported'), toolLatency: choice('not_recorded', 'resource_active_time_only'),
      modelLatency: choice('not_recorded', 'gateway_transport_wall_time_only'),
      rates: choice('not_computed'), slo: choice('not_evaluated') }),
    consistency: choice('revalidated_reads_not_atomic_snapshot'), execution: choice('read_only_no_dispatch_or_release') },
    ['version', 'observedAt', 'task', 'timing', 'resources', 'runs', 'steps', 'financial', 'modelDelivery', 'measurements', 'consistency', 'execution']),
};

/** Validate only the original observation transport; a valid packet grants no
 * retry, model call, budget release or SLO verdict. Legacy packets may omit it. */
export function validateAiTaskLifecycleObservationDraft(value: unknown): value is AiTaskLifecycleObservationDraft {
  return validateAiLeafSchemaValue(AI_TASK_PERFORMANCE_SCHEMAS.AiTaskLifecycleObservationDraft, value, AI_TASK_PERFORMANCE_SCHEMAS);
}
export function validateAiTaskLifecycleSampleRatesDraft(value: unknown): value is AiTaskLifecycleSampleRatesDraft {
  return validateAiLeafSchemaValue(AI_TASK_PERFORMANCE_SCHEMAS.AiTaskLifecycleSampleRatesDraft, value, AI_TASK_PERFORMANCE_SCHEMAS);
}
