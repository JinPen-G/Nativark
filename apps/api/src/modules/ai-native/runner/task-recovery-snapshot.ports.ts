import type { AiTaskStatusDraft, AiStepStatusDraft } from '@rental-os/shared';
import type { AiTaskExecutionResource } from '../task-execution-budget.ports';

/** Internal read model, not a dispatch, settlement or approval contract. Decimal
 * strings preserve persisted counters; null means absent evidence, never zero.
 * Artifact measurement and business effect are separate stored facts.
 */
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
    charges: readonly { chargeId: string; resource: AiTaskExecutionResource; status: 'reserved' | 'recorded' | 'unknown';
      amount: string; actualAmount: string | null; evidenceRef: string | null; gatewayInvocationId: string | null }[];
  }[];
  /** Task-wide cumulative counters, not a sum of just this run's steps. */
  resources: { revision: number; policyVersion: string;
    counters: Record<AiTaskExecutionResource, { limit: string; reserved: string; consumed: string }> } | null;
}

export interface AiTaskRecoverySnapshotSource {
  read(value: unknown): Promise<AiTaskRecoverySnapshot>;
}
