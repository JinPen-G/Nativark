import { AI_PROPOSAL_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, type AiProposalDecisionRequestDraft } from '@rental-os/shared';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiTaskRegisteredExecutor } from '../runner/prisma-task-measured-effects';
import type { composePersistedOrderTaskInput } from '../order-task-input.composition';
import type { composePersistedApprovedOrder } from './persisted-approved-order.composition';
import type { composeApprovedOrderHumanApproval } from './approved-order-human.composition';
import type { ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';
import { PersistedApprovedOrderPolicyAuthority } from './persisted-approved-order-policy.authority';
import { deniedOrder, orderContextHash } from './prisma-approved-order.source';
import { taskExecutionPhaseStore } from '../runner/task-execution-phase.store';

type Registered = NonNullable<Awaited<ReturnType<AiTaskRegisteredExecutor['resolve']>>>;
export type ApprovedOrderExecutorInput = Parameters<Registered['execute']>[0];
type TerminalResult = Awaited<ReturnType<Registered['execute']>>;
export type ApprovedOrderWaitingResult = TerminalResult | { kind: 'paused'; pause: 'confirmation'; payload: Prisma.InputJsonValue };
type Applications = ReturnType<typeof composePersistedApprovedOrder> & {
  source: ReturnType<typeof composePersistedOrderTaskInput>['source'];
  approvals: ReturnType<typeof composeApprovedOrderHumanApproval>;
};
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const inputSchema = z.object({ taskId: id.max(36), runId: id.max(36), stepId: id.max(36), actionId: id, inputRef: id.max(36),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), lease: z.object({ taskId: id.max(36), runId: id.max(36), holderId: id,
    revision: z.number().int().min(1).max(4294967294), fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    expiresAt: z.string().datetime({ offset: true }), purpose: z.literal('recovery_only').optional() }).strict(),
  clarifications: z.array(z.unknown()).optional() }).strict();
const unknown = (payload: Prisma.InputJsonValue): TerminalResult => ({ kind: 'unknown', payload });

export function composeApprovedOrderWaiting(d: ControlledApprovedOrderDependencies, app: Applications) {
  const policy = new PersistedApprovedOrderPolicyAuthority({ ...d, toolVersion: AI_TOOL_DRAFT_VERSION });
  const parse = (input: ApprovedOrderExecutorInput) => {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success || parsed.data.taskId !== parsed.data.lease.taskId || parsed.data.runId !== parsed.data.lease.runId) {
      throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    }
    const { clarifications: _, ...binding } = parsed.data;
    return binding;
  };
  const locate = async (input: ReturnType<typeof parse>) => {
    const first = await policy.authorizeRead(input.taskId);
    const key = { scopeId: first.scopeId, taskId: input.taskId, runId: input.runId, id: input.stepId, actionId: input.actionId };
    const step = await d.db.aiStep.findFirst({ where: key });
    if (!step || Object.entries(key).some(([k, v]) => step[k as keyof typeof step] !== v) || step.inputRef !== input.inputRef
      || step.requestFingerprint !== input.fingerprint || step.toolCode !== 'rental.order.commit' || step.toolVersion !== AI_TOOL_DRAFT_VERSION) throw deniedOrder();
    const actions = await d.db.aiProposalAction.findMany({ where: { scopeId: first.scopeId, taskId: input.taskId, actionId: input.actionId }, take: 2 });
    if (actions.length > 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const action = actions[0];
    if (action && (action.scopeId !== first.scopeId || action.taskId !== input.taskId || action.actionId !== input.actionId
      || action.requestFingerprint !== input.fingerprint)) throw deniedOrder();
    const version = action ? await d.db.aiProposalVersion.findFirst({ where: { scopeId: first.scopeId, taskId: input.taskId,
      proposalId: action.proposalId, revision: action.proposalRevision } }) : null;
    if (action && !version) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const latest = await policy.authorizeRead(input.taskId);
    if (first.scopeId !== latest.scopeId || orderContextHash(first.context) !== orderContextHash(latest.context)) throw deniedOrder();
    const binding = { scopeId: first.scopeId, taskId: input.taskId, runId: input.runId, stepId: input.stepId,
      actionId: input.actionId, inputRef: input.inputRef, fingerprint: input.fingerprint };
    const reference = version ? { contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: version.proposalId,
      proposalRevision: version.revision, reviewedPayloadHash: version.payloadHash } : null;
    return { binding, reference, context: latest.context };
  };
  const readWaiting = async (raw: ApprovedOrderExecutorInput) => {
    const input = parse(raw), first = await locate(input);
    if (!first.reference) return { kind: 'missing' as const, binding: first.binding, lease: input.lease };
    const view = await app.approvals.readProposal(input.taskId, first.reference);
    if (view.proposal.payload.actions[0].actionId !== input.actionId || view.proposal.payload.actions[0].input.contentHash !== input.fingerprint) throw deniedOrder();
    const decision: AiProposalDecisionRequestDraft['decision'] = view.proposal.status === 'cancelled' ? 'reject' : 'approve';
    const receipt = await app.approvals.readReceipt(input.taskId, { ...first.reference, decision });
    const latest = await locate(input);
    if (requestFingerprint(latest.binding) !== requestFingerprint(first.binding)
      || requestFingerprint(latest.reference) !== requestFingerprint(first.reference)
      || orderContextHash(latest.context) !== orderContextHash(first.context)) throw deniedOrder();
    return { kind: 'waiting_reference' as const, binding: first.binding, lease: input.lease, proposal: first.reference, receipt };
  };
  const material = (value: Awaited<ReturnType<typeof readWaiting>>, state: string): Prisma.InputJsonValue => {
    const { purpose: _, ...presentedLease } = value.lease;
    return { version: 'approved-order-wait-1', binding: value.binding, presentedLease, effectState: state,
      ...(value.kind === 'waiting_reference' ? { proposal: value.proposal,
        ...(value.receipt.kind === 'recorded' ? { decisionRef: value.receipt.record.approvalId, decision: value.receipt.record.decision } : {}) } : {}) };
  };
  const command = (input: ReturnType<typeof parse>, waiting: Extract<Awaited<ReturnType<typeof readWaiting>>, { kind: 'waiting_reference' }>) => {
    if (waiting.receipt.kind !== 'recorded' || waiting.receipt.record.decision !== 'approved') throw deniedOrder();
    const { contractVersion: _, ...proposal } = waiting.proposal;
    return { taskId: input.taskId, ...proposal, actionId: input.actionId, approvalId: waiting.receipt.record.approvalId,
      lease: { runId: input.runId, holderId: input.lease.holderId, revision: input.lease.revision, fencingToken: input.lease.fencingToken } };
  };
  const reconcile = async (raw: ApprovedOrderExecutorInput, transaction?: Prisma.TransactionClient): Promise<ApprovedOrderWaitingResult> => {
    const input = parse(raw), waiting = await readWaiting(input);
    if (waiting.kind === 'waiting_reference' && waiting.receipt.kind === 'absent') {
      const access = await policy.authorizeRead(input.taskId), key = { scopeId: access.scopeId, taskId: input.taskId, runId: input.runId, stepId: input.stepId };
      const readWitness = async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${key.scopeId} AND id = ${key.taskId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${key.scopeId} AND taskId = ${key.taskId} AND id = ${key.runId} FOR UPDATE`);
        const task = await tx.aiTask.findFirst({ where: { id: key.taskId, scopeId: key.scopeId, status: { in: ['CANCEL_REQUESTED', 'CANCELLED'] }, cancelRequestedAt: { not: null } } });
        const run = await tx.aiRun.findFirst({ where: { id: key.runId, scopeId: key.scopeId, taskId: key.taskId,
          leaseOwnerId: input.lease.holderId, revision: input.lease.revision, fencingToken: new Prisma.Decimal(input.lease.fencingToken),
          leaseExpiresAt: { gt: (d.clock ?? (() => new Date()))() } } });
        const step = await tx.aiStep.findFirst({ where: { id: key.stepId, scopeId: key.scopeId, taskId: key.taskId,
          runId: key.runId, actionId: input.actionId, inputRef: input.inputRef, requestFingerprint: input.fingerprint,
          status: { in: ['RUNNING', 'UNKNOWN', 'FAILED'] }, effect: { in: ['NONE', 'POSSIBLE'] } } });
        if (!task || !run || !step) return false;
        if (step.status === 'FAILED' && (step.errorCode !== 'AI_BUSINESS_REJECTED' || step.effect !== 'NONE')) return false;
        // Absence alone is insufficient: prove the only durable phase stopped
        // at human confirmation, with no execution phase or approval consumption.
        const phases = taskExecutionPhaseStore(tx), starts = await phases.readStarts(key), receipts = await phases.readReceipts(key);
        if (starts.length !== 1 || receipts.length !== 1) return false;
        const start = starts[0], receipt = receipts[0];
        const plan = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId } } });
        const payload = z.object({ version: z.literal('approved-order-wait-1'), binding: z.unknown(),
          effectState: z.literal('awaiting_decision') }).passthrough().safeParse(receipt.payload);
        if (start.sequence !== 1 || start.actionId !== input.actionId || start.inputRef !== input.inputRef
          || start.stepFingerprint !== input.fingerprint || !plan || plan.planHash !== start.planHash || requestFingerprint(plan.payload) !== start.planHash
          || receipt.phaseId !== start.id || receipt.kind !== 'confirmation' || requestFingerprint(receipt.payload) !== receipt.contentHash
          || receipt.proposalId !== waiting.proposal.proposalId || receipt.proposalRevision !== waiting.proposal.proposalRevision
          || receipt.reviewedPayloadHash !== waiting.proposal.reviewedPayloadHash || !payload.success
          || requestFingerprint(payload.data.binding) !== requestFingerprint(waiting.binding)) return false;
        const approval = await tx.aiApproval.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId,
          proposalId: waiting.proposal.proposalId, proposalRevision: waiting.proposal.proposalRevision } });
        const consumption = await tx.aiApprovalConsumption.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, actionId: input.actionId } });
        return !approval && !consumption;
      };
      const notSubmitted = transaction ? await readWitness(transaction) : await d.db.$transaction(readWitness,
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      if (notSubmitted) {
        const latest = await readWaiting(input);
        if (latest.kind !== 'waiting_reference' || latest.receipt.kind !== 'absent'
          || requestFingerprint(latest.binding) !== requestFingerprint(waiting.binding)) throw deniedOrder();
        return { kind: 'failed', errorCode: 'AI_CANCELLED', payload: material(waiting, 'cancelled_before_business_submission') };
      }
    }
    if (waiting.kind !== 'waiting_reference' || waiting.receipt.kind !== 'recorded' || waiting.receipt.record.decision !== 'approved') {
      return unknown(material(waiting, 'unresolved'));
    }
    try {
      const result = await app.reconcile(command(input, waiting));
      return { kind: 'succeeded', payload: { ...material(waiting, 'committed') as Prisma.InputJsonObject,
        businessResultRef: result.order.id, replayed: true } };
    } catch {
      await readWaiting(input);
      return unknown(material(waiting, 'unresolved'));
    }
  };
  const execute = async (raw: ApprovedOrderExecutorInput, signal: AbortSignal): Promise<ApprovedOrderWaitingResult> => {
    const input = parse(raw);
    if (signal.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    if (input.lease.purpose === 'recovery_only') return reconcile(input);
    let waiting = await readWaiting(input);
    if (signal.aborted) return unknown(material(waiting, 'unresolved'));
    if (waiting.kind === 'missing') {
      const source = await app.source.readForExecution(input);
      if (source.context.scope.kind !== 'workspace' || !('quoteId' in source.input) || typeof source.input.quoteId !== 'string') throw deniedOrder();
      const row = await d.db.aiTaskActionInput.findFirst({ where: { scopeId: waiting.binding.scopeId, taskId: input.taskId, runId: input.runId, id: input.inputRef } });
      const quote = await d.quoteFacts.findQuote(source.context.scope.tenantId, source.input.quoteId);
      if (!row || !(row.expiresAt instanceof Date) || !quote || !Number.isFinite(Date.parse(quote.expiresAt))) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const expiresAt = new Date(Math.min(row.expiresAt.getTime(), Date.parse(quote.expiresAt))).toISOString();
      const proposalId = `ao-${requestFingerprint(waiting.binding).slice(0, 32)}`;
      if (signal.aborted) return unknown(material(waiting, 'unresolved'));
      try {
        await app.prepare({ taskId: input.taskId, proposalId, proposalRevision: 1, actionId: input.actionId, expiresAt,
          lease: { runId: input.runId, holderId: input.lease.holderId, revision: input.lease.revision, fencingToken: input.lease.fencingToken } });
      } catch (error) {
        if (error instanceof AiTaskRepositoryError && error.code !== 'AI_STORAGE_UNAVAILABLE') throw error;
        return unknown({ ...material(waiting, 'preparation_unknown') as Prisma.InputJsonObject, proposalId });
      }
      waiting = await readWaiting(input);
    }
    if (waiting.kind !== 'waiting_reference' || waiting.receipt.kind === 'unknown') return unknown(material(waiting, 'unresolved'));
    if (waiting.receipt.kind === 'absent') {
      // A persisted proposal can still be observed and paused after new work
      // closes. Do not discard its measurement or grant a fresh preparation;
      // approval and submission retain their separate current execution gates.
      await policy.authorizeRead(input.taskId);
      const latest = await readWaiting(input);
      await policy.authorizeRead(input.taskId);
      if (signal.aborted || requestFingerprint(latest) !== requestFingerprint(waiting)) return unknown(material(waiting, 'unresolved'));
      return { kind: 'paused', pause: 'confirmation', payload: material(waiting, 'awaiting_decision') };
    }
    if (waiting.receipt.record.decision === 'rejected') return { kind: 'failed', errorCode: 'AI_APPROVAL_REJECTED', payload: material(waiting, 'rejected') };
    if (signal.aborted) return unknown(material(waiting, 'unresolved'));
    try {
      const result = await app.submit(command(input, waiting));
      return { kind: 'succeeded', payload: { ...material(waiting, 'committed') as Prisma.InputJsonObject,
        businessResultRef: result.order.id, replayed: result.replayed } };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      return unknown(material(waiting, 'unresolved'));
    }
  };
  return Object.freeze({ readWaiting, execute, reconcile, readInterrupted: reconcile,
    resolve: async (toolCode: string, toolVersion: string) => toolCode === 'rental.order.commit' && toolVersion === AI_TOOL_DRAFT_VERSION
      ? Object.freeze({ operation: 'idempotent' as const, execute }) : null });
}
