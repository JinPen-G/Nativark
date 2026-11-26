/** Server-only preparation resource definition and original receipt ports.
 * A definition is NOT an executable plan, input authorization or dispatch grant.
 * It names the original resource origin; current inputs still authorize the plan.
 */
import { z } from 'zod';
import type { AiTaskRunnerPlan } from '@rental-os/platform-server/ai-runtime';
export type { AiTaskPreparationDefinition, AiTaskPreparationTicket, AiTaskPreparationResources } from '@rental-os/platform-server/ai-runtime';
import { aiTaskRunPlanSchema, isAiTaskRunPlanBounded } from './task-run-plan.repository';
import type { AiTaskExecutionLease, AiTaskExecutionPolicy, AiTaskExecutionSettlementRequest, AiTaskExecutionChargeEvidence } from '../task-execution-budget.ports';

export type { AiTaskControlResourceOrigin } from './task-run-plan.repository';
export const taskPreparationDefinitionSchema = aiTaskRunPlanSchema.innerType().omit({ taskRevision: true }).extend({
  bindingHash: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict().refine(isAiTaskRunPlanBounded);
export interface AiTaskPreparationPolicySource {
  resourcePolicy(taskId: string, lease: AiTaskExecutionLease, originalOnly: boolean): Promise<AiTaskExecutionPolicy | null>;
}
export interface AiTaskPreparationEvidenceSource {
  read(input: AiTaskExecutionSettlementRequest, reconcile: boolean): Promise<AiTaskExecutionChargeEvidence>;
}
