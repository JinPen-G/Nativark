/** Ordinary-name executor for the original measured confirmation runner.
 * Prepares an original proposal, pauses for a human decision, then uses the
 * acknowledged server lease for one domain CAS. Recovery never dispatches. */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiTaskRegisteredExecutor } from '../runner/prisma-task-measured-effects';
import { taskExecutionPhaseStore } from '../runner/task-execution-phase.store';
import { composeApprovedProfileApplication } from './approved-profile-application.composition';
import { ApprovedProfileTaskAuthority, PROFILE_NAME_TOOL_CODE, profileDenied, profileUnavailable, profileTransactionDb,
  type ApprovedProfileApplicationDependencies } from './approved-profile-task.authority';

type Executor = NonNullable<Awaited<ReturnType<AiTaskRegisteredExecutor['resolve']>>>;
type Input = Parameters<Executor['execute']>[0];
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const inputSchema = z.object({ taskId: id.max(36), runId: id.max(36), stepId: id.max(36), actionId: id,
  inputRef: z.string().uuid(), fingerprint: hash, lease: z.object({ taskId: id.max(36), runId: id.max(36), holderId: id,
    revision: z.number().int().positive(), fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    expiresAt: z.string().datetime({ offset: true }), purpose: z.literal('recovery_only').optional() }).strict(),
  clarifications: z.array(z.unknown()).optional() }).strict();
export function composeApprovedProfileWaiting(d: ApprovedProfileApplicationDependencies) {
  const app = composeApprovedProfileApplication(d), authority = new ApprovedProfileTaskAuthority(d);
  const parse = (value: Input) => {
    const input = inputSchema.parse(structuredClone(value));
    if (input.taskId !== input.lease.taskId || input.runId !== input.lease.runId || input.lease.holderId !== d.holderId) throw profileDenied();
    if (input.clarifications?.length) throw profileUnavailable();
    const { clarifications: _, ...binding } = input; return binding;
  };
  const locate = async (input: ReturnType<typeof parse>, executing = false) => {
    const grant = await authority.resolve(input.taskId, executing ? 'execute' : 'read');
    const key = { scopeId: grant.scopeId, taskId: input.taskId, runId: input.runId, id: input.stepId, actionId: input.actionId };
    const step = await d.db.aiStep.findFirst({ where: key });
    if (!step || Object.entries(key).some(([k, v]) => step[k as keyof typeof step] !== v)
      || step.toolCode !== PROFILE_NAME_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || step.inputRef !== input.inputRef || step.requestFingerprint !== input.fingerprint) throw profileDenied();
    const change = await d.db.customerApprovedProfileChange.findUnique({ where: { id: input.inputRef } });
    if (!change || change.tenantId !== grant.actor.tenantId || change.workspaceId !== grant.actor.workspaceId
      || change.actorId !== grant.actor.actorId || change.changeHash !== input.fingerprint) throw profileDenied();
    if (executing) {
      const run = await d.db.aiRun.findFirst({ where: { id: input.runId, scopeId: grant.scopeId, taskId: input.taskId } });
      if (!run || run.status !== 'RUNNING' || run.actorKind !== 'USER' || run.actorId !== grant.actor.actorId
        || run.leaseOwnerId !== input.lease.holderId || run.revision !== input.lease.revision
        || run.fencingToken.toFixed(0) !== input.lease.fencingToken || !run.leaseExpiresAt
        || run.leaseExpiresAt.toISOString() !== input.lease.expiresAt || run.leaseExpiresAt <= authority.clock()
        || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE') throw profileDenied();
    }
    const binding = { scopeId: grant.scopeId, taskId: input.taskId, runId: input.runId, stepId: input.stepId,
      actionId: input.actionId, inputRef: input.inputRef, fingerprint: input.fingerprint }, digest = requestFingerprint(binding);
    return { binding, grant, customerId: change.customerId, operationKey: `profile-operation-${digest}`,
      prepare: { taskId: input.taskId, proposalId: `ap-${digest.slice(0, 32)}`, proposalRevision: 1 as const,
        stepId: input.stepId, customerId: change.customerId, changeId: input.inputRef, changeHash: input.fingerprint } };
  };
  const readWaiting = async (raw: Input) => {
    const input = parse(raw), found = await locate(input), prepared = await app.readPreparationReceipt(found.prepare);
    if ((await locate(input)).grant.bindingHash !== found.grant.bindingHash) throw profileDenied();
    if (prepared.state !== 'prepared') return { kind: 'missing' as const, binding: found.binding, lease: input.lease };
    const review = await app.readProposal(prepared.reference), action = review.proposal.payload.actions[0];
    if (action.actionId !== input.actionId || action.input.recordId !== input.inputRef || action.input.contentHash !== input.fingerprint
      || review.change.customerId !== found.customerId || review.change.changeHash !== input.fingerprint) throw profileDenied();
    const decision = await app.readDecisionReceipt(prepared.reference);
    if ((await locate(input)).grant.bindingHash !== found.grant.bindingHash) throw profileDenied();
    return { kind: 'waiting_reference' as const, binding: found.binding, lease: input.lease, reference: prepared.reference,
      proposal: { contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: prepared.reference.proposalId,
        proposalRevision: prepared.reference.proposalRevision, reviewedPayloadHash: prepared.reference.payloadHash },
      receipt: decision.state === 'recorded' ? { kind: 'recorded' as const, record: decision.approval }
        : { kind: 'absent' as const, retryable: false as const } };
  };
  const material = (waiting: Awaited<ReturnType<typeof readWaiting>>, effectState: string) => {
    const { purpose: _, ...presentedLease } = waiting.lease;
    return { version: 'approved-profile-wait-1', binding: waiting.binding, presentedLease, effectState,
      ...(waiting.kind === 'waiting_reference' ? { proposal: waiting.proposal,
        ...(waiting.receipt.kind === 'recorded' ? { decisionRef: waiting.receipt.record.approvalId, decision: waiting.receipt.record.decision } : {}) } : {}) };
  };
  const reconcile: Executor['execute'] = async raw => {
    const input = parse(raw), found = await locate(input), waiting = await readWaiting(input);
    const operation = await app.readOriginalOperation({ customerId: found.customerId, operationKey: found.operationKey });
    if (operation.state !== 'committed') {
      // Absence is not rollback. A rejected/cancelled *sole acknowledged
      // confirmation* may attest no submission; a later phase stays unknown.
      if (waiting.kind === 'waiting_reference' && (waiting.receipt.kind === 'absent'
        || waiting.receipt.record.decision === 'rejected')) {
        const witness = await d.db.$transaction(async tx => {
          const key = { scopeId: found.binding.scopeId, taskId: input.taskId, runId: input.runId, stepId: input.stepId };
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${key.scopeId} AND id = ${key.taskId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${key.scopeId} AND taskId = ${key.taskId} AND id = ${key.runId} FOR UPDATE`);
          const task = await tx.aiTask.findFirst({ where: { id: key.taskId, scopeId: key.scopeId, ownerKind: 'USER', ownerId: found.grant.actor.actorId } });
          const run = await tx.aiRun.findFirst({ where: { id: key.runId, taskId: key.taskId, scopeId: key.scopeId,
            actorKind: 'USER', actorId: found.grant.actor.actorId, leaseOwnerId: input.lease.holderId, revision: input.lease.revision,
            fencingToken: new Prisma.Decimal(input.lease.fencingToken), leaseExpiresAt: { gt: authority.clock() } } });
          if (!task || !run || waiting.receipt.kind === 'absent' && (!task.cancelRequestedAt || !['CANCEL_REQUESTED', 'CANCELLED'].includes(task.status))) return false;
          const phases = taskExecutionPhaseStore(tx), starts = await phases.readStarts(key), receipts = await phases.readReceipts(key);
          if (starts.length !== 1 || receipts.length !== 1) return false;
          const start = starts[0], receipt = receipts[0], plan = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
            scopeId: key.scopeId, taskId: key.taskId, runId: key.runId } } });
          const payload = z.object({ version: z.literal('approved-profile-wait-1'), binding: z.unknown(), effectState: z.literal('awaiting_decision') }).passthrough().safeParse(receipt.payload);
          if (!plan || requestFingerprint(plan.payload) !== plan.planHash || start.planHash !== plan.planHash
            || start.sequence !== 1 || start.actionId !== input.actionId || start.inputRef !== input.inputRef || start.stepFingerprint !== input.fingerprint
            || receipt.phaseId !== start.id || receipt.kind !== 'confirmation' || requestFingerprint(receipt.payload) !== receipt.contentHash
            || receipt.proposalId !== waiting.proposal.proposalId || receipt.proposalRevision !== waiting.proposal.proposalRevision
            || receipt.reviewedPayloadHash !== waiting.proposal.reviewedPayloadHash || !payload.success
            || requestFingerprint(payload.data.binding) !== requestFingerprint(waiting.binding)) return false;
          if (await tx.aiApprovalConsumption.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, actionId: input.actionId } })
            || await tx.customerApprovedProfileOperation.findFirst({ where: { tenantId: found.grant.actor.tenantId,
              customerId: found.customerId, changeId: input.inputRef } })) return false;
          const approval = await tx.aiApproval.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId,
            proposalId: waiting.proposal.proposalId, proposalRevision: waiting.proposal.proposalRevision } });
          return waiting.receipt.kind === 'absent' ? !approval : !!approval && approval.id === waiting.receipt.record.approvalId
            && approval.decision === 'REJECTED' && approval.payloadHash === waiting.proposal.reviewedPayloadHash
            && approval.actorKind === 'USER' && approval.actorId === found.grant.actor.actorId;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
        if (witness) return { kind: 'failed', errorCode: waiting.receipt.kind === 'absent' ? 'AI_CANCELLED' : 'AI_APPROVAL_REJECTED',
          payload: material(waiting, waiting.receipt.kind === 'absent' ? 'cancelled_before_business_submission' : 'rejected') };
      }
      return { kind: 'unknown', payload: material(waiting, 'unresolved') };
    }
    if (waiting.kind !== 'waiting_reference' || waiting.receipt.kind !== 'recorded' || waiting.receipt.record.decision !== 'approved'
      || operation.receipt.changeId !== input.inputRef || operation.receipt.changeHash !== input.fingerprint
      || operation.receipt.operationKey !== found.operationKey) throw profileDenied();
    return { kind: 'succeeded', payload: { ...material(waiting, 'committed'),
      businessResultRef: `profile:${operation.receipt.receiptId}:${requestFingerprint(operation.receipt)}`, replayed: true } };
  };
  const execute: Executor['execute'] = async (raw, signal) => {
    const input = parse(raw);
    if (signal.aborted) throw profileUnavailable();
    if (input.lease.purpose === 'recovery_only') return reconcile(input, signal);
    const found = await locate(input, true); let waiting = await readWaiting(input);
    if (waiting.kind === 'missing') {
      try { const { taskId: _, purpose: __, ...lease } = input.lease; await app.prepareProposal(found.prepare, lease); }
      catch { return { kind: 'unknown', payload: material(waiting, 'preparation_unknown') }; }
      waiting = await readWaiting(input);
    }
    if (signal.aborted || waiting.kind !== 'waiting_reference') return { kind: 'unknown', payload: material(waiting, 'unresolved') };
    if (waiting.receipt.kind !== 'recorded') return { kind: 'paused', pause: 'confirmation', payload: material(waiting, 'awaiting_decision') };
    if (waiting.receipt.record.decision === 'rejected') return { kind: 'failed', errorCode: 'AI_APPROVAL_REJECTED', payload: material(waiting, 'rejected') };
    await locate(input, true);
    try { const { taskId: _, purpose: __, ...lease } = input.lease;
      await app.commitApprovedChange({ ...waiting.reference, operationKey: found.operationKey, approvalId: waiting.receipt.record.approvalId }, lease);
    } catch { return { kind: 'unknown', payload: material(waiting, 'unresolved') }; }
    return reconcile(input, signal);
  };
  const readCommittedChange = async (value: { taskId: string; customerId: string; changeId: string; changeHash: string }) => {
    const before = await authority.resolve(value.taskId, 'read');
    const steps = await d.db.aiStep.findMany({ where: { scopeId: before.scopeId, taskId: value.taskId,
      inputRef: value.changeId, requestFingerprint: value.changeHash, toolCode: PROFILE_NAME_TOOL_CODE, toolVersion: AI_TOOL_DRAFT_VERSION }, take: 2 });
    if (steps.length !== 1) throw profileDenied();
    const step = steps[0], binding = { scopeId: before.scopeId, taskId: value.taskId, runId: step.runId, stepId: step.id,
      actionId: step.actionId, inputRef: value.changeId, fingerprint: value.changeHash };
    const change = await app.readChangeReceipt({ customerId: value.customerId, changeId: value.changeId, changeHash: value.changeHash });
    if (change.customerId !== value.customerId) throw profileDenied();
    const result = await app.readOriginalOperation({ customerId: value.customerId,
      operationKey: `profile-operation-${requestFingerprint(binding)}` });
    if ((await authority.resolve(value.taskId, 'read')).bindingHash !== before.bindingHash) throw profileDenied();
    return result.state === 'committed' ? result.receipt : null;
  };
  return Object.freeze({ application: app, execute, readCommittedChange,
    readWaiting: (raw: Input, tx?: Prisma.TransactionClient): ReturnType<typeof readWaiting> => tx
      ? composeApprovedProfileWaiting({ ...d, db: profileTransactionDb(d.db, tx) }).readWaiting(raw) : readWaiting(raw),
    reconcile: (raw: Input, tx?: Prisma.TransactionClient): ReturnType<Executor['execute']> => tx
      ? composeApprovedProfileWaiting({ ...d, db: profileTransactionDb(d.db, tx) }).reconcile(raw) : reconcile(raw, new AbortController().signal),
    readInterrupted: (raw: Input) => reconcile(raw, new AbortController().signal),
    resolve: async (code: string, version: string) => code === PROFILE_NAME_TOOL_CODE && version === AI_TOOL_DRAFT_VERSION
      ? Object.freeze({ operation: 'idempotent' as const, execute }) : null });
}
