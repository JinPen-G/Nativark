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
import { AiTaskTakeoverCommitUnknownError, PrismaTaskTakeoverRepository } from './prisma-task-takeover.repository';
import type { AiTaskRunnerClaimInput, AiTaskRunnerOutcome } from './ai-task-runner.ports';
import { AiTaskRunnerError, callAiTaskRunnerDependency, snapshotAiTaskRunnerRecoveryLease, type AiTaskHeldPreparation } from './ai-task-runner.service';
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
    let lease;
    try {
      // Await the explicit fencing request independently of host disconnect.
      // Only its acknowledged result can be handed to recovery; a deadline
      // aborts late pre-write work, but never grants a lease by rereading it.
      const original = structuredClone(command);
      const observed = await callAiTaskRunnerDependency(child => takeovers.takeover(structuredClone(original), child), 5000, 'takeover', undefined, input.clock);
      // The original repository has validated this command. Preserve that
      // exact CAS across the await before handing its reply to cleanup/recovery.
      lease = snapshotAiTaskRunnerRecoveryLease(original as AiTaskRunnerClaimInput, observed);
    } catch (error) {
      if (error instanceof AiTaskRunnerError && (error.code === 'AI_RUN_LIMIT' || error.code === 'AI_RESULT_UNKNOWN')) {
        throw new AiTaskTakeoverCommitUnknownError();
      }
      throw error;
    }
    let runnerOwnsLease = false;
    try {
      if (signal?.aborted) return { status: 'unavailable', completedSteps: 0, cleanupFailed: 0 };
      return await composed.runner.recover(lease, signal, () => { runnerOwnsLease = true; });
    } finally {
      if (!runnerOwnsLease) {
        // Recovery's preflight only read metadata. The acknowledged takeover
        // still owns this exact generation; no recovery write was attempted.
        // Once runHeld accepts it, its own finally is the sole cleanup owner.
        try {
          await callAiTaskRunnerDependency(async child => {
            const current = structuredClone(await authorization.tasks.readMetadata(lease.taskId));
            if (child.aborted || current.taskId !== lease.taskId) throw new AiTaskTakeoverCommitUnknownError();
            const release = { taskId: lease.taskId, runId: lease.runId, holderId: lease.holderId,
              expectedTaskRevision: current.revision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken };
            const receipt = structuredClone(await authorization.tasks.releaseRun(structuredClone(release)));
            if (child.aborted || !receipt || receipt.released !== true || receipt.revision !== release.expectedRunRevision + 1) {
              throw new AiTaskTakeoverCommitUnknownError();
            }
          }, 5000, 'takeover_cleanup', undefined, input.clock);
        } catch { throw new AiTaskTakeoverCommitUnknownError(); }
      }
    }
  };
  const readTakeoverReceipt = async (command: unknown, signal?: AbortSignal) => {
    const original = structuredClone(command);
    try { return await callAiTaskRunnerDependency(() => takeovers.readReceipt(original), 5000, 'takeover_receipt', signal, input.clock); }
    catch (error) {
      if (error instanceof AiTaskRunnerError && (error.code === 'AI_RUN_LIMIT' || error.code === 'AI_RESULT_UNKNOWN')) {
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      }
      throw error;
    }
  };
  const recovery = new PrismaTaskRecoverySnapshotRepository(input.db, authorization.tasks);
  const events = new AiTaskEventRepository(input.db, authorization.authority, input.wall);
  const results = new AiTaskResultRepository(input.db, authorization.tasks, input.wall);
  const createApplication = (host: AiTaskApplicationHost, prepare?: AiTaskHeldPreparation) => new PrismaTaskApplication({ db: input.db, tasks: authorization.tasks,
    runner: composed.runner, inputs: composed.inputs, recovery, events, host, prepare, clock: input.clock });
  return Object.freeze({ ...composed, authorization, registrations, transitions, taskTransitions, takeoverAndRecover,
    readTakeoverReceipt, recovery, events, results, createApplication });
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
