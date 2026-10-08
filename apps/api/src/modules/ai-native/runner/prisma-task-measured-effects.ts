import type { PrismaClient } from '@prisma/client';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiTaskAccessFromContext, type AiTaskRepository } from '../ai-task.repository';
import type { AiExecutionContext } from '@rental-os/shared';
import { AiTaskExecutionBudgetError } from '../task-execution-budget.ports';
import type { AiTaskRunnerEffectPort, AiTaskRunnerStepPlan, AiTaskRunnerLease, AiTaskRunnerObservedResult, AiTaskRunnerConfirmationContinuation } from './ai-task-runner.ports';
import type { PrismaTaskRunEvidenceRepository } from './prisma-task-run-evidence.repository';
import type { AiTaskInputContext, AiTaskInputReader } from '../task-input/task-input.ports';
export interface AiTaskExecutionAuthorization {
  authorize(taskId: string): Promise<AiExecutionContext>;
}

export interface AiTaskRegisteredExecutor {
  resolve(toolCode: string, toolVersion: string): Promise<{
    operation: AiTaskRunnerStepPlan['operation'];
    phase?: 'confirmation';
    /** Must call the current-authorized business application/Gateway, never a
     * provider SDK or caller-selected HTTP/SQL/terminal. No default executor. */
    execute(input: { taskId: string; runId: string; stepId: string; actionId: string; inputRef: string; fingerprint: string; lease: AiTaskRunnerLease; clarifications?: readonly AiTaskInputContext[] }, signal: AbortSignal): Promise<AiTaskRunnerObservedResult>;
  } | null>;
}

/** Explicit persistence/measuring boundary around registered application tools.
 * Receives the runner's exact lease; never silently adopts a new owner's lease.
 * Recovery reads artifacts only and does not call execute or a supplier.
 */
export class PrismaTaskMeasuredEffects implements AiTaskRunnerEffectPort {
  constructor(private readonly db: Pick<PrismaClient, 'aiTask' | 'aiStep'>,
    private readonly tasks: Pick<AiTaskRepository, 'resolveAccess'>,
    private readonly evidence: Pick<PrismaTaskRunEvidenceRepository, 'capture' | 'recoverResult' | 'assertExecutable'>,
    private readonly tools: AiTaskRegisteredExecutor,
    private readonly executionAuthorization: AiTaskExecutionAuthorization,
    private readonly inputs?: AiTaskInputReader, private readonly wall: () => Date = () => new Date()) {
    if (typeof tasks?.resolveAccess !== 'function' || typeof evidence?.capture !== 'function'
      || typeof evidence?.recoverResult !== 'function' || typeof evidence?.assertExecutable !== 'function' || typeof tools?.resolve !== 'function'
      || typeof executionAuthorization?.authorize !== 'function') throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
  }
  private async step(plan: AiTaskRunnerStepPlan, lease?: AiTaskRunnerLease) {
    if (!lease) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    plan = structuredClone(plan); lease = structuredClone(lease);
    const access = structuredClone(await this.tasks.resolveAccess(lease.taskId, 'transition_task'));
    const task = await this.db.aiTask.findFirst({ where: access.where, select: { scopeId: true } });
    if (!task) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const actionId = `ai-action-${requestFingerprint({ version: 'ai-step-registration-1', scope: access.scope, taskId: lease.taskId, registrationRef: plan.registrationRef })}`;
    const step = await this.db.aiStep.findFirst({ where: { scopeId: task.scopeId, taskId: lease.taskId, runId: lease.runId,
      actionId, toolCode: plan.toolCode, toolVersion: plan.toolVersion } });
    if (!step) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    return { step, lease, plan, access };
  }
  execute(plan: AiTaskRunnerStepPlan, signal: AbortSignal, lease?: AiTaskRunnerLease) {
    return this.runEffect(plan, signal, lease);
  }
  continueConfirmation(plan: AiTaskRunnerStepPlan, signal: AbortSignal, lease: AiTaskRunnerLease, continuation: AiTaskRunnerConfirmationContinuation) {
    return this.runEffect(plan, signal, lease, structuredClone(continuation));
  }
  private async runEffect(plan: AiTaskRunnerStepPlan, signal: AbortSignal, lease?: AiTaskRunnerLease, continuation?: AiTaskRunnerConfirmationContinuation) {
    const binding = await this.step(plan, lease);
    const inputRef = binding.step.inputRef;
    if (!inputRef) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    const tool = await this.tools.resolve(binding.plan.toolCode, binding.plan.toolVersion);
    if (!tool || tool.operation !== binding.plan.operation || typeof tool.execute !== 'function') throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    // Capture the validated registered method before persistence/policy awaits.
    // A shared registry object's later mutation must not swap the executable.
    const execute = tool.execute.bind(tool), phase = tool.phase;
    if (phase !== undefined && (phase !== 'confirmation' || binding.plan.operation !== 'idempotent'
      || binding.plan.toolCode !== 'rental.order.commit')) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    if (continuation && (phase !== 'confirmation' || continuation.stepId !== binding.step.id
      || continuation.stepRevision !== binding.step.revision)) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    return this.evidence.capture(binding.lease, binding.step.id, signal, async () => {
      const clarifications = this.inputs ? structuredClone(await this.inputs.readForStep(binding.lease, binding.plan.registrationRef)) : undefined;
      if (signal.aborted) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
      const context = structuredClone(await this.executionAuthorization.authorize(binding.lease.taskId));
      const current = aiTaskAccessFromContext(context, binding.lease.taskId, this.wall());
      if (current.bindingKey !== binding.access.bindingKey) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
      await this.evidence.assertExecutable(binding.lease);
      if (signal.aborted) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
      return execute({ taskId: binding.lease.taskId, runId: binding.lease.runId, stepId: binding.step.id,
        actionId: binding.step.actionId, inputRef, fingerprint: binding.step.requestFingerprint,
        lease: structuredClone(binding.lease), ...(clarifications ? { clarifications } : {}) }, signal);
    }, continuation ?? phase);
  }
  async reconcile(plan: AiTaskRunnerStepPlan, signal: AbortSignal, lease?: AiTaskRunnerLease) {
    if (signal.aborted) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    const binding = await this.step(plan, lease);
    return this.evidence.recoverResult(binding.lease, binding.step.id);
  }
  readInterrupted(plan: AiTaskRunnerStepPlan, signal: AbortSignal, lease: AiTaskRunnerLease) {
    return this.reconcile(plan, signal, lease);
  }
}
