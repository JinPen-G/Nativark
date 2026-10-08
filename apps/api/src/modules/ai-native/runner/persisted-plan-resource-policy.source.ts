import type { AiTaskRepository } from '../ai-task.repository';
import type { AiTaskExecutionLease, AiTaskExecutionPolicySource } from '../task-execution-budget.ports';
import { AiTaskExecutionBudgetError } from '../task-execution-budget.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { PrismaTaskRunEvidenceRepository } from './prisma-task-run-evidence.repository';
import type { AiTaskRunnerTaskMetadata } from './ai-task-runner.ports';

/** Derives resource ceilings from the immutable, currently authorized saved
 * plan. Not a permission/entitlement policy and not a source of model limits.
 * Recovery reuses the same plan/limits; it cannot mint a fresh task allowance.
 */
export class PersistedPlanResourcePolicySource implements AiTaskExecutionPolicySource {
  constructor(private readonly tasks: Pick<AiTaskRepository, 'readMetadata'>,
    private readonly plans: Pick<PrismaTaskRunEvidenceRepository, 'resolve'>) {
    if (typeof tasks?.readMetadata !== 'function' || typeof plans?.resolve !== 'function') {
      throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    }
  }

  async resolve(taskId: string, presented: AiTaskExecutionLease) {
    const lease = structuredClone(presented);
    if (!lease || lease.taskId !== taskId) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const metadata = structuredClone(await this.tasks.readMetadata(taskId));
    if (metadata.taskId !== taskId) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const plan = structuredClone(await this.plans.resolve(metadata as AiTaskRunnerTaskMetadata, { ...lease, expiresAt: '' }, true));
    if (plan.taskId !== taskId || plan.runId !== lease.runId) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const bounds = [plan.limits.maxSteps, plan.limits.maxCalls, plan.limits.maxTotalMs, plan.limits.maxOutputBytes];
    if (bounds.some(value => !Number.isSafeInteger(value) || value <= 0)) throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT');
    const limits = { steps: BigInt(bounds[0]), calls: BigInt(bounds[1]), active_ms: BigInt(bounds[2]), output_bytes: BigInt(bounds[3]) };
    const stable = { version: 'saved-plan-resource-1', taskId, runId: lease.runId,
      steps: plan.steps, limits: plan.limits };
    // Task revision and holder change during normal progress/recovery; they are
    // separately fenced, not reasons to reset durable resource counters.
    return { version: stable.version, fingerprint: requestFingerprint(stable), limits };
  }
}
