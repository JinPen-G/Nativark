import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { AiTaskRepository, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import type { AiScopeRepository } from '../ai-scope.repository';
import type { AiTaskExecutionAuthorization } from './prisma-task-measured-effects';
import { AiStepRegistrationRepository, type AiStepRegistrationAuthority } from '../ai-step-registration.repository';
import { AiStepTransitionRepository, type AiStepTransitionAuthority } from '../ai-step-transition.repository';
import { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import { AiTaskEventRepository } from '../ai-task-event.repository';
import { AiTaskResultRepository } from './ai-task-result.repository';
import { PrismaTaskRecoverySnapshotRepository } from './prisma-task-recovery-snapshot.repository';
import { composePersistentTaskInputRunner } from '../task-input/persistent-task-input.composition';
import type { AiTaskInputSource } from '../task-input/task-input.ports';
import type { PersistentTaskRunnerComposition } from './persistent-task-runner.composition';
import { createAiTaskRunnerOutcomePort } from './ai-task-runner-outcome-adapter';
import { PrismaTaskStepEvidenceAuthority } from './prisma-task-step-evidence.authority';
import { PrismaTaskTakeoverRepository } from './prisma-task-takeover.repository';
import type { AiTaskRunnerOutcome } from './ai-task-runner.ports';
import type { AiTaskHeldPreparation } from './ai-task-runner.service';
import { PrismaTaskApplication, type AiTaskApplicationHost } from './prisma-task-application';

export interface AuthorizedPersistentTaskInputComposition extends Omit<PersistentTaskRunnerComposition,
  'tasks' | 'executionAuthorization' | 'registrations' | 'replays' | 'transitions' | 'taskOutcome' | 'inputs' | 'confirmation' | 'orderEvidence'> {
  authorization: Omit<PersistedTaskAuthorizationDependencies, 'db' | 'clock'>;
  registrationAuthority: AiStepRegistrationAuthority;
  transitionAuthority: AiStepTransitionAuthority;
  inputSource: AiTaskInputSource;
}

export type CurrentPersistentTaskAuthorization = {
  scopes: AiScopeRepository; authority: AiTaskRepositoryAuthority;
  tasks: AiTaskRepository; execution: AiTaskExecutionAuthorization;
};

export function composeAuthorizedPersistentTaskInputRunner(input: AuthorizedPersistentTaskInputComposition) {
  if (typeof input?.registrationAuthority?.resolve !== 'function' || typeof input?.transitionAuthority?.resolve !== 'function'
    || !input?.authorization) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const authorization = composePersistedTaskAuthorization({ ...input.authorization, db: input.db, clock: input.wall });
  return composeCurrentAuthorizedPersistentTaskInputRunner(input, authorization);
}

/** Common assembly for an already server-bound current authority. Neither an
 * HTTP input nor a synthetic scope may construct this dependency. Customers
 * reuse the same repositories, resource ledger and execution engine. */
export function composeCurrentAuthorizedPersistentTaskInputRunner(
  input: Omit<AuthorizedPersistentTaskInputComposition, 'authorization'>,
  authorization: CurrentPersistentTaskAuthorization,
) {
  if (typeof authorization?.authority?.resolve !== 'function' || typeof authorization.execution?.authorize !== 'function'
    || typeof input?.registrationAuthority?.resolve !== 'function' || typeof input.transitionAuthority?.resolve !== 'function')
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const registrations = new AiStepRegistrationRepository(input.db, input.registrationAuthority, input.wall, undefined,
    { resolve: command => authorization.authority.resolve(command.taskId, 'read_step_terminal') });
  const transitions = new AiStepTransitionRepository(input.db, input.transitionAuthority, input.wall);
  const taskTransitions = new AiTaskTransitionRepository(input.db, authorization.authority, input.wall);
  const taskOutcome = createAiTaskRunnerOutcomePort({ transitions: taskTransitions, tasks: authorization.tasks,
    commands: { transition: command => command } });
  const composed = composePersistentTaskInputRunner({ ...input, tasks: authorization.tasks,
    executionAuthorization: authorization.execution, registrations, replays: registrations, transitions, taskOutcome });
  const takeovers = new PrismaTaskTakeoverRepository(input.db, authorization.authority, input.wall);
  const takeoverAndRecover = async (command: unknown, signal?: AbortSignal): Promise<AiTaskRunnerOutcome> => {
    if (signal?.aborted) return { status: 'unavailable', completedSteps: 0, cleanupFailed: 0 };
    const lease = await takeovers.takeover(command);
    return composed.runner.recover(lease, signal);
  };
  const recovery = new PrismaTaskRecoverySnapshotRepository(input.db, authorization.tasks);
  const events = new AiTaskEventRepository(input.db, authorization.authority, input.wall);
  const results = new AiTaskResultRepository(input.db, authorization.tasks, input.wall);
  const createApplication = (host: AiTaskApplicationHost, prepare?: AiTaskHeldPreparation) => new PrismaTaskApplication({ db: input.db, tasks: authorization.tasks,
    runner: composed.runner, inputs: composed.inputs, recovery, events, host, prepare });
  return Object.freeze({ ...composed, authorization, registrations, transitions, taskTransitions, takeoverAndRecover,
    readTakeoverReceipt: takeovers.readReceipt.bind(takeovers), recovery, events, results, createApplication });
}

/** Explicit read-only subset. Uses current persisted action authorization and
 * measured plan/result rows instead of caller-supplied transition outcomes.
 * Registration input, plan policy and executors remain mandatory dependencies.
 * Core writes and unknown reconciliation need their own existing evidence ports.
 */
export function composeAuthorizedReadonlyPersistentTaskInputRunner(
  input: Omit<AuthorizedPersistentTaskInputComposition, 'transitionAuthority'>,
) {
  const authorization = composePersistedTaskAuthorization({ ...input.authorization, db: input.db, clock: input.wall });
  const transitionAuthority = new PrismaTaskStepEvidenceAuthority(input.db, authorization.authority, input.planAuthority, input.wall);
  return composeAuthorizedPersistentTaskInputRunner({ ...input, transitionAuthority });
}
