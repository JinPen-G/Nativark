import type { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import type { AiTaskRepository } from '../ai-task.repository';
import type { AiTaskRunnerOutcomePort, AiTaskRunnerTaskOutcome } from './ai-task-runner.ports';

export interface AiTaskRunnerOutcomeCommandFactory {
  transition(input: Readonly<{
    taskId: string;
    expectedRevision: number;
    to: 'running' | 'succeeded' | 'failed' | 'partially_succeeded' | 'waiting_input' | 'waiting_confirmation' | 'waiting_external' | 'cancelled';
    reason: 'resume' | 'completed' | 'execution_failed' | 'input_required' | 'confirmation_required' | 'external_pending' | 'cancel_settled';
    lease: Readonly<{ runId: string; holderId: string; revision: number; fencingToken: string }>;
  }>): unknown;
}

export interface AiTaskRunnerOutcomeAdapters {
  transitions: Pick<AiTaskTransitionRepository, 'transition'> & Partial<Pick<AiTaskTransitionRepository, 'settleCancellation'>>;
  commands: AiTaskRunnerOutcomeCommandFactory;
  tasks?: Pick<AiTaskRepository, 'readMetadata'>;
}

function target(outcome: AiTaskRunnerTaskOutcome) {
  if (outcome.status === 'cancelled') return { to: 'cancelled' as const, reason: 'cancel_settled' as const };
  if (outcome.status === 'succeeded') return { to: 'succeeded' as const, reason: 'completed' as const };
  if (outcome.status === 'failed') return outcome.completedSteps > 0
    ? { to: 'partially_succeeded' as const, reason: 'completed' as const }
    : { to: 'failed' as const, reason: 'execution_failed' as const };
  if (outcome.status === 'unknown') return { to: 'waiting_external' as const, reason: 'external_pending' as const };
  if (outcome.status !== 'paused') throw new Error('AI_INVALID_INPUT');
  return outcome.pause === 'input'
    ? { to: 'waiting_input' as const, reason: 'input_required' as const }
    : outcome.pause === 'confirmation'
      ? { to: 'waiting_confirmation' as const, reason: 'confirmation_required' as const }
      : { to: 'waiting_external' as const, reason: 'external_pending' as const };
}

/** Adapts runner outcomes to the existing task transition repository only. */
export function createAiTaskRunnerOutcomePort(adapters: AiTaskRunnerOutcomeAdapters): AiTaskRunnerOutcomePort {
  if (!adapters?.transitions?.transition || !adapters.commands?.transition) throw new Error('AI_RESOURCE_UNAVAILABLE');
  return {
    async commit(input) {
      input = structuredClone(input);
      if (adapters.tasks && (input.outcome.status === 'succeeded' || input.outcome.status === 'failed')) {
        const metadata = await adapters.tasks.readMetadata(input.taskId);
        if (metadata.taskId !== input.taskId || metadata.revision !== input.taskRevision) throw new Error('AI_STORAGE_UNAVAILABLE');
        if (metadata.status === 'waiting_external') {
          const resumed = await adapters.transitions.transition(adapters.commands.transition({ taskId: input.taskId,
            expectedRevision: input.taskRevision, to: 'running', reason: 'resume', lease: { runId: input.lease.runId,
              holderId: input.lease.holderId, revision: input.lease.revision, fencingToken: input.lease.fencingToken } }));
          if (!resumed.event || resumed.event.taskRevision !== input.taskRevision + 1 || resumed.runRevision !== input.lease.revision + 1) throw new Error('AI_STORAGE_UNAVAILABLE');
          input.taskRevision = resumed.event.taskRevision;
          input.lease.revision = resumed.runRevision;
        }
      }
      const next = target(input.outcome);
      const command = adapters.commands.transition({ taskId: input.taskId, expectedRevision: input.taskRevision, ...next,
        lease: { runId: input.lease.runId, holderId: input.lease.holderId, revision: input.lease.revision, fencingToken: input.lease.fencingToken } });
      const result = input.outcome.status === 'cancelled' && adapters.transitions.settleCancellation
        ? await adapters.transitions.settleCancellation(command) : await adapters.transitions.transition(command);
      const runRevision = result?.runRevision;
      const nextRunRevision = typeof runRevision === 'number' ? runRevision : null;
      if (!result || !result.event || result.event.taskRevision !== input.taskRevision + 1
        || nextRunRevision === null || !Number.isSafeInteger(nextRunRevision) || nextRunRevision <= input.lease.revision) throw new Error('AI_STORAGE_UNAVAILABLE');
      const status = result.event.type === 'task.transition' ? result.event.data.to : undefined;
      const outcomeStatus = status === 'succeeded' || status === 'partially_succeeded' || status === 'cancelled' ? status : undefined;
      return { taskRevision: result.event.taskRevision, lease: { ...input.lease, revision: nextRunRevision }, ...(outcomeStatus ? { outcomeStatus } : {}) };
    }
  };
}
