import type { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import type { AiTaskRepository } from '../ai-task.repository';
import type { AiTaskRunnerOutcomePort, AiTaskRunnerTaskOutcome } from './ai-task-runner.ports';
import { AI_TASK_DRAFT_VERSION, type AiTaskEventDraft } from '@rental-os/shared';
import { isDeepStrictEqual } from 'node:util';
import { AiTaskRunnerError } from './ai-task-runner.service';

export interface AiTaskRunnerOutcomeCommandFactory {
  transition(input: Readonly<{
    taskId: string;
    expectedRevision: number;
    to: 'running' | 'succeeded' | 'failed' | 'partially_succeeded' | 'waiting_input' | 'waiting_confirmation' | 'waiting_external' | 'cancelled';
    reason: 'start' | 'resume' | 'completed' | 'execution_failed' | 'input_required' | 'confirmation_required' | 'external_pending' | 'cancel_settled';
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
  const command = (input: Parameters<AiTaskRunnerOutcomeCommandFactory['transition']>[0]) => {
    const expected = structuredClone(input);
    const prepared = structuredClone(adapters.commands.transition(structuredClone(expected)));
    if (!isDeepStrictEqual(prepared, expected)) throw new AiTaskRunnerError('AI_INVALID_INPUT');
    return prepared;
  };
  const observe = (value: Awaited<ReturnType<AiTaskTransitionRepository['transition']>>) => {
    try { return structuredClone(value); } catch { throw unknown(); }
  };
  const unknown = () => new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'aggregate transition acknowledgement requires original receipt');
  return {
    async start(input) {
      input = structuredClone(input);
      if (input.taskId !== input.lease.taskId) throw new AiTaskRunnerError('AI_INVALID_INPUT');
      const result = observe(await adapters.transitions.transition(command({ taskId: input.taskId,
        expectedRevision: input.taskRevision, to: 'running', reason: 'start', lease: { runId: input.lease.runId,
          holderId: input.lease.holderId, revision: input.lease.revision, fencingToken: input.lease.fencingToken } })));
      if (!matchesAcknowledgement(result, input.taskId, input.taskRevision, input.lease.revision, ['running'], 'start')
        || result.runRevision === null || result.event.type !== 'task.transition' || result.event.data.from !== 'queued') throw unknown();
      return { taskRevision: result.event.taskRevision, lease: { ...input.lease, revision: result.runRevision } };
    },
    async commit(input) {
      input = structuredClone(input);
      if (input.taskId !== input.lease.taskId) throw new AiTaskRunnerError('AI_INVALID_INPUT');
      let resumeReceipt: import('./ai-task-runner.ports').AiTaskRunnerStepCommit | undefined;
      if (adapters.tasks && (input.outcome.status === 'succeeded' || input.outcome.status === 'failed')) {
        const metadata = await adapters.tasks.readMetadata(input.taskId);
        if (metadata.taskId !== input.taskId || metadata.revision !== input.taskRevision) throw new Error('AI_STORAGE_UNAVAILABLE');
        if (metadata.status === 'waiting_external') {
          const resumed = observe(await adapters.transitions.transition(command({ taskId: input.taskId,
            expectedRevision: input.taskRevision, to: 'running', reason: 'resume', lease: { runId: input.lease.runId,
              holderId: input.lease.holderId, revision: input.lease.revision, fencingToken: input.lease.fencingToken } })));
          if (!matchesAcknowledgement(resumed, input.taskId, input.taskRevision, input.lease.revision, ['running'], 'resume')
            || resumed.runRevision === null || resumed.event.type !== 'task.transition' || resumed.event.data.from !== 'waiting_external') throw unknown();
          // Preserve both original acknowledgements. Returning only the final
          // revision would hide this CAS from the runner's exact receipt checks.
          resumeReceipt = { taskRevision: resumed.event.taskRevision, lease: { ...input.lease, revision: resumed.runRevision } };
          input.taskRevision = resumed.event.taskRevision;
          input.lease.revision = resumed.runRevision;
        }
      }
      const next = target(input.outcome);
      const prepared = command({ taskId: input.taskId, expectedRevision: input.taskRevision, ...next,
        lease: { runId: input.lease.runId, holderId: input.lease.holderId, revision: input.lease.revision, fencingToken: input.lease.fencingToken } });
      const result = observe(input.outcome.status === 'cancelled' && adapters.transitions.settleCancellation
        ? await adapters.transitions.settleCancellation(prepared) : await adapters.transitions.transition(prepared));
      const runRevision = result?.runRevision;
      const nextRunRevision = typeof runRevision === 'number' ? runRevision : null;
      // Cancellation settlement may truthfully report committed/partial work;
      // ordinary completion must not accept a different task/state acknowledgement.
      const allowed = input.outcome.status === 'cancelled' ? ['cancelled', 'succeeded', 'partially_succeeded']
        : input.outcome.status === 'failed' ? [next.to, 'partially_succeeded'] : [next.to];
      const persistedPartial = input.outcome.status === 'failed' && result?.event?.type === 'task.transition'
        && result.event.data?.to === 'partially_succeeded';
      if (!matchesAcknowledgement(result, input.taskId, input.taskRevision, input.lease.revision, allowed, persistedPartial ? 'completed' : next.reason)
        || nextRunRevision === null) throw unknown();
      const status = result.event.type === 'task.transition' ? result.event.data.to : undefined;
      const outcomeStatus = status === 'succeeded' || status === 'partially_succeeded' || status === 'cancelled' ? status : undefined;
      return { taskRevision: result.event.taskRevision, lease: { ...input.lease, revision: nextRunRevision },
        ...(resumeReceipt ? { resumed: resumeReceipt } : {}), ...(outcomeStatus ? { outcomeStatus } : {}) };
    }
  };
}

function matchesAcknowledgement(result: { event: AiTaskEventDraft; runRevision: number | null } | undefined,
  taskId: string, taskRevision: number, runRevision: number, allowed: readonly string[], reason: string) {
  const event = result?.event;
  return event?.contractVersion === AI_TASK_DRAFT_VERSION && event.taskId === taskId && event.type === 'task.transition'
    && event.taskRevision === taskRevision + 1 && result?.runRevision === runRevision + 1
    && !!event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    && typeof event.cursor === 'string' && /^[1-9][0-9]{0,19}$/u.test(event.cursor) && BigInt(event.cursor) <= 18446744073709551615n
    && typeof event.occurredAt === 'string' && Number.isFinite(Date.parse(event.occurredAt))
    && allowed.includes(event.data.to) && event.data.reason === reason;
}
