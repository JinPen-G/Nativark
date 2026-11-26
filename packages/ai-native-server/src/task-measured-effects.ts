/** Original durable effect measurement for a public Runner host. Registered
 * executors own real tool calls; models use the same Gateway and its original
 * dispatch records. Nothing here registers HTTP or starts a provider. */
import { isStrictAiTaskTransactionBoundary } from './task-transactions';
import { createPublicAiTaskRunnerResources } from './task-runner-resources';
import { AiTaskExecutionBudgetError } from './task-resource-ledger';
import { TaskPersistenceRepository, type AiTaskRepositoryAuthority } from './runtime/task-persistence.repository';
import { TaskRunEvidenceRepository } from './runtime/runner/task-run-evidence.repository';
import { TaskMeasuredEffects, type TaskInputAnswer, type TaskRegisteredExecutor,
  type AiTaskExecutionAuthorization } from './runtime/runner/task-measured-effects';
import type { GatewayDispatchEvidenceSource } from './runtime/budget/gateway-dispatch-evidence.ports';
import type { TaskInputReader } from './runtime/task-input/task-input-context.ports';

export type { TaskRegisteredExecutor, AiTaskExecutionAuthorization };
export type { GatewayDispatchEvidenceSource, BudgetEvidenceBinding } from './runtime/budget/gateway-dispatch-evidence.ports';
export type { AiTaskRunnerObservedResult } from './runtime/runner/task-observed-result';

type Resources = Omit<Parameters<typeof createPublicAiTaskRunnerResources>[0], 'tasks' | 'bindEffectEvidence'>;

/** Compose resource and effect participants with the same database, clock and
 * transaction. Start/capture requires current work authority; reading and
 * recording an original result keep their separate permissions. */
export function createPublicAiTaskMeasuredRunnerPorts<Answer = TaskInputAnswer>(input: Resources & {
  actions: AiTaskRepositoryAuthority;
  execution: AiTaskExecutionAuthorization;
  tools: TaskRegisteredExecutor<Answer>;
  dispatchEvidence?: GatewayDispatchEvidenceSource;
  inputs?: TaskInputReader<Answer>;
}) {
  if (!isStrictAiTaskTransactionBoundary(input?.transactions) || typeof input.actions?.resolve !== 'function'
    || typeof input.execution?.authorize !== 'function' || typeof input.tools?.resolve !== 'function'
    || input.invocations && typeof input.dispatchEvidence?.readDispatch !== 'function')
    throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
  const { db, scopes, transactions, planAuthority, controlResourceOrigin, monotonic, dispatchEvidence } = input;
  const wall = input.wall ?? (() => new Date());
  const tasks = new TaskPersistenceRepository(db, input.actions, wall, transactions);
  const evidence = new TaskRunEvidenceRepository(db, scopes, planAuthority, wall, monotonic,
    dispatchEvidence, controlResourceOrigin, transactions, true);
  const { plans, resources } = createPublicAiTaskRunnerResources({ ...input, wall, tasks, bindEffectEvidence(observe) {
    evidence.bindToolActivityObserver(observe);
    return evidence;
  } });
  const effects = new TaskMeasuredEffects(db, tasks, evidence, input.tools, input.execution, input.inputs, wall, () => false, true);
  return Object.freeze({ plans, resources, effects, tasks: {
    readMetadata: tasks.readMetadata.bind(tasks), claimRun: tasks.claimRun.bind(tasks), claimRecoveryRun: tasks.claimRecoveryRun.bind(tasks),
    assertRecoveryRun: tasks.assertRecoveryRun.bind(tasks), releaseRun: tasks.releaseRun.bind(tasks)
  } });
}
