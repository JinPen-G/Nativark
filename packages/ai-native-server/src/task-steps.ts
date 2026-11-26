/** Public assembly of the original step registration, transition and receipts.
 * The host owns current action evidence and a fixed published tool catalogue. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { isStrictAiTaskTransactionBoundary, type AiTaskTransactionBoundary } from './task-transactions';
import { AiTaskRepositoryError } from './task-errors';
import { TaskStepRegistrationRepository, type AiStepRegistrationAuthority, type AiStepReplayAuthority } from './runtime/task-step-registration.repository';
import { TaskStepTransitionRepository, type AiStepTransitionAuthority } from './runtime/task-step-transition.repository';
import { isPublicAiStepState } from './runtime/task-step-state-validation';
import type { AiStepStateDraft } from '@rental-os/platform-contracts/ai-task';
import { createAiTaskRunnerRepositoryPorts, type AiTaskRunnerRepositoryAdapters } from './runtime/runner/ai-task-runner.repository-adapter';
import type { AiTaskRepositoryAuthority } from './task-persistence';

export { aiStepActionId, AiStepOriginalRegistrationUnavailableError, AiStepRegistrationCommitUnknownError,
  type AiStepRegistrationCommand, type AiStepRegistrationAuthority, type AiStepOriginalRegistrationGrant,
  type AiStepReplayCommand, type AiStepReplayAuthority } from './runtime/task-step-registration.repository';
export { AiStepTransitionResultUnknownError, type AiStepTransitionCommand, type AiStepTransitionAuthority,
  type AiStepTransitionGrant } from './runtime/task-step-transition.repository';
export type { AiTaskRunnerRepositoryCommandFactory } from './runtime/runner/ai-task-runner.repository-adapter';

export function createPublicAiTaskSteps(input: {
  db: Pick<PrismaClient, '$transaction'>;
  transactions: AiTaskTransactionBoundary<Prisma.TransactionClient>;
  registration: Required<AiStepRegistrationAuthority>;
  replay: AiStepReplayAuthority;
  transition: AiStepTransitionAuthority;
  /** Current read_step_terminal authority for a committed acknowledgement. */
  delivery: AiTaskRepositoryAuthority;
  /** Only a server-owned scene/tool publication may supply this catalogue. */
  admitsTool(toolCode: string, toolVersion: string): boolean;
  clock?: () => Date;
  newId?: () => string;
}) {
  if (!isStrictAiTaskTransactionBoundary(input?.transactions) || typeof input.db?.$transaction !== 'function'
    || typeof input.registration?.resolveOriginal !== 'function' || typeof input.replay?.resolve !== 'function'
    || typeof input.delivery?.resolve !== 'function' || typeof input.admitsTool !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const { db, transactions, registration, replay, transition, admitsTool, newId, delivery } = input;
  const clock = input.clock ?? (() => new Date());
  const registrations = new TaskStepRegistrationRepository(db, registration, clock, newId, replay, transactions, admitsTool, true);
  const transitions = new TaskStepTransitionRepository(db, transition, clock, transactions,
    (value): value is AiStepStateDraft => isPublicAiStepState(value) && admitsTool(value.toolCode, value.toolVersion) === true, delivery);
  return Object.freeze({ register: registrations.register.bind(registrations), readReplay: registrations.readReplay.bind(registrations),
    transition: transitions.transition.bind(transitions) });
}

/** Bind repository acknowledgements to the original Runner lease and revisions. */
export function createPublicAiTaskRunnerStepPorts(input: ReturnType<typeof createPublicAiTaskSteps>,
  adapters: Pick<AiTaskRunnerRepositoryAdapters, 'tasks' | 'commands'>) {
  return createAiTaskRunnerRepositoryPorts({ ...adapters, confirmation: undefined, registrations: input, replays: input, transitions: input });
}
