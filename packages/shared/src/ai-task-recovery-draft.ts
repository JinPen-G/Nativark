import type { AiTaskStatusDraft, AiStepStatusDraft } from './ai-task-draft';
import type { AiSceneRequestReadDraft } from './ai-scene-request-draft';

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
