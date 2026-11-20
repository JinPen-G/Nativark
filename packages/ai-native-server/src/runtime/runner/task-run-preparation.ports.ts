/** Server-only preparation resource definition and original receipt ports.
 * A definition is NOT an executable plan, input authorization or dispatch grant.
 * It names the original resource origin; current inputs still authorize the plan.
 */
import { z } from 'zod';
import type { AiTaskRunnerPlan } from './ai-task-runner.ports';
export type { AiTaskPreparationDefinition, AiTaskPreparationTicket, AiTaskPreparationResources } from '@rental-os/platform-server/ai-runtime';
import { aiTaskRunPlanSchema, isAiTaskRunPlanBounded } from './prisma-task-run-evidence.repository';
import type { AiTaskExecutionLease, AiTaskExecutionPolicy, AiTaskExecutionSettlementRequest, AiTaskExecutionChargeEvidence } from '../task-execution-budget.ports';

/** Optional server-owned proof for an explicit operator model-control Run.
 * Returns the original saved resource plan, never a new allowance or a grant.
 * Ordinary and human-answer runs keep their existing lineage reader. */
export type AiTaskControlResourceOrigin = (key: { scopeId: string; taskId: string; runId: string;
  resourceOriginRunId: string }) => Promise<AiTaskRunnerPlan>;
export const taskPreparationDefinitionSchema = aiTaskRunPlanSchema.innerType().omit({ taskRevision: true }).extend({
  bindingHash: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict().refine(isAiTaskRunPlanBounded);
export interface AiTaskPreparationPolicySource {
  resourcePolicy(taskId: string, lease: AiTaskExecutionLease, originalOnly: boolean): Promise<AiTaskExecutionPolicy | null>;
}
export interface AiTaskPreparationEvidenceSource {
  read(input: AiTaskExecutionSettlementRequest, reconcile: boolean): Promise<AiTaskExecutionChargeEvidence>;
}
