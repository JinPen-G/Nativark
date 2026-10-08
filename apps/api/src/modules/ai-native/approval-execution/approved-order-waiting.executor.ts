import { AI_PROPOSAL_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, type AiProposalDecisionRequestDraft } from '@rental-os/shared';
import type { Prisma } from '@prisma/client';
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
  const material = (value: Awaited<ReturnType<typeof readWaiting>>, state: string): Prisma.InputJsonValue => ({
    version: 'approved-order-wait-1', binding: value.binding, presentedLease: value.lease, effectState: state,
    ...(value.kind === 'waiting_reference' ? { proposal: value.proposal,
      ...(value.receipt.kind === 'recorded' ? { decisionRef: value.receipt.record.approvalId, decision: value.receipt.record.decision } : {}) } : {})
  });
  const command = (input: ReturnType<typeof parse>, waiting: Extract<Awaited<ReturnType<typeof readWaiting>>, { kind: 'waiting_reference' }>) => {
    if (waiting.receipt.kind !== 'recorded' || waiting.receipt.record.decision !== 'approved') throw deniedOrder();
    const { contractVersion: _, ...proposal } = waiting.proposal;
    return { taskId: input.taskId, ...proposal, actionId: input.actionId, approvalId: waiting.receipt.record.approvalId,
      lease: { runId: input.runId, holderId: input.lease.holderId, revision: input.lease.revision, fencingToken: input.lease.fencingToken } };
  };
  const reconcile = async (raw: ApprovedOrderExecutorInput): Promise<ApprovedOrderWaitingResult> => {
    const input = parse(raw), waiting = await readWaiting(input);
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
      await policy.authorizePreparation(input.taskId);
      await app.source.readForExecution(input);
      const latest = await readWaiting(input);
      await policy.authorizePreparation(input.taskId);
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
