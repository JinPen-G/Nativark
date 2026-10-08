import { Prisma, type PrismaClient, type AiTaskStatus } from "@prisma/client";
import { z } from "zod";
import {
  AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_TASK_TRANSITION_REASONS_DRAFT,
  type AiTaskEventDraft, type AiTaskTransitionRequestDraft, type AiStepStatusDraft, type AiStepStateDraft
} from "@rental-os/shared";
import { AiTaskRepository, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from "./ai-task.repository";
import { evaluateAiTaskTransitionDraft, type AiTaskTransitionStateDraft } from "./task-transition-draft";

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const leaseSchema = z.object({
  runId: id, holderId: id, revision,
  fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u)
}).strict();
const commandSchema = z.object({
  taskId: id, expectedRevision: revision,
  to: z.enum(AI_TASK_STATUSES_DRAFT), reason: z.enum(AI_TASK_TRANSITION_REASONS_DRAFT), lease: leaseSchema.optional()
}).strict().refine(value => value.to === "cancel_requested" ? value.lease === undefined : value.lease !== undefined);
const taskSelect = {
  id: true, scopeId: true, status: true, revision: true, contractVersion: true,
  eventCursor: true, cancelRequestedAt: true
} satisfies Prisma.AiTaskSelect;
const stepSelect = { id: true, runId: true, sequence: true, revision: true, actionId: true, status: true, effect: true } satisfies Prisma.AiStepSelect;
const maxCursor = 18446744073709551615n;
const conflict = () => new AiTaskRepositoryError("AI_REVISION_CONFLICT");

/**
 * Internal mutation path, deliberately not registered in a controller/worker.
 * All future step writers must lock/CAS the task row before changing its steps;
 * otherwise no aggregate task-state validation can be consistent with them.
 */
export class AiTaskTransitionRepository {
  private readonly access: AiTaskRepository;
  constructor(
    private readonly db: Pick<PrismaClient, "$transaction" | "aiTask" | "aiRun">,
    authority: AiTaskRepositoryAuthority,
    private readonly clock: () => Date = () => new Date()
  ) {
    this.access = new AiTaskRepository(db, authority, clock);
  }

  transition(value: unknown) { return this.transitionState(value, false); }

  settleCancellation(value: unknown) { return this.transitionState(value, true); }

  private async transitionState(value: unknown, settleCancellation: boolean) {
    const parsed = commandSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    const input = parsed.data;
    if (settleCancellation && (input.to !== 'cancelled' || input.reason !== 'cancel_settled')) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const initial = await this.access.resolveAccess(input.taskId, "transition_task");
    try {
      return await this.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: initial.where, select: taskSelect });
        if (!task) throw new AiTaskRepositoryError("AI_RESOURCE_UNAVAILABLE");
        // Input consumption and resume must share the dedicated receipt transaction.
        if (task.status === 'WAITING_INPUT' && input.to === 'running') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if (task.contractVersion !== AI_TASK_DRAFT_VERSION || !AI_TASK_STATUSES_DRAFT.some(status => status === task.status.toLowerCase())) {
          throw new AiTaskRepositoryError("AI_INVALID_INPUT");
        }
        if (task.revision !== input.expectedRevision || task.eventCursor < 0n || task.eventCursor >= maxCursor) throw conflict();
        // The update locks the task row; all reservations below roll back on any failure.
        const reserved = await tx.aiTask.updateMany({
          where: { ...initial.where, scopeId: task.scopeId, revision: task.revision, eventCursor: task.eventCursor, status: task.status },
          data: { revision: { increment: 1 }, eventCursor: { increment: 1n } }
        });
        if (reserved.count !== 1) throw conflict();
        const rows = await tx.aiStep.findMany({
          where: { scopeId: task.scopeId, taskId: task.id }, select: stepSelect, orderBy: [{ runId: "asc" }, { sequence: "asc" }], take: 1001
        });
        // Reauthorize after awaited reads/lock acquisition, before any status/event commit.
        const current = await this.access.resolveAccess(input.taskId, "transition_task");
        if (initial.bindingKey !== current.bindingKey) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
        const occurredAt = current.now.toISOString();
        const state: AiTaskTransitionStateDraft = {
          contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, revision: task.revision,
          status: task.status.toLowerCase() as AiTaskTransitionStateDraft["status"],
          steps: rows.map(row => ({
            stepId: row.id, runId: row.runId, sequence: row.sequence, revision: row.revision, actionId: row.actionId,
            outcome: { status: row.status.toLowerCase() as AiStepStatusDraft, effect: row.effect.toLowerCase() as AiStepStateDraft["outcome"]["effect"] }
          }))
        };
        if (settleCancellation) {
          if (task.status !== 'CANCEL_REQUESTED') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
          if (rows.some(row => row.effect === 'COMMITTED')) {
            input.to = rows.every(row => row.status === 'SUCCEEDED') ? 'succeeded' : 'partially_succeeded';
          }
        }
        const request: AiTaskTransitionRequestDraft = {
          contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, expectedRevision: task.revision,
          to: input.to, reason: input.reason, occurredAt,
          initiator: input.lease ? { kind: "worker", id: input.lease.holderId } : { kind: current.actorKind === "AUTOMATION" ? "system" : "user", id: current.actorId }
        };
        const decision = evaluateAiTaskTransitionDraft(state, request);
        if (!decision.allowed) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
        let nextRunRevision: number | null = null;
        if (input.lease) {
          const lease = input.lease;
          const held = await tx.aiRun.updateMany({
            where: {
              id: lease.runId, scopeId: task.scopeId, taskId: task.id, revision: lease.revision,
              fencingToken: new Prisma.Decimal(lease.fencingToken), leaseOwnerId: lease.holderId,
              leaseExpiresAt: { gt: current.now }, actorKind: current.actorKind, actorId: current.actorId,
              status: { in: ["QUEUED", "RUNNING"] }
            },
            // Activation belongs to this task+run transaction, not claimLease:
            // merely owning a lease must not start execution. A created run is
            // QUEUED until its aggregate transition has been authorized.
            data: { revision: { increment: 1 }, ...(input.to === 'running' ? { status: 'RUNNING' as const } : {}) }
          });
          if (held.count !== 1) throw conflict();
          nextRunRevision = lease.revision + 1;
        }
        const changed = await tx.aiTask.updateMany({
          where: { ...current.where, scopeId: task.scopeId, revision: decision.nextRevision, eventCursor: task.eventCursor + 1n, status: task.status },
          data: {
            status: input.to.toUpperCase() as AiTaskStatus,
            ...(input.to === "cancel_requested" ? { cancelRequestedAt: current.now } : {})
          }
        });
        if (changed.count !== 1) throw conflict();
        const event: AiTaskEventDraft = {
          contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, cursor: (task.eventCursor + 1n).toString(),
          taskRevision: decision.nextRevision, occurredAt, type: "task.transition",
          data: { from: state.status, to: input.to, reason: input.reason }
        };
        await tx.aiTaskEvent.create({
          data: {
            scopeId: task.scopeId, taskId: task.id, cursor: task.eventCursor + 1n,
            taskRevision: decision.nextRevision, type: event.type, occurredAt: current.now,
            // Internal audit envelope, not the wire payload. A reader must explicitly project event.data.
            payload: { data: event.data, initiator: { ...request.initiator, actorKind: current.actorKind, actorId: current.actorId } }
          },
          select: { cursor: true }
        });
        // This value becomes observable only after Prisma resolves the transaction commit.
        return { event, runRevision: nextRunRevision };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      // Includes an ambiguous connection loss at commit: do not automatically retry the mutation.
      throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
    }
  }
}
