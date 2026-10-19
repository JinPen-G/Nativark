import type { AiTaskRunnerDependencies, AiTaskRunnerLease, AiTaskRunnerPlanPort, AiTaskRunnerStepCommit, AiTaskRunnerStepPlan, AiTaskRunnerStepPort, AiTaskRunnerStepRef, AiTaskRunnerConfirmationContinuation } from "./ai-task-runner.ports";
import type { AiTaskRepository } from "../ai-task.repository";
import type { AiStepRegistrationCommand, AiStepRegistrationRepository } from "../ai-step-registration.repository";
import type { AiStepTransitionCommand, AiStepTransitionRepository } from "../ai-step-transition.repository";
import { AI_STEP_STATUSES_DRAFT, AI_TASK_STATUSES_DRAFT, AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, type AiTaskStatusDraft, type AiTaskEventDraft, type AiStepStatusDraft } from "@rental-os/shared";
import { AiTaskRunnerError } from './ai-task-runner.service';

/**
 * The only runner-to-persistence wiring point. The command factory belongs to the
 * authorized application composition root: it supplies evidence IDs and expected
 * revisions, while the existing repositories re-authorize and CAS at commit time.
 */
export interface AiTaskRunnerRepositoryCommandFactory {
  register(plan: AiTaskRunnerStepPlan, lease: AiTaskRunnerLease): AiStepRegistrationCommand | Promise<AiStepRegistrationCommand>;
  transition(kind: "start" | "succeed" | "fail" | "pause" | "unknown", step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, resultRef: string | null, errorCode?: string, pause?: "input" | "confirmation" | "external"): AiStepTransitionCommand;
}

export interface AiTaskRunnerConfirmationCheckpointPort {
  pause(input: {
    taskId: string; stepId: string; expectedTaskRevision: number; expectedStepRevision: number;
    checkpointRef: string; lease: AiTaskRunnerLease;
  }): Promise<{
    event: AiTaskEventDraft; runId: string; runRevision: number;
    stepId: string; stepRevision: number; checkpointRef: string;
  }>;
  resume?(input: Parameters<AiTaskRunnerConfirmationCheckpointPort['pause']>[0]): Promise<
    Awaited<ReturnType<AiTaskRunnerConfirmationCheckpointPort['pause']>> & AiTaskRunnerConfirmationContinuation>;
}

export interface AiTaskRunnerRepositoryAdapters {
  tasks: Pick<AiTaskRepository, "readMetadata" | "claimRun" | "claimRecoveryRun" | "releaseRun"> & Partial<Pick<AiTaskRepository, 'assertRecoveryRun'>>;
  registrations: Pick<AiStepRegistrationRepository, "register">;
  replays?: Pick<AiStepRegistrationRepository, "readReplay">;
  transitions: Pick<AiStepTransitionRepository, "transition">;
  commands: AiTaskRunnerRepositoryCommandFactory;
  confirmation?: AiTaskRunnerConfirmationCheckpointPort;
}

function committed(value: { runRevision: number; event: AiTaskEventDraft }, previous: AiTaskRunnerLease,
  ref: AiTaskRunnerStepRef, expectedStatus?: AiStepStatusDraft): AiTaskRunnerStepCommit {
  const event = value?.event;
  if (!event || event.contractVersion !== AI_TASK_DRAFT_VERSION || event.type !== 'step.changed'
    || event.taskId !== previous.taskId || event.data.runId !== previous.runId || ref.registered.runId !== previous.runId
    || event.data.stepId !== ref.registered.stepId || event.taskRevision !== ref.registered.taskRevision + 1
    || event.data.stepRevision !== ref.registered.stepRevision + 1 || value.runRevision !== previous.revision + 1
    || (expectedStatus && event.data.status !== expectedStatus)) throw new Error('AI_STORAGE_UNAVAILABLE');
  return { lease: { ...previous, revision: value.runRevision }, taskRevision: value.event.taskRevision };
}

/**
 * Adapts the already-persistent C04 repositories; it does not provide an in-memory
 * fallback, a default authority, a second state machine, or a Gateway implementation.
 */
export function createAiTaskRunnerRepositoryPorts(adapters: AiTaskRunnerRepositoryAdapters): Pick<AiTaskRunnerDependencies, "leases" | "steps" | 'confirmation'> {
  const commands = adapters.commands;
  const transition = async (kind: Parameters<AiTaskRunnerRepositoryCommandFactory['transition']>[0],
    ref: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, resultRef: string | null, errorCode?: string,
    pause?: 'input' | 'confirmation' | 'external') => {
    ref = structuredClone(ref); lease = structuredClone(lease);
    const command = structuredClone(commands.transition(kind, structuredClone(ref), structuredClone(lease), resultRef, errorCode, pause));
    const result = await adapters.transitions.transition(command);
    const status = kind === 'start' ? 'running' : kind === 'succeed' ? 'succeeded' : kind === 'fail' ? 'failed' : kind === 'unknown' ? 'unknown' : undefined;
    return committed(result, lease, ref, status);
  };
  const steps: AiTaskRunnerStepPort = {
    async register(plan, lease, existingOnly = false) {
      plan = structuredClone(plan); lease = structuredClone(lease);
      const command = structuredClone(await commands.register(structuredClone(plan), structuredClone(lease)));
      if (command.taskId !== lease.taskId || command.registrationRef !== plan.registrationRef
        || command.lease.runId !== lease.runId || command.lease.holderId !== lease.holderId
        || command.lease.revision !== lease.revision || command.lease.fencingToken !== lease.fencingToken) throw new Error('AI_INVALID_INPUT');
      const observed = await adapters.registrations.register(structuredClone(command), existingOnly);
      let result: typeof observed;
      const unknown = () => new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'step registration acknowledgement requires original receipt');
      try { result = structuredClone(observed); } catch { throw unknown(); }
      const validId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
      const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 4294967295;
      if (!result || typeof result.replayed !== 'boolean' || !validId(result.stepId) || result.runId !== lease.runId
        || !revision(result.sequence) || !revision(result.stepRevision) || !revision(result.taskRevision)) throw unknown();
      if (!result.replayed) {
        const event = result.event;
        // Registration may already be committed. Bind its public event and
        // exact new revisions before letting the runner adopt either one.
        if (existingOnly || result.stepRevision !== 1 || result.taskRevision !== command.expectedTaskRevision + 1
          || result.runRevision !== lease.revision + 1 || !event || event.contractVersion !== AI_TASK_DRAFT_VERSION
          || event.type !== 'step.registered' || event.taskId !== lease.taskId || event.taskRevision !== result.taskRevision
          || !event.data || typeof event.data !== 'object'
          || event.data.stepId !== result.stepId || event.data.runId !== lease.runId
          || event.data.sequence !== result.sequence || event.data.stepRevision !== 1
          || typeof event.cursor !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(event.cursor) || BigInt(event.cursor) > 18446744073709551615n
          || typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))) throw unknown();
      } else if (result.event !== null || result.runRevision != null || result.taskRevision < command.expectedTaskRevision) throw unknown();
      const replay = result.replayed && adapters.replays
        ? structuredClone(await adapters.replays.readReplay({ ...structuredClone(command), stepId: result.stepId, expectedStepRevision: result.stepRevision })) : null;
      if (replay && (replay.stepId !== result.stepId || replay.runId !== result.runId || replay.sequence !== result.sequence
        || replay.stepRevision !== result.stepRevision || !revision(replay.taskRevision) || replay.taskRevision < result.taskRevision
        || !AI_STEP_STATUSES_DRAFT.includes(replay.status))) throw unknown();
      return { stepId: result.stepId, runId: result.runId, sequence: result.sequence, stepRevision: result.stepRevision,
        taskRevision: replay?.taskRevision ?? result.taskRevision, runRevision: result.runRevision, replayed: result.replayed,
        existingStatus: result.replayed ? replay?.status ?? null : "pending", ...(replay ? { resultRef: replay.resultRef } : {}) };
    },
    async start(step, lease) {
      return transition('start', step, lease, null);
    },
    async succeed(step, lease, resultRef) {
      return transition('succeed', step, lease, resultRef);
    },
    async fail(step, lease, errorCode, resultRef) {
      return transition('fail', step, lease, resultRef, errorCode);
    },
    async pause(step, lease, pause, resultRef) {
      if (pause !== 'confirmation') return transition('pause', step, lease, resultRef, undefined, pause);
      const ref = structuredClone(step), held = structuredClone(lease);
      if (!resultRef || ref.plan.operation !== 'idempotent' || !['rental.order.commit', 'tenant.notifications.commit'].includes(ref.plan.toolCode)
        || ref.plan.toolVersion !== AI_TOOL_DRAFT_VERSION || typeof adapters.confirmation?.pause !== 'function') throw new Error('AI_RESOURCE_UNAVAILABLE');
      const value = structuredClone(await adapters.confirmation.pause({ taskId: held.taskId, stepId: ref.registered.stepId,
        expectedTaskRevision: ref.registered.taskRevision, expectedStepRevision: ref.registered.stepRevision,
        checkpointRef: resultRef, lease: structuredClone(held) }));
      const event = value?.event;
      if (!event || event.contractVersion !== AI_TASK_DRAFT_VERSION || event.type !== 'task.transition'
        || event.taskId !== held.taskId || event.taskRevision !== ref.registered.taskRevision + 1
        || event.data.from !== 'running' || event.data.to !== 'waiting_confirmation' || event.data.reason !== 'confirmation_required'
        || value.runId !== held.runId || ref.registered.runId !== held.runId || value.runRevision !== held.revision + 1
        || value.stepId !== ref.registered.stepId || value.stepRevision !== ref.registered.stepRevision
        || value.checkpointRef !== resultRef) throw new Error('AI_STORAGE_UNAVAILABLE');
      return { lease: { ...held, revision: value.runRevision }, taskRevision: event.taskRevision,
        confirmation: { stepId: value.stepId, stepRevision: value.stepRevision, checkpointRef: value.checkpointRef } };
    },
    async unknown(step, lease, resultRef) {
      return transition('unknown', step, lease, resultRef);
    }
  };
  const resume = typeof adapters.confirmation?.resume === 'function' ? adapters.confirmation.resume.bind(adapters.confirmation) : null;
  return {
    confirmation: resume ? { resume: async value => {
      const input = structuredClone(value), held = input.lease;
      const result = structuredClone(await resume(structuredClone(input))), event = result?.event;
      if (!event || event.contractVersion !== AI_TASK_DRAFT_VERSION || event.type !== 'task.transition'
        || input.taskId !== held.taskId || event.taskId !== input.taskId || event.taskRevision !== input.expectedTaskRevision + 1
        || event.data.from !== 'waiting_confirmation' || event.data.to !== 'running' || event.data.reason !== 'resume'
        || result.runId !== held.runId || result.runRevision !== held.revision + 1 || result.stepId !== input.stepId
        || result.stepRevision !== input.expectedStepRevision || result.checkpointRef !== input.checkpointRef
        || !['approved', 'rejected'].includes(result.decision) || typeof result.decisionRef !== 'string' || !result.decisionRef
        || !Number.isSafeInteger(result.remainingActiveMs) || result.remainingActiveMs < 1 || result.remainingActiveMs > 86400000
        || !Number.isSafeInteger(result.remainingOutputBytes) || result.remainingOutputBytes < 1 || result.remainingOutputBytes > 16777216) throw new Error('AI_STORAGE_UNAVAILABLE');
      return { lease: { ...held, revision: result.runRevision }, taskRevision: event.taskRevision,
        continuation: { stepId: result.stepId, stepRevision: result.stepRevision, checkpointRef: result.checkpointRef,
          decisionRef: result.decisionRef, decision: result.decision, remainingActiveMs: result.remainingActiveMs, remainingOutputBytes: result.remainingOutputBytes } };
    } } : undefined,
    leases: {
      async readMetadata(taskId) {
        const metadata = await adapters.tasks.readMetadata(taskId);
        if (!AI_TASK_STATUSES_DRAFT.includes(metadata.status as AiTaskStatusDraft)) throw new Error("AI_RESOURCE_UNAVAILABLE");
        return { taskId: metadata.taskId, status: metadata.status as AiTaskStatusDraft, revision: metadata.revision, cancelRequestedAt: metadata.cancelRequestedAt };
      },
      claimRun: input => adapters.tasks.claimRun(input),
      claimRecoveryRun: input => adapters.tasks.claimRecoveryRun(input),
      ...(typeof adapters.tasks.assertRecoveryRun === 'function' ? { assertRecoveryRun: (lease: Parameters<AiTaskRepository['assertRecoveryRun']>[0]) => adapters.tasks.assertRecoveryRun!(lease) } : {}),
      releaseRun: input => adapters.tasks.releaseRun(input)
    },
    steps
  };
}
