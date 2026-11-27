/** Original aggregate Task/Run CAS and event publication, shared with the Rental host. */
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, AiTaskStatus } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_TASK_TRANSITION_REASONS_DRAFT, type AiTaskEventDraft,
  type AiTaskTransitionRequestDraft, type AiStepStatusDraft, type AiStepStateDraft, type AiTaskTransitionDecisionDraft } from '@rental-os/platform-contracts/ai-task';
import { AiTaskRepositoryError } from '../task-errors';
import type { TaskPersistenceRepository } from './task-persistence.repository';
import { evaluateAiTaskTransitionDraft, evaluateAiTaskAdmissionTransitionDraft, type AiTaskTransitionStateDraft } from './task-transition-draft';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const leaseSchema = z.object({
  runId: id, holderId: id, revision,
  fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u)
}).strict();
export const taskTransitionCommandSchema = z.object({
  taskId: id, expectedRevision: revision,
  to: z.enum(AI_TASK_STATUSES_DRAFT), reason: z.enum(AI_TASK_TRANSITION_REASONS_DRAFT), lease: leaseSchema.optional()
}).strict().refine(value => value.to === "cancel_requested" ? value.lease === undefined : value.lease !== undefined);

export const taskTransitionSelect = {
  id: true, scopeId: true, status: true, revision: true, contractVersion: true,
  eventCursor: true, cancelRequestedAt: true
} satisfies Prisma.AiTaskSelect;
const stepSelect = { id: true, runId: true, sequence: true, revision: true, actionId: true, requestFingerprint: true,
  status: true, effect: true } satisfies Prisma.AiStepSelect;
const maxCursor = 18446744073709551615n;
const conflict = () => new AiTaskRepositoryError("AI_REVISION_CONFLICT");
export class AiTaskTransitionResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'reconcile';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}


export type TaskTransitionCommand = z.infer<typeof taskTransitionCommandSchema>;
type Access = Awaited<ReturnType<TaskPersistenceRepository['resolveAccess']>>;
type Task = Prisma.AiTaskGetPayload<{ select: typeof taskTransitionSelect }>;
export async function lockTaskTransition(tx: Prisma.TransactionClient, initial: Access, task: Task,
  input: TaskTransitionCommand, beforeWrite: () => void) {
  if (task.contractVersion !== AI_TASK_DRAFT_VERSION || !AI_TASK_STATUSES_DRAFT.some(status => status === task.status.toLowerCase()))
    throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  if (task.revision !== input.expectedRevision || task.eventCursor < 0n || task.eventCursor >= maxCursor) throw conflict();
  beforeWrite();
  const reserved = await tx.aiTask.updateMany({
    where: { ...initial.where, scopeId: task.scopeId, revision: task.revision, eventCursor: task.eventCursor, status: task.status },
    data: { revision: { increment: 1 }, eventCursor: { increment: 1n } }
  });
  if (reserved.count !== 1) throw conflict();
  return tx.aiStep.findMany({ where: { scopeId: task.scopeId, taskId: task.id }, select: stepSelect,
    orderBy: [{ runId: 'asc' }, { sequence: 'asc' }], take: 1001 });
}

export async function recordTaskTransition(tx: Prisma.TransactionClient, initial: Access, task: Task,
  rows: Awaited<ReturnType<typeof lockTaskTransition>>, input: TaskTransitionCommand, settleCancellation: boolean,
  revalidate: () => Promise<Access>, checkpoint?: {
    decide(state: AiTaskTransitionStateDraft, request: AiTaskTransitionRequestDraft): AiTaskTransitionDecisionDraft;
    payload(runRevision: number | null): Prisma.InputJsonObject;
  }) {
  // Only a persisted original charge under this Task lock may explain a
  // PENDING admission whose reply was lost. This witness is server-read,
  // not a command field, effect receipt, cleanup ticket or execution grant.
  const pending = input.to === 'waiting_external' && input.lease
    ? rows.filter(row => row.runId === input.lease!.runId && row.status === 'PENDING' && row.effect === 'NONE') : [];
  const admission = pending.length ? await tx.aiTaskExecutionCharge.findFirst({ where: {
    scopeId: task.scopeId, taskId: task.id, runId: input.lease!.runId, amount: { gt: 0n },
    status: { in: ['RESERVED', 'UNKNOWN'] }, resource: { in: ['STEPS', 'ACTIVE_MS', 'OUTPUT_BYTES'] },
    OR: pending.map(row => ({ stepId: row.id, actionId: row.actionId, stepFingerprint: row.requestFingerprint }))
  }, select: { stepId: true, actionId: true } }) : null;
  const admittedStep = admission && pending.find(row => row.id === admission.stepId && row.actionId === admission.actionId);
  // Reauthorize after awaited reads/lock acquisition, before any status/event commit.
  const current = await revalidate();
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
  // Runner counters describe this run, while task completion covers all
  // persistent runs. A failed successor cannot erase completed ancestors.
  if (!settleCancellation && input.to === 'failed' && input.reason === 'execution_failed'
    && rows.some(row => row.status === 'SUCCEEDED') && !rows.every(row => row.status === 'SUCCEEDED')) {
    input.to = 'partially_succeeded';
    input.reason = 'completed';
  }
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
  const decision = checkpoint ? checkpoint.decide(state, request) : admittedStep ? evaluateAiTaskAdmissionTransitionDraft(state, request, {
    stepId: admittedStep.id, runId: admittedStep.runId, stepRevision: admittedStep.revision, actionId: admittedStep.actionId
  }) : evaluateAiTaskTransitionDraft(state, request);
  if (!decision.allowed) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
  let nextRunRevision: number | null = null;
  if (input.lease) {
    const lease = input.lease;
    const terminal = ['succeeded', 'partially_succeeded', 'failed', 'cancelled'].includes(input.to);
    // Aggregate completion includes older runs. Close only the held run,
    // deriving its outcome from its own steps rather than copying a
    // partially-successful task onto a failed or successful successor.
    const runSteps = rows.filter(row => row.runId === lease.runId);
    const runStatus: AiTaskStatus = input.to === 'cancelled' ? 'CANCELLED'
      : input.to === 'succeeded' || (runSteps.length > 0 && runSteps.every(row => row.status === 'SUCCEEDED')) ? 'SUCCEEDED'
        : runSteps.some(row => row.status === 'SUCCEEDED') ? 'PARTIALLY_SUCCEEDED'
          : input.reason === 'cancel_settled' ? 'CANCELLED' : 'FAILED';
    const held = await tx.aiRun.updateMany({
      where: {
        id: lease.runId, scopeId: task.scopeId, taskId: task.id, revision: lease.revision,
        fencingToken: new prismaRuntime.Decimal(lease.fencingToken), leaseOwnerId: lease.holderId,
        leaseExpiresAt: { gt: current.now }, actorKind: current.actorKind, actorId: current.actorId,
        status: { in: ["QUEUED", "RUNNING"] }
      },
      // Activation/finalization belongs to this task+run transaction,
      // not lease acquisition/release. A resume must preserve the original
      // start time; old missing timestamps are not fabricated as history.
      data: { revision: { increment: 1 },
        ...(terminal ? { status: runStatus, endedAt: current.now }
          : input.to === 'running' ? { status: 'RUNNING' as const,
            ...(task.status === 'QUEUED' ? { startedAt: current.now } : {}) } : {}) }
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
      payload: { data: event.data, initiator: { ...request.initiator, actorKind: current.actorKind, actorId: current.actorId },
        ...(checkpoint ? checkpoint.payload(nextRunRevision) : {}) }
    },
    select: { cursor: true }
  });
  return { event, runRevision: nextRunRevision };
}
