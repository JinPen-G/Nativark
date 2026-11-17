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
  faults?: AiTaskFaultObservationDraft;
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

/** Bounded original diagnostics. Lease age and pending resources do not prove
 * worker death or authorize retry; absent Outbox evidence is not a healthy zero. */
type TaskFaultLease = { state: 'not_held' | 'current' | 'expired'; expiresAt: string | null; overdueMs: string | null };
export type AiTaskFaultObservationDraft = {
  version: 'task-fault-1'; observedAt: string;
  dbRead: { state: 'recorded'; queryCount: number; cumulativeWaitMs: string; maximumWaitMs: string;
    resolution: 'ceiling_millisecond'; coverage: 'this_reader_direct_queries_not_execution_latency' };
  worker: { state: 'not_recorded' | 'observed';
    runs: { items: Array<{ runId: string; revision: number; fencingToken: string; holderId: string | null;
      status: string; lease: TaskFaultLease }>; truncated: boolean; coverage: 'latest_original_runs_window' };
    unresolvedResources: { items: Array<{ chargeId: string; runId: string; stepId: string | null; actionId: string | null;
      holderId: string; fencingToken: string; resource: 'steps' | 'calls' | 'active_ms' | 'output_bytes';
      status: 'reserved' | 'unknown'; amount: string; openedAt: string; ageMs: string }>;
      truncated: boolean; coverage: 'original_unresolved_charge_window_not_financial_account' };
    faults: { state: 'not_recorded' | 'observed'; items: Array<{ stepId: string; runId: string; revision: number;
      status: 'failed' | 'unknown'; errorCode: string | null; evidence: { state: 'not_recorded' }
        | { state: 'recorded'; cursor: string; referenceId: string; occurredAt: string } }>;
      truncated: boolean; coverage: 'original_step_state_and_matching_event_only' };
    liveness: 'not_recorded'; semantics: 'lease_and_resource_state_not_execution_or_redispatch_permission' };
  events: { taskTimeline: { state: 'not_recorded' | 'recorded'; retainedInWindow: number; firstCursor: string | null;
    lastCursor: string | null; taskCursor: string; truncated: boolean; deliveryBacklog: 'not_recorded';
    coverage: 'retained_task_timeline_not_business_outbox' };
    businessOutbox: { state: 'not_recorded' } | { state: 'recorded'; items: Array<{ eventId: string; runId: string;
      sourceRef: string; status: string; attempts: number; lease: TaskFaultLease; pendingAgeMs: string | null }>;
      pendingInWindow: number; oldestPendingAgeMs: string | null; truncated: boolean;
      coverage: 'original_task_bound_business_outbox_window' } };
  recovery: Omit<AiTaskLifecycleObservationDraft['recovery'], 'items'> & {
    items: Array<AiTaskLifecycleObservationDraft['recovery']['items'][number] & { pendingAgeMs: string | null }> };
  alerts: { state: 'not_evaluated' } | { state: 'evaluated'; policyId: string; policyRevision: number;
    items: Array<{ id: string; code: 'db_query_wait' | 'expired_lease_with_unresolved_resources' | 'unresolved_resource_age'
      | 'bound_outbox_pending' | 'recovery_pending'; referenceId: string; runId: string | null;
      measured: string; threshold: string; semantics: 'diagnostic_only_no_retry_or_release' }>;
    truncated: boolean; delivery: 'not_requested'; deduplication: 'stable_original_reference_id';
    basis: 'trusted_server_policy_current_original_evidence' };
  consistency: 'revalidated_reads_not_atomic_snapshot'; execution: 'read_only_no_dispatch_or_release'; slo: 'not_evaluated';
};
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
const faultReference = { ...identifier(), maxLength: 191 };
const faultLease = { oneOf: [
  object({ state: choice('not_held'), expiresAt: { type: 'null' }, overdueMs: { type: 'null' } }),
  object({ state: choice('current'), expiresAt: time, overdueMs: { type: 'null' } }),
  object({ state: choice('expired'), expiresAt: time, overdueMs: count })
] };
const faultRecovery = object({ state: choice('not_recorded', 'observed'), items: list(object({ runId: id, fencingToken: count,
  origin: choice('takeover_receipt', 'recovery_run_interval'), referenceId: faultReference, state: choice('pending', 'recorded'),
  startedAt: nullable(time), completedAt: nullable(time), elapsedMs: nullable(count), pendingAgeMs: nullable(count),
  outcome: nullable(choice('succeeded', 'partially_succeeded', 'failed', 'cancelled')) }), 20),
  truncated: flag, coverage: choice('original_fenced_recovery_generations') });
const faults = object({ version: choice('task-fault-1'), observedAt: time,
  dbRead: object({ state: choice('recorded'), queryCount: integer(0, 200), cumulativeWaitMs: count, maximumWaitMs: count,
    resolution: choice('ceiling_millisecond'), coverage: choice('this_reader_direct_queries_not_execution_latency') }),
  worker: object({ state: choice('not_recorded', 'observed'),
    runs: object({ items: list(object({ runId: id, revision, fencingToken: count, holderId: nullable(faultReference),
      status: choice(...AI_TASK_STATUSES_DRAFT), lease: faultLease }), 20), truncated: flag, coverage: choice('latest_original_runs_window') }),
    unresolvedResources: object({ items: list(object({ chargeId: faultReference, runId: id, stepId: nullable(id), actionId: nullable(faultReference),
      holderId: faultReference, fencingToken: count, resource: choice('steps', 'calls', 'active_ms', 'output_bytes'),
      status: choice('reserved', 'unknown'), amount: count, openedAt: time, ageMs: count }), 100), truncated: flag,
      coverage: choice('original_unresolved_charge_window_not_financial_account') }),
    faults: object({ state: choice('not_recorded', 'observed'), items: list(object({ stepId: id, runId: id, revision,
      status: choice('failed', 'unknown'), errorCode: nullable(text(128)), evidence: { oneOf: [object({ state: choice('not_recorded') }),
        object({ state: choice('recorded'), cursor: count, referenceId: faultReference, occurredAt: time })] } }), 20),
      truncated: flag, coverage: choice('original_step_state_and_matching_event_only') }),
    liveness: choice('not_recorded'), semantics: choice('lease_and_resource_state_not_execution_or_redispatch_permission') }),
  events: object({ taskTimeline: object({ state: choice('not_recorded', 'recorded'), retainedInWindow: integer(0, 100),
    firstCursor: nullable(count), lastCursor: nullable(count), taskCursor: count, truncated: flag,
    deliveryBacklog: choice('not_recorded'), coverage: choice('retained_task_timeline_not_business_outbox') }),
    businessOutbox: { oneOf: [object({ state: choice('not_recorded') }), object({ state: choice('recorded'),
      items: list(object({ eventId: { type: 'string', format: 'uuid' }, runId: id, sourceRef: faultReference,
        status: choice('pending', 'claimed', 'retry_scheduled', 'ready', 'closed', 'expired', 'dead_letter'), attempts: integer(0, 4294967295),
        lease: faultLease, pendingAgeMs: nullable(count) }), 20, 1), pendingInWindow: integer(0, 20), oldestPendingAgeMs: nullable(count),
      truncated: flag, coverage: choice('original_task_bound_business_outbox_window') })] } }),
  recovery: faultRecovery,
  alerts: { oneOf: [object({ state: choice('not_evaluated') }), object({ state: choice('evaluated'), policyId: faultReference, policyRevision: revision,
    items: list(object({ id: { type: 'string', pattern: '^[a-f0-9]{64}$' }, code: choice('db_query_wait', 'expired_lease_with_unresolved_resources',
      'unresolved_resource_age', 'bound_outbox_pending', 'recovery_pending'), referenceId: text(256), runId: nullable(id),
      measured: count, threshold: count, semantics: choice('diagnostic_only_no_retry_or_release') }), 20), truncated: flag,
    delivery: choice('not_requested'), deduplication: choice('stable_original_reference_id'), basis: choice('trusted_server_policy_current_original_evidence') })] },
  consistency: choice('revalidated_reads_not_atomic_snapshot'), execution: choice('read_only_no_dispatch_or_release'), slo: choice('not_evaluated') });
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
  AiTaskFaultObservationDraft: faults,
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
    faults,
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

export function validateAiTaskFaultObservationDraft(value: unknown): value is AiTaskFaultObservationDraft {
  if (!validateAiLeafSchemaValue(faults, value, AI_TASK_PERFORMANCE_SCHEMAS)) return false;
  const observation = value as AiTaskFaultObservationDraft;
  if (BigInt(observation.dbRead.maximumWaitMs) > BigInt(observation.dbRead.cumulativeWaitMs)) return false;
  const observedAt = Date.parse(observation.observedAt);
  if (observation.worker.unresolvedResources.items.some(row => Date.parse(row.openedAt) > observedAt
    || BigInt(row.ageMs) !== BigInt(observedAt - Date.parse(row.openedAt)))) return false;
  if ((observation.recovery.state === 'observed') !== (observation.recovery.items.length > 0)) return false;
  if (observation.alerts.state === 'evaluated' && observation.alerts.items.some(alert => {
    if (BigInt(alert.threshold) < 1n || BigInt(alert.measured) < BigInt(alert.threshold)) return true;
    if (alert.code !== 'expired_lease_with_unresolved_resources') return false;
    const run = observation.worker.runs.items.find(row => row.runId === alert.runId);
    return !run || run.lease.state !== 'expired' || alert.referenceId !== run.runId + ':' + run.fencingToken
      || alert.measured !== run.lease.overdueMs || !observation.worker.unresolvedResources.items.some(row =>
        row.runId === run.runId && row.fencingToken === run.fencingToken && row.holderId === run.holderId && BigInt(row.amount) > 0n);
  })) return false;
  const leases = [...observation.worker.runs.items.map(row => row.lease),
    ...(observation.events.businessOutbox.state === 'recorded' ? observation.events.businessOutbox.items.map(row => row.lease) : [])];
  if (leases.some(lease => lease.state === 'expired'
    ? Date.parse(lease.expiresAt!) > Date.parse(observation.observedAt)
      || BigInt(lease.overdueMs!) !== BigInt(Date.parse(observation.observedAt) - Date.parse(lease.expiresAt!))
    : lease.state === 'current' && Date.parse(lease.expiresAt!) <= Date.parse(observation.observedAt))) return false;
  const outbox = observation.events.businessOutbox;
  if (outbox.state === 'recorded') {
    const pending = outbox.items.filter(row => ['pending', 'claimed', 'retry_scheduled'].includes(row.status));
    if (pending.length !== outbox.pendingInWindow || outbox.items.some(row => (row.pendingAgeMs !== null) !== pending.includes(row))) return false;
    const oldest = pending.reduce<bigint | null>((maximum, row) => maximum === null || BigInt(row.pendingAgeMs!) > maximum
      ? BigInt(row.pendingAgeMs!) : maximum, null);
    if (outbox.oldestPendingAgeMs !== (oldest?.toString() ?? null)) return false;
  }
  return observation.recovery.items.every(row => row.state === 'recorded'
    ? row.startedAt !== null && row.completedAt !== null && row.elapsedMs !== null && row.outcome !== null && row.pendingAgeMs === null
      && BigInt(row.elapsedMs) === BigInt(Date.parse(row.completedAt) - Date.parse(row.startedAt))
    : row.completedAt === null && row.elapsedMs === null && row.outcome === null
      && (row.startedAt === null ? row.pendingAgeMs === null : row.pendingAgeMs !== null
        && BigInt(row.pendingAgeMs) === BigInt(Date.parse(observation.observedAt) - Date.parse(row.startedAt))));
}
