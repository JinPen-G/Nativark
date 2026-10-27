import type { PrismaGatewayInvocationBindings, RegisterGatewayInvocation } from '../budget/prisma-gateway-invocation-bindings';
import { AiTaskExecutionBudgetError } from '../task-execution-budget.ports';
import type { AiTaskRunnerLease, AiTaskRunnerStepRef } from './ai-task-runner.ports';
import type { AiTaskModelInvocationPreparation } from './prisma-task-runner-resource.source';

export interface AiTaskGatewayInputSource {
  /** Must resolve immutable authorized input + current config + price version.
   * Never exposes model/url/key selection to the Agent. No synthetic default. */
  resolve(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<RegisterGatewayInvocation>;
}

/** Reuses the existing persistent Gateway registration checks; does not reserve
 * money, claim dispatch, invoke a provider or create a second invocation store. */
export class PrismaTaskGatewayInvocationPreparation implements AiTaskModelInvocationPreparation {
  constructor(private readonly bindings: Pick<PrismaGatewayInvocationBindings, 'register'>,
    private readonly inputs: AiTaskGatewayInputSource) {
    if (typeof bindings?.register !== 'function' || typeof inputs?.resolve !== 'function') throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
  }
  async prepare(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, signal?: AbortSignal) {
    if (signal?.aborted) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    step = structuredClone(step); lease = structuredClone(lease);
    const input = structuredClone(await this.inputs.resolve(step, lease));
    if (input.stepId !== step.registered.stepId || input.lease.runId !== lease.runId || input.lease.holderId !== lease.holderId
      || input.lease.fencingToken !== lease.fencingToken || !(input.expiresAt instanceof Date)
      || input.expiresAt.getTime() > Date.parse(lease.expiresAt)) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    if (signal?.aborted) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    const result = await this.bindings.register(input);
    if (result.replayed) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    return { invocationId: result.id };
  }
}
