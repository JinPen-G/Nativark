import type { AiTaskRunnerDependencies, AiTaskRunnerLease, AiTaskRunnerPlanPort, AiTaskRunnerStepCommit, AiTaskRunnerStepPlan, AiTaskRunnerStepPort, AiTaskRunnerStepRef } from "./ai-task-runner.ports";
import type { AiTaskRepository } from "../ai-task.repository";
import type { AiStepRegistrationCommand, AiStepRegistrationRepository } from "../ai-step-registration.repository";
import type { AiStepTransitionCommand, AiStepTransitionRepository } from "../ai-step-transition.repository";
import { AI_TASK_STATUSES_DRAFT, type AiTaskStatusDraft } from "@rental-os/shared";

/**
 * The only runner-to-persistence wiring point. The command factory belongs to the
 * authorized application composition root: it supplies evidence IDs and expected
 * revisions, while the existing repositories re-authorize and CAS at commit time.
 */
export interface AiTaskRunnerRepositoryCommandFactory {
  register(plan: AiTaskRunnerStepPlan, lease: AiTaskRunnerLease): AiStepRegistrationCommand;
  transition(kind: "start" | "succeed" | "fail" | "pause" | "unknown", step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, resultRef: string | null, errorCode?: string, pause?: "input" | "confirmation" | "external"): AiStepTransitionCommand;
}

export interface AiTaskRunnerRepositoryAdapters {
  tasks: Pick<AiTaskRepository, "readMetadata" | "claimRun" | "claimRecoveryRun" | "releaseRun">;
  registrations: Pick<AiStepRegistrationRepository, "register">;
  replays?: Pick<AiStepRegistrationRepository, "readReplay">;
  transitions: Pick<AiStepTransitionRepository, "transition">;
  commands: AiTaskRunnerRepositoryCommandFactory;
}

function committed(value: { runRevision: number; event: { taskRevision: number } }, previous: AiTaskRunnerLease): AiTaskRunnerStepCommit {
  return { lease: { ...previous, revision: value.runRevision }, taskRevision: value.event.taskRevision };
}

/**
 * Adapts the already-persistent C04 repositories; it does not provide an in-memory
 * fallback, a default authority, a second state machine, or a Gateway implementation.
 */
export function createAiTaskRunnerRepositoryPorts(adapters: AiTaskRunnerRepositoryAdapters): Pick<AiTaskRunnerDependencies, "leases" | "steps"> {
  const commands = adapters.commands;
  const steps: AiTaskRunnerStepPort = {
    async register(plan, lease) {
      const command = structuredClone(commands.register(structuredClone(plan), structuredClone(lease)));
      const result = await adapters.registrations.register(command);
      const replay = result.replayed && adapters.replays
        ? await adapters.replays.readReplay({ ...command, stepId: result.stepId, expectedStepRevision: result.stepRevision }) : null;
      if (replay && (replay.stepId !== result.stepId || replay.runId !== result.runId || replay.sequence !== result.sequence
        || replay.stepRevision !== result.stepRevision)) throw new Error("AI_STORAGE_UNAVAILABLE");
      return { stepId: result.stepId, runId: result.runId, sequence: result.sequence, stepRevision: result.stepRevision,
        taskRevision: replay?.taskRevision ?? result.taskRevision, runRevision: result.runRevision, replayed: result.replayed,
        existingStatus: result.replayed ? replay?.status ?? null : "pending", ...(replay ? { resultRef: replay.resultRef } : {}) };
    },
    async start(step, lease) {
      return committed(await adapters.transitions.transition(commands.transition("start", step, lease, null)), lease);
    },
    async succeed(step, lease, resultRef) {
      return committed(await adapters.transitions.transition(commands.transition("succeed", step, lease, resultRef)), lease);
    },
    async fail(step, lease, errorCode, resultRef) {
      return committed(await adapters.transitions.transition(commands.transition("fail", step, lease, resultRef, errorCode)), lease);
    },
    async pause(step, lease, pause, resultRef) {
      return committed(await adapters.transitions.transition(commands.transition("pause", step, lease, resultRef, undefined, pause)), lease);
    },
    async unknown(step, lease, resultRef) {
      return committed(await adapters.transitions.transition(commands.transition("unknown", step, lease, resultRef)), lease);
    }
  };
  return {
    leases: {
      async readMetadata(taskId) {
        const metadata = await adapters.tasks.readMetadata(taskId);
        if (!AI_TASK_STATUSES_DRAFT.includes(metadata.status as AiTaskStatusDraft)) throw new Error("AI_RESOURCE_UNAVAILABLE");
        return { taskId: metadata.taskId, status: metadata.status as AiTaskStatusDraft, revision: metadata.revision, cancelRequestedAt: metadata.cancelRequestedAt };
      },
      claimRun: input => adapters.tasks.claimRun(input),
      claimRecoveryRun: input => adapters.tasks.claimRecoveryRun(input),
      releaseRun: input => adapters.tasks.releaseRun(input)
    },
    steps
  };
}
