import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiStepRegistrationRepository, type AiStepRegistrationAuthority } from '../ai-step-registration.repository';
import { AiStepTransitionRepository, type AiStepTransitionAuthority } from '../ai-step-transition.repository';
import { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import { composePersistentTaskInputRunner } from '../task-input/persistent-task-input.composition';
import type { AiTaskInputSource } from '../task-input/task-input.ports';
import type { PersistentTaskRunnerComposition } from './persistent-task-runner.composition';
import { createAiTaskRunnerOutcomePort } from './ai-task-runner-outcome-adapter';

export interface AuthorizedPersistentTaskInputComposition extends Omit<PersistentTaskRunnerComposition,
  'tasks' | 'executionAuthorization' | 'registrations' | 'replays' | 'transitions' | 'taskOutcome' | 'inputs'> {
  authorization: Omit<PersistedTaskAuthorizationDependencies, 'db' | 'clock'>;
  registrationAuthority: AiStepRegistrationAuthority;
  transitionAuthority: AiStepTransitionAuthority;
  inputSource: AiTaskInputSource;
}

export function composeAuthorizedPersistentTaskInputRunner(input: AuthorizedPersistentTaskInputComposition) {
  if (typeof input?.registrationAuthority?.resolve !== 'function' || typeof input?.transitionAuthority?.resolve !== 'function'
    || !input?.authorization) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const authorization = composePersistedTaskAuthorization({ ...input.authorization, db: input.db, clock: input.wall });
  const registrations = new AiStepRegistrationRepository(input.db, input.registrationAuthority, input.wall, undefined,
    { resolve: command => authorization.authority.resolve(command.taskId, 'read_step_terminal') });
  const transitions = new AiStepTransitionRepository(input.db, input.transitionAuthority, input.wall);
  const taskTransitions = new AiTaskTransitionRepository(input.db, authorization.authority, input.wall);
  const taskOutcome = createAiTaskRunnerOutcomePort({ transitions: taskTransitions, tasks: authorization.tasks,
    commands: { transition: command => command } });
  const composed = composePersistentTaskInputRunner({ ...input, tasks: authorization.tasks,
    executionAuthorization: authorization.execution, registrations, replays: registrations, transitions, taskOutcome });
  return Object.freeze({ ...composed, authorization, registrations, transitions, taskTransitions });
}
