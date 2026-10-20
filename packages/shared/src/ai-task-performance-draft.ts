/** Persisted observations, not an SLO verdict, provider bill or execution grant. */
import type { AiTaskBudgetUsagePageDraft, AiTaskBudgetUsageSummaryDraft } from './ai-scene-request-draft';
import { leafClosed as object, leafEnum as choice, leafInt as integer, leafList as list,
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
  measurements: { firstToken: 'not_recorded'; firstCard: 'not_recorded'; toolLatency: 'not_recorded' | 'resource_active_time_only';
    modelLatency: 'not_recorded' | 'gateway_transport_wall_time_only';
    rates: 'not_computed'; slo: 'not_evaluated' };
  consistency: 'revalidated_reads_not_atomic_snapshot'; execution: 'read_only_no_dispatch_or_release';
};

const id = text(36), revision = integer(1, 4294967295), flag: AiLeafSchemaDraft = { type: 'boolean' };
const count: AiLeafSchemaDraft = { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' };
const nullable = (schema: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [schema, { type: 'null' }] });
export const AI_TASK_PERFORMANCE_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
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
    measurements: object({ firstToken: choice('not_recorded'), firstCard: choice('not_recorded'), toolLatency: choice('not_recorded', 'resource_active_time_only'),
      modelLatency: choice('not_recorded', 'gateway_transport_wall_time_only'),
      rates: choice('not_computed'), slo: choice('not_evaluated') }),
    consistency: choice('revalidated_reads_not_atomic_snapshot'), execution: choice('read_only_no_dispatch_or_release') },
    ['version', 'observedAt', 'task', 'timing', 'resources', 'runs', 'steps', 'financial', 'modelDelivery', 'measurements', 'consistency', 'execution']),
};
