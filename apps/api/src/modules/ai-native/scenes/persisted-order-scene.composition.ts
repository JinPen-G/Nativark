import { AiTaskRepositoryError } from '../ai-task.repository';
import { composePersistedOrderTaskInput } from '../order-task-input.composition';
import type { PersistedApprovedOrderDependencies } from '../approval-execution/approved-order-composition.ports';
import { composeAiBusinessOrderApplication } from './business-order-application';

type OrderInputDependencies = Parameters<typeof composePersistedOrderTaskInput>[0];
export type AiPersistedOrderSceneDependencies = OrderInputDependencies &
  Omit<PersistedApprovedOrderDependencies, 'inputSource'>;

/** Explicit assembly for an EXISTING task/run. The host/runner retains ownership
 * of lease acquisition, trusted policy provisioning, step start and recovery.
 * Publication is not approval, and registration is not execution. This does
 * not supply the still-missing pre-task original-request persistence model.
 */
export function composeAiPersistedOrderScene(dependencies: AiPersistedOrderSceneDependencies) {
  // Reject even untyped callers trying to substitute a successful input reader.
  // Both halves must consume the same server-normalized, persisted original.
  if (!dependencies || 'inputSource' in dependencies) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const inputs = composePersistedOrderTaskInput(dependencies);
  const application = composeAiBusinessOrderApplication({ ...dependencies, inputSource: inputs.inputSource });
  return Object.freeze({
    originalRequestCreation: 'requires_existing_task_and_run' as const,
    inputs,
    publishInput: inputs.source.publishOrderInput.bind(inputs.source),
    savePlan: inputs.plans.savePlan.bind(inputs.plans),
    registerStep: inputs.registrations.register.bind(inputs.registrations),
    prepare: application.prepare,
    submit: application.submit,
    reconcile: application.reconcile
  });
}
