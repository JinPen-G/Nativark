import { AiTaskRepositoryError } from '../ai-task.repository';
import { composePersistedOrderTaskInput } from '../order-task-input.composition';
import type { PersistedApprovedOrderDependencies } from '../approval-execution/approved-order-composition.ports';
import { composeControlledApprovedOrder } from '../approval-execution/controlled-approved-order.composition';
import { AiApprovedOrderResultUnknownError } from '../approval-execution/approved-order.errors';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';

type OrderInputDependencies = Parameters<typeof composePersistedOrderTaskInput>[0];
export type AiPersistedOrderSceneDependencies = OrderInputDependencies &
  Omit<PersistedApprovedOrderDependencies, 'inputSource' | 'executionInput'>;

/** Explicit assembly for an EXISTING task/run. The host/runner retains ownership
 * of lease acquisition, trusted policy provisioning, step start and recovery.
 * Publication is not approval, and registration is not execution. This does
 * not supply the still-missing pre-task original-request persistence model.
 */
export function composeAiPersistedOrderScene(dependencies: AiPersistedOrderSceneDependencies) {
  // Reject even untyped callers trying to substitute a successful input reader.
  // Both halves must consume the same server-normalized, persisted original.
  if (!dependencies || 'inputSource' in dependencies || 'executionInput' in dependencies
    || dependencies.toolVersion !== AI_TOOL_DRAFT_VERSION) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const inputs = composePersistedOrderTaskInput(dependencies);
  const application = composeControlledApprovedOrder(dependencies);
  const result = async (command: unknown, mode: 'submit' | 'reconcile') => {
    try {
      const outcome = await application[mode](structuredClone(command));
      return Object.freeze({ status: 'committed' as const, replayed: outcome.replayed,
        order: Object.freeze({ id: outcome.order.id, status: outcome.order.status, quoteId: outcome.order.quoteId }),
        source: Object.freeze({ resourceType: 'order' as const, resourceId: outcome.order.id }),
        payment: 'not_inferred' as const, fulfillment: 'not_inferred' as const, taskOutcome: 'owned_by_runner' as const });
    } catch (error) {
      if (!(error instanceof AiApprovedOrderResultUnknownError)) throw error;
      return Object.freeze({ status: 'unknown' as const, errorCode: 'AI_RESULT_UNKNOWN' as const,
        nextAction: 'reconcile' as const, retryable: false as const, order: undefined, sideEffect: 'may_have_committed' as const });
    }
  };
  return Object.freeze({
    originalRequestCreation: 'requires_existing_task_and_run' as const,
    inputs,
    publishInput: inputs.source.publishOrderInput.bind(inputs.source),
    savePlan: inputs.plans.savePlan.bind(inputs.plans),
    registerStep: inputs.registrations.register.bind(inputs.registrations),
    prepare: application.prepare,
    submit: (command: unknown) => result(command, 'submit'),
    reconcile: (command: unknown) => result(command, 'reconcile')
  });
}
