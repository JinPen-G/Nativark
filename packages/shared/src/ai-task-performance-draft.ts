/** Persisted observations, not an SLO verdict, provider bill or execution grant. */
import type { AiTaskBudgetUsagePageDraft, AiTaskBudgetUsageSummaryDraft } from './ai-scene-request-draft';
import { AI_TASK_STATUSES_DRAFT, type AiTaskStatusDraft } from './ai-task-draft';
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
  coverage: 'requested_authorized_one_owner_workspace_scene_version';
  consistency: 'revalidated_reads_not_atomic_snapshot'; slo: 'not_evaluated'; execution: 'read_only_no_lease_or_model';
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
    coverage: choice('requested_authorized_one_owner_workspace_scene_version'), consistency: choice('revalidated_reads_not_atomic_snapshot'),
    slo: choice('not_evaluated'), execution: choice('read_only_no_lease_or_model') }),
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
    measurements: object({ firstToken: choice('not_recorded', 'client_reported'), firstCard: choice('not_recorded', 'client_reported'), toolLatency: choice('not_recorded', 'resource_active_time_only'),
      modelLatency: choice('not_recorded', 'gateway_transport_wall_time_only'),
      rates: choice('not_computed'), slo: choice('not_evaluated') }),
    consistency: choice('revalidated_reads_not_atomic_snapshot'), execution: choice('read_only_no_dispatch_or_release') },
    ['version', 'observedAt', 'task', 'timing', 'resources', 'runs', 'steps', 'financial', 'modelDelivery', 'measurements', 'consistency', 'execution']),
};
