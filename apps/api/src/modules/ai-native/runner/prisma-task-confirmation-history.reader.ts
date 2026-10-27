/** Observe original pause/resume receipts after cancellation, expiry or finish.
 * Uses current read authority only; never claims a holder, replays approval,
 * dispatches a tool or equates a phase receipt with a Core business result. */
import { Prisma, type PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_TOOL_DRAFT_VERSION, type AiTaskConfirmationHistoryDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from '../ai-task.repository';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { taskExecutionPhaseStore } from './task-execution-phase.store';
import { waitingPayloadSchema } from './prisma-task-confirmation-checkpoint.source';
import { aiTaskRunPlanSchema, aiTaskConfirmationPhasePayloadSchema, aiTaskResumedConfirmationSchema } from './prisma-task-run-evidence.repository';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u);
const revision = z.number().int().min(1).max(4294967295);
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const validDate = (value: Date) => value instanceof Date && Number.isFinite(value.getTime());
export const aiTaskConfirmationEventSchema = z.object({ data: z.object({ from: z.enum(AI_TASK_STATUSES_DRAFT), to: z.enum(AI_TASK_STATUSES_DRAFT), reason: z.string() }).strict(),
  initiator: z.object({ kind: z.literal('worker'), id: z.string().min(1).max(191), actorKind: z.string(), actorId: z.string() }).strict(),
  confirmation: z.object({ checkpointRef: id, phaseId: id }).passthrough() }).passthrough();

export class PrismaTaskConfirmationHistoryReader {
  constructor(private readonly db: Pick<PrismaClient, '$transaction'>,
    private readonly tasks: Pick<AiTaskRepository, 'resolveAccess'>) {}

  async read(value: unknown): Promise<AiTaskConfirmationHistoryDraft> {
    const command = z.object({ taskId: id, runId: id, stepId: id }).strict().safeParse(structuredClone(value));
    if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const input = command.data, access = structuredClone(await this.tasks.resolveAccess(input.taskId, 'read_step_terminal'));
    const authorize = async () => {
      for (const action of ['read_step_terminal', 'read_events'] as const) {
        if ((await this.tasks.resolveAccess(input.taskId, action)).bindingKey !== access.bindingKey) throw denied();
      }
    };
    await authorize();
    const snapshot = () => this.db.$transaction(async tx => {
      const task = structuredClone(await tx.aiTask.findFirst({ where: access.where, select: { id: true, scopeId: true, ownerKind: true, ownerId: true,
        audience: true, contractVersion: true, status: true, revision: true, eventCursor: true, cancelRequestedAt: true } }));
      if (!task || task.id !== input.taskId || task.contractVersion !== AI_TASK_DRAFT_VERSION
        || !AI_TASK_STATUSES_DRAFT.some(status => status === task.status.toLowerCase()) || !revision.safeParse(task.revision).success
        || typeof task.eventCursor !== 'bigint' || task.eventCursor < 0n || task.eventCursor > 18446744073709551615n) throw unavailable();
      const key = { scopeId: task.scopeId, taskId: task.id, runId: input.runId, stepId: input.stepId };
      const run = structuredClone(await tx.aiRun.findFirst({ where: { id: key.runId, scopeId: key.scopeId, taskId: key.taskId },
        select: { id: true, scopeId: true, taskId: true, actorKind: true, actorId: true, revision: true } }));
      const step = structuredClone(await tx.aiStep.findFirst({ where: { id: key.stepId, scopeId: key.scopeId, taskId: key.taskId, runId: key.runId },
        select: { id: true, scopeId: true, taskId: true, runId: true, inputRef: true, actionId: true, requestFingerprint: true,
          toolCode: true, toolVersion: true, status: true, revision: true } }));
      if (!run || run.id !== key.runId || run.scopeId !== key.scopeId || run.taskId !== task.id
        || run.actorKind !== access.actorKind || run.actorId !== access.actorId || !step
        || step.id !== key.stepId || step.scopeId !== key.scopeId || step.taskId !== task.id || step.runId !== run.id
        || !['rental.order.commit', 'tenant.notifications.commit'].includes(step.toolCode) || step.toolVersion !== AI_TOOL_DRAFT_VERSION) throw denied();
      const store = taskExecutionPhaseStore(tx), starts = structuredClone(await store.readStarts(key)), receipts = structuredClone(await store.readReceipts(key));
      const saved = starts.length ? structuredClone(await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
        scopeId: key.scopeId, taskId: key.taskId, runId: key.runId } } })) : null;
      const plan = saved ? aiTaskRunPlanSchema.parse(structuredClone(saved.payload)) : null;
      if (starts.length && (!saved || saved.scopeId !== key.scopeId || saved.taskId !== task.id || saved.runId !== run.id
        || plan!.taskId !== task.id || plan!.runId !== run.id || hash(plan) !== saved.planHash
        || !plan!.steps.some(item => item.operation === 'idempotent' && item.toolCode === step.toolCode && item.toolVersion === step.toolVersion))) throw denied();
      for (const [index, phase] of starts.entries()) {
        if (phase.sequence !== index + 1 || Object.entries(key).some(([k, v]) => phase[k as keyof typeof phase] !== v)
          || phase.actionId !== step.actionId || phase.inputRef !== step.inputRef || phase.stepFingerprint !== step.requestFingerprint
          || phase.planHash !== saved?.planHash || phase.originalArtifactId !== starts[0].originalArtifactId
          || !validDate(phase.createdAt) || phase.createdAt > access.now
          || index === 1 && phase.createdAt < starts[0].createdAt) throw denied();
      }
      if (new Set(receipts.map(row => row.phaseId)).size !== receipts.length) throw unavailable();
      for (const receipt of receipts) {
        const start = starts.find(row => row.id === receipt.phaseId);
        const payload = aiTaskConfirmationPhasePayloadSchema.parse(receipt.payload);
        if (!start || Object.entries(key).some(([k, v]) => receipt[k as keyof typeof receipt] !== v)
          || hash(receipt.payload) !== receipt.contentHash || BigInt(Buffer.byteLength(JSON.stringify(receipt.payload), 'utf8')) !== receipt.outputBytes
          || !validDate(receipt.createdAt) || receipt.createdAt < start.createdAt || receipt.createdAt > access.now
          || payload.version !== (step.toolCode === 'rental.order.commit' ? 'approved-order-wait-1' : 'approved-settings-wait-1')
          || hash(payload.binding) !== hash({ ...key, actionId: step.actionId, inputRef: step.inputRef, fingerprint: step.requestFingerprint })
          || payload.presentedLease.taskId !== task.id || payload.presentedLease.runId !== run.id
          || payload.presentedLease.holderId !== start.leaseOwnerId || payload.presentedLease.fencingToken !== start.fencingToken
          || payload.presentedLease.revision !== start.runRevision
          || (payload.proposal?.proposalId ?? null) !== receipt.proposalId || (payload.proposal?.proposalRevision ?? null) !== receipt.proposalRevision
          || (payload.proposal?.reviewedPayloadHash ?? null) !== receipt.reviewedPayloadHash || (payload.decisionRef ?? null) !== receipt.decisionRef
          || (payload.businessResultRef ?? null) !== receipt.businessResultRef
          || start.sequence === 2 && receipt.decisionRef !== null && receipt.decisionRef !== start.decisionRef
          || receipt.kind === 'confirmation' && (start.sequence !== 1 || payload.effectState !== 'awaiting_decision')
          || receipt.kind === 'succeeded' && (payload.effectState !== 'committed' || payload.decision !== 'approved' || !receipt.decisionRef)
          || receipt.kind === 'failed' && (payload.effectState !== 'rejected' || payload.decision !== 'rejected' || !receipt.decisionRef)
          || receipt.kind === 'unknown' && !['unresolved', 'preparation_unknown'].includes(payload.effectState)) throw denied();
      }
      const first = starts[0], checkpoint = first ? receipts.find(row => row.phaseId === first.id && row.kind === 'confirmation') : undefined;
      const payload = checkpoint ? waitingPayloadSchema.parse(structuredClone(checkpoint.payload)) : null;
      if (checkpoint && (!payload || hash(payload.binding) !== hash({ ...key, actionId: step.actionId, inputRef: step.inputRef, fingerprint: step.requestFingerprint })
        || payload.version !== (step.toolCode === 'rental.order.commit' ? 'approved-order-wait-1' : 'approved-settings-wait-1')
        || payload.proposal.proposalId !== checkpoint.proposalId || payload.proposal.proposalRevision !== checkpoint.proposalRevision
        || payload.proposal.reviewedPayloadHash !== checkpoint.reviewedPayloadHash
        || payload.presentedLease.taskId !== task.id || payload.presentedLease.runId !== run.id
        || payload.presentedLease.holderId !== first.leaseOwnerId || payload.presentedLease.fencingToken !== first.fencingToken
        || payload.presentedLease.revision !== first.runRevision)) throw denied();
      const events = first ? structuredClone(await tx.aiTaskEvent.findMany({ where: { scopeId: key.scopeId, taskId: task.id, type: 'task.transition',
        payload: { path: '$.confirmation.phaseId', equals: first.id } }, orderBy: { cursor: 'asc' }, take: 3 })) : [];
      if (events.length > 2 || !checkpoint && events.length) throw unavailable();
      const transitions: AiTaskConfirmationHistoryDraft['transitions'] = [];
      const approvals = [];
      let continuation: z.infer<typeof aiTaskResumedConfirmationSchema>['confirmation'] | undefined;
      for (const event of events) {
        const envelope = aiTaskConfirmationEventSchema.parse(structuredClone(event.payload)), meta = envelope.confirmation;
        const resumed = envelope.data.from === 'waiting_confirmation' && envelope.data.to === 'running' && envelope.data.reason === 'resume';
        const paused = envelope.data.from === 'running' && envelope.data.to === 'waiting_confirmation' && envelope.data.reason === 'confirmation_required';
        if (event.scopeId !== key.scopeId || event.taskId !== task.id || event.type !== 'task.transition' || !revision.safeParse(event.taskRevision).success
          || event.taskRevision > task.revision || typeof event.cursor !== 'bigint' || event.cursor < 1n || event.cursor > task.eventCursor
          || !validDate(event.occurredAt) || event.occurredAt < checkpoint!.createdAt || event.occurredAt > access.now
          || meta.phaseId !== first.id || meta.checkpointRef !== checkpoint!.id || envelope.initiator.actorKind !== access.actorKind
          || envelope.initiator.actorId !== access.actorId || (!paused && !resumed)
          || paused && (transitions.length !== 0 || envelope.initiator.id !== first.leaseOwnerId)
          || resumed && (transitions.length !== 1 || transitions[0].kind !== 'paused'
            || event.taskRevision !== transitions[0].taskRevision + 1)) throw denied();
        if (resumed) {
          continuation = aiTaskResumedConfirmationSchema.parse(event.payload).confirmation;
          if (meta.contentHash !== checkpoint!.contentHash || meta.runId !== run.id || meta.stepId !== step.id
            || meta.stepRevision !== first.stepRevision || meta.holderId !== envelope.initiator.id
            || !id.safeParse(meta.decisionRef).success || !['approved', 'rejected'].includes(String(meta.decision))) throw denied();
          const approval = structuredClone(await tx.aiApproval.findFirst({ where: { scopeId: key.scopeId, taskId: task.id, id: String(meta.decisionRef) } }));
          if (!approval || approval.id !== meta.decisionRef || approval.scopeId !== key.scopeId || approval.taskId !== task.id
            || approval.proposalId !== checkpoint!.proposalId || approval.proposalRevision !== checkpoint!.proposalRevision
            || approval.payloadHash !== checkpoint!.reviewedPayloadHash || approval.actorKind !== task.ownerKind
            || approval.actorId !== task.ownerId || approval.audience !== task.audience || approval.decision !== String(meta.decision).toUpperCase()
            || !validDate(approval.issuedAt) || !validDate(approval.expiresAt) || approval.issuedAt > event.occurredAt
            || approval.issuedAt >= approval.expiresAt || approval.expiresAt <= event.occurredAt) throw denied();
          approvals.push(structuredClone(approval));
        }
        transitions.push({ kind: resumed ? 'continued' : 'paused', taskRevision: event.taskRevision,
          cursor: event.cursor.toString(), observedAt: event.occurredAt.toISOString() });
      }
      if (starts.length === 2 && (!checkpoint || transitions.at(-1)?.kind !== 'continued'
        || starts[1].previousReceiptId !== checkpoint.id || starts[1].decisionRef !== approvals[0]?.id
        || starts[1].leaseOwnerId !== continuation?.holderId || starts[1].fencingToken !== continuation.fencingToken
        || starts[1].runRevision !== continuation.runRevision || starts[1].stepRevision !== continuation.stepRevision)) throw denied();
      const view: AiTaskConfirmationHistoryDraft = { version: 'task-confirmation-history-1', ...input,
        task: { status: task.status.toLowerCase(), revision: task.revision, cursor: task.eventCursor.toString() },
        phases: starts.map(phase => { const receipt = receipts.find(row => row.phaseId === phase.id);
          return { phaseId: phase.id, sequence: phase.sequence, startedAt: phase.createdAt.toISOString(),
            receiptId: receipt?.id ?? null, kind: receipt?.kind ?? null }; }), transitions,
        execution: 'read_only_no_claim_or_dispatch', businessOutcome: 'not_attested',
        absenceSemantics: 'not_observed_is_not_proof_of_not_executed' };
      return { view, witness: structuredClone({ task, run, step, starts, receipts, events, approvals, planHash: saved?.planHash ?? null }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    try {
      const first = await snapshot();
      await authorize();
      if (!isDeepStrictEqual(first.witness, (await snapshot()).witness)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      await authorize();
      return Object.freeze(first.view);
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw unavailable();
    }
  }
}
