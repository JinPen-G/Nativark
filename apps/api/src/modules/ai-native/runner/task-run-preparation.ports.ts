/** Server-only preparation resource definition and original receipt ports.
 * A definition is NOT an executable plan, input authorization or dispatch grant.
 * It names the original resource origin; current inputs still authorize the plan.
 */
import { z } from 'zod';
import type { AiTaskRunnerLease, AiTaskRunnerPlan } from './ai-task-runner.ports';
import { aiTaskRunPlanSchema, isAiTaskRunPlanBounded } from './prisma-task-run-evidence.repository';
import type { AiTaskExecutionLease, AiTaskExecutionPolicy, AiTaskExecutionSettlementRequest, AiTaskExecutionChargeEvidence } from '../task-execution-budget.ports';

export type AiTaskPreparationDefinition = Omit<AiTaskRunnerPlan, 'taskRevision'> & { bindingHash: string };
/** Optional server-owned proof for an explicit operator model-control Run.
 * Returns the original saved resource plan, never a new allowance or a grant.
 * Ordinary and human-answer runs keep their existing lineage reader. */
export type AiTaskControlResourceOrigin = (key: { scopeId: string; taskId: string; runId: string;
  resourceOriginRunId: string }) => Promise<AiTaskRunnerPlan>;
export const taskPreparationDefinitionSchema = aiTaskRunPlanSchema.innerType().omit({ taskRevision: true }).extend({
  bindingHash: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict().refine(isAiTaskRunPlanBounded);
export interface AiTaskPreparationTicket {
  key: string;
  prepared: boolean;
  /** Original reservation minus this preparation's already spent admission time.
   * Required for a new callback; a completed original receipt has no work window. */
  remainingMs?: number;
}
export interface AiTaskPreparationResources {
  begin(lease: AiTaskRunnerLease, definition: AiTaskPreparationDefinition | undefined, maximumMs: number,
    signal?: AbortSignal): Promise<AiTaskPreparationTicket>;
  complete(ticket: AiTaskPreparationTicket, lease: AiTaskRunnerLease): Promise<void>;
  /** Atomic original measurement/settlement and startup reservation. Only a
   * fresh same-process preparation may hand over; a receipt is not a clock. */
  handoff?(ticket: AiTaskPreparationTicket, lease: AiTaskRunnerLease, recovery: boolean,
    retainStepAllowance: boolean): Promise<import('./ai-task-runner.ports').AiTaskRunnerOverheadTicket>;
  abandon(ticket: AiTaskPreparationTicket, lease: AiTaskRunnerLease): Promise<void>;
}
export interface AiTaskPreparationPolicySource {
  resourcePolicy(taskId: string, lease: AiTaskExecutionLease, originalOnly: boolean): Promise<AiTaskExecutionPolicy | null>;
}
export interface AiTaskPreparationEvidenceSource {
  read(input: AiTaskExecutionSettlementRequest, reconcile: boolean): Promise<AiTaskExecutionChargeEvidence>;
}
