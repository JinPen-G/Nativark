import { AI_TOOL_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION } from '@rental-os/shared';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AI_APPROVED_SETTINGS_DRAFT_VERSION, AI_APPROVED_SETTINGS_TOOL_CODE } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiTaskRegisteredExecutor } from '../runner/prisma-task-measured-effects';
import { composeApprovedSettingsApplication } from './approved-settings-application.composition';
import { ApprovedSettingsTaskAuthority, settingsTransactionDb, settingsDenied, type ApprovedSettingsApplicationDependencies } from './approved-settings-task.authority';
import { taskExecutionPhaseStore } from '../runner/task-execution-phase.store';

type Executor = NonNullable<Awaited<ReturnType<AiTaskRegisteredExecutor['resolve']>>>;
type Input = Parameters<Executor['execute']>[0];
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const bindingSchema = z.object({ taskId: id.max(36), runId: id.max(36), stepId: id.max(36), actionId: id,
  inputRef: id.max(36), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  lease: z.object({ taskId: id.max(36), runId: id.max(36), holderId: id, revision: z.number().int().positive(),
    fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u), expiresAt: z.string().datetime({ offset: true }),
    purpose: z.literal('recovery_only').optional() }).strict(), clarifications: z.array(z.unknown()).optional() }).strict();

/** Settings-specific business boundary. Construction binds the real authorized
 * application, not caller-provided approval/commit callbacks. This executor does
 * not claim a lease, grant dispatch, decide approval, or start a background loop.
 * The durable runner still owns phase receipts, metering and checkpoint CAS. */
export function composeApprovedSettingsWaiting(d: ApprovedSettingsApplicationDependencies) {
  const app = composeApprovedSettingsApplication(d), authority = new ApprovedSettingsTaskAuthority(d);
  const parse = (raw: Input) => {
    const result = bindingSchema.safeParse(raw);
    if (!result.success || result.data.taskId !== result.data.lease.taskId || result.data.runId !== result.data.lease.runId
        || result.data.lease.holderId !== d.holderId) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (result.data.clarifications?.length) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const { clarifications: _, ...binding } = result.data;
    return binding;
  };
  const locate = async (input: ReturnType<typeof parse>, executing = false) => {
    const grant = await authority.resolve(input.taskId, executing ? 'execute' : 'read');
    const key = { scopeId: grant.scopeId, taskId: input.taskId, runId: input.runId, id: input.stepId, actionId: input.actionId };
    const step = await d.db.aiStep.findFirst({ where: key });
    if (!step || Object.entries(key).some(([k, v]) => step[k as keyof typeof step] !== v)
        || step.toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
        || step.inputRef !== input.inputRef || step.requestFingerprint !== input.fingerprint) throw settingsDenied();
    if (executing) {
      const run = await d.db.aiRun.findFirst({ where: { id: input.runId, scopeId: grant.scopeId, taskId: input.taskId } });
      if (!run || run.status !== 'RUNNING' || run.actorKind !== 'USER' || run.actorId !== grant.actor.actorId
          || run.leaseOwnerId !== input.lease.holderId || run.revision !== input.lease.revision
          || run.fencingToken.toFixed(0) !== input.lease.fencingToken || !run.leaseExpiresAt
          || run.leaseExpiresAt.getTime() !== Date.parse(input.lease.expiresAt) || run.leaseExpiresAt <= authority.clock()
          || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE') throw settingsDenied();
    }
    const binding = { scopeId: grant.scopeId, taskId: input.taskId, runId: input.runId, stepId: input.stepId,
      actionId: input.actionId, inputRef: input.inputRef, fingerprint: input.fingerprint };
    const digest = requestFingerprint(binding);
    const prepare = { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, taskId: input.taskId, runId: input.runId,
      stepId: input.stepId, proposalId: `as-${digest.slice(0, 32)}`, proposalRevision: 1,
      changeId: input.inputRef, changeHash: input.fingerprint };
    return { binding, prepare, operationKey: `as-operation-${digest}`, grant };
  };
  const readWaiting = async (raw: Input) => {
    const input = parse(raw), first = await locate(input);
    const prepared = await app.readPreparationReceipt(first.prepare);
    const latest = await locate(input);
    if (first.grant.bindingHash !== latest.grant.bindingHash) throw settingsDenied();
    if (prepared.state !== 'prepared') return { kind: 'missing' as const, binding: first.binding, lease: input.lease };
    const review = await app.readProposal(prepared.reference);
    const action = review.proposal.payload.actions[0];
    if (action.actionId !== input.actionId || action.input.recordId !== input.inputRef
        || action.input.contentHash !== input.fingerprint || review.change.changeId !== input.inputRef
        || review.change.changeHash !== input.fingerprint) throw settingsDenied();
    const receipt = await app.readDecisionReceipt(prepared.reference);
    if ((await locate(input)).grant.bindingHash !== first.grant.bindingHash) throw settingsDenied();
    return { kind: 'waiting_reference' as const, binding: first.binding, lease: input.lease,
      reference: prepared.reference,
      proposal: { contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: prepared.reference.proposalId,
        proposalRevision: prepared.reference.proposalRevision, reviewedPayloadHash: prepared.reference.reviewedPayloadHash },
      receipt: receipt.state === 'recorded' ? { kind: 'recorded' as const, record: receipt.approval } : { kind: 'absent' as const, retryable: false as const } };
  };
  const material = (waiting: Awaited<ReturnType<typeof readWaiting>>, effectState: string) => {
    const { purpose: _purpose, ...presentedLease } = waiting.lease;
    return { version: 'approved-settings-wait-1', binding: waiting.binding, presentedLease, effectState,
      ...(waiting.kind === 'waiting_reference' ? { proposal: waiting.proposal,
        ...(waiting.receipt.kind === 'recorded' ? { decisionRef: waiting.receipt.record.approvalId,
          decision: waiting.receipt.record.decision } : {}) } : {}) };
  };
  const reconcile = async (raw: Input, transaction?: Prisma.TransactionClient): ReturnType<Executor['execute']> => {
    const input = parse(raw), found = await locate(input), waiting = await readWaiting(input);
    // Only an original-key business receipt proves commit. "Not observed" is
    // not permission to retry, including after expiry or a lost COMMIT reply.
    const result = await app.readOperation({ draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, operationKey: found.operationKey });
    if (result.state !== 'committed') {
      if (waiting.kind === 'waiting_reference' && waiting.receipt.kind === 'absent') {
        const key = { scopeId: found.binding.scopeId, taskId: input.taskId, runId: input.runId, stepId: input.stepId };
        const witness = async (tx: Prisma.TransactionClient) => {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${key.scopeId} AND id = ${key.taskId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${key.scopeId} AND taskId = ${key.taskId} AND id = ${key.runId} FOR UPDATE`);
          const task = await tx.aiTask.findFirst({ where: { id: key.taskId, scopeId: key.scopeId,
            ownerKind: 'USER', ownerId: found.grant.actor.actorId, status: { in: ['CANCEL_REQUESTED', 'CANCELLED'] }, cancelRequestedAt: { not: null } } });
          const run = await tx.aiRun.findFirst({ where: { id: key.runId, scopeId: key.scopeId, taskId: key.taskId,
            actorKind: 'USER', actorId: found.grant.actor.actorId, leaseOwnerId: input.lease.holderId,
            revision: input.lease.revision, fencingToken: new Prisma.Decimal(input.lease.fencingToken),
            leaseExpiresAt: { gt: authority.clock() } } });
          const step = await tx.aiStep.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId,
            id: key.stepId, actionId: input.actionId,
            inputRef: input.inputRef, requestFingerprint: input.fingerprint,
            status: { in: ['RUNNING', 'UNKNOWN', 'FAILED'] }, effect: { in: ['NONE', 'POSSIBLE'] } } });
          if (!task || !run || !step || step.status === 'FAILED' && (step.errorCode !== 'AI_BUSINESS_REJECTED' || step.effect !== 'NONE')) return false;
          const phases = taskExecutionPhaseStore(tx), starts = await phases.readStarts(key), receipts = await phases.readReceipts(key);
          if (starts.length !== 1 || receipts.length !== 1) return false;
          const start = starts[0], receipt = receipts[0];
          const plan = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
            scopeId: key.scopeId, taskId: key.taskId, runId: key.runId } } });
          const payload = z.object({ version: z.literal('approved-settings-wait-1'), binding: z.unknown(),
            effectState: z.literal('awaiting_decision') }).passthrough().safeParse(receipt.payload);
          if (start.sequence !== 1 || start.actionId !== input.actionId || start.inputRef !== input.inputRef
            || start.stepFingerprint !== input.fingerprint || !plan || plan.planHash !== start.planHash
            || requestFingerprint(plan.payload) !== start.planHash || receipt.phaseId !== start.id || receipt.kind !== 'confirmation'
            || requestFingerprint(receipt.payload) !== receipt.contentHash || receipt.proposalId !== waiting.proposal.proposalId
            || receipt.proposalRevision !== waiting.proposal.proposalRevision || receipt.reviewedPayloadHash !== waiting.proposal.reviewedPayloadHash
            || !payload.success || requestFingerprint(payload.data.binding) !== requestFingerprint(waiting.binding)) return false;
          const approval = await tx.aiApproval.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId,
            proposalId: waiting.proposal.proposalId, proposalRevision: waiting.proposal.proposalRevision } });
          const consumption = await tx.aiApprovalConsumption.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, actionId: input.actionId } });
          const operation = await tx.rentalApprovedSettingsOperation.findFirst({ where: { operationKey: found.operationKey } });
          return !approval && !consumption && !operation;
        };
        const notSubmitted = transaction ? await witness(transaction) : await d.db.$transaction(witness,
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
        if (notSubmitted) {
          const latest = await readWaiting(input);
          if (latest.kind !== 'waiting_reference' || latest.receipt.kind !== 'absent'
            || requestFingerprint(latest.binding) !== requestFingerprint(waiting.binding)) throw settingsDenied();
          return { kind: 'failed', errorCode: 'AI_CANCELLED', payload: material(waiting, 'cancelled_before_business_submission') };
        }
      }
      return { kind: 'unknown', payload: material(waiting, 'unresolved') };
    }
    if (waiting.kind !== 'waiting_reference' || waiting.receipt.kind !== 'recorded' || waiting.receipt.record.decision !== 'approved'
        || result.receipt.changeId !== input.inputRef || result.receipt.changeHash !== input.fingerprint
        || result.receipt.operationKey !== found.operationKey) throw settingsDenied();
    return { kind: 'succeeded', payload: { ...material(waiting, 'committed'),
      businessResultRef: `settings:${result.receipt.receiptId}:${requestFingerprint(result.receipt)}`, replayed: true } };
  };
  const execute: Executor['execute'] = async (raw, signal) => {
    const input = parse(raw);
    if (signal.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    if (input.lease.purpose === 'recovery_only') return reconcile(input);
    const initial = await locate(input, true);
    let waiting = await readWaiting(input);
    if (waiting.kind === 'missing') {
      if (signal.aborted) return { kind: 'unknown', payload: material(waiting, 'unresolved') };
      try { await app.prepare(initial.prepare); }
      catch (error) {
        if (error instanceof AiTaskRepositoryError) throw error;
        return { kind: 'unknown', payload: material(waiting, 'preparation_unknown') };
      }
      waiting = await readWaiting(input);
    }
    if (signal.aborted || waiting.kind !== 'waiting_reference') return { kind: 'unknown', payload: material(waiting, 'unresolved') };
    // Observing the proposal just persisted is not another execution. Preserve
    // its waiting/result receipt if new execution closes during preparation;
    // a later commit still needs today's full execute authority below.
    if (waiting.receipt.kind !== 'recorded') return { kind: 'paused', pause: 'confirmation', payload: material(waiting, 'awaiting_decision') };
    if (waiting.receipt.record.decision === 'rejected') return { kind: 'failed', errorCode: 'AI_APPROVAL_REJECTED', payload: material(waiting, 'rejected') };
    await locate(input, true);
    try {
      await app.commitApprovedChange({ ...waiting.reference, operationKey: initial.operationKey, approvalId: waiting.receipt.record.approvalId });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      return { kind: 'unknown', payload: material(waiting, 'unresolved') };
    }
    return reconcile(input);
  };
  const readCommittedChange = async (value: { taskId: string; changeId: string; changeHash: string }) => {
    const command = z.object({ taskId: id.max(36), changeId: id.max(36), changeHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().parse(structuredClone(value));
    const before = await authority.resolve(command.taskId, 'read');
    const steps = await d.db.aiStep.findMany({ where: { scopeId: before.scopeId, taskId: command.taskId,
      inputRef: command.changeId, requestFingerprint: command.changeHash, toolCode: AI_APPROVED_SETTINGS_TOOL_CODE,
      toolVersion: AI_TOOL_DRAFT_VERSION }, take: 2 });
    if (steps.length !== 1) throw settingsDenied();
    const step = steps[0];
    const binding = { scopeId: before.scopeId, taskId: command.taskId, runId: step.runId, stepId: step.id,
      actionId: step.actionId, inputRef: command.changeId, fingerprint: command.changeHash };
    const operationKey = `as-operation-${requestFingerprint(binding)}`;
    const result = await app.readOperation({ draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, operationKey });
    if ((await authority.resolve(command.taskId, 'read')).bindingHash !== before.bindingHash) throw settingsDenied();
    if (result.state !== 'committed') return null;
    if (result.receipt.operationKey !== operationKey || result.receipt.changeId !== command.changeId
        || result.receipt.changeHash !== command.changeHash) throw settingsDenied();
    return result.receipt;
  };
  const readWaitingInTransaction = (raw: Input, tx?: Prisma.TransactionClient): ReturnType<typeof readWaiting> => tx
    ? composeApprovedSettingsWaiting({ ...d, db: settingsTransactionDb(d.db, tx) }).readWaiting(raw) : readWaiting(raw);
  const reconcileInTransaction = (raw: Input, tx?: Prisma.TransactionClient): ReturnType<typeof reconcile> => tx
    ? composeApprovedSettingsWaiting({ ...d, db: settingsTransactionDb(d.db, tx) }).reconcile(raw) : reconcile(raw);
  return Object.freeze({ application: app, execute, readWaiting: readWaitingInTransaction, reconcile: reconcileInTransaction, readInterrupted: reconcile, readCommittedChange,
    resolve: async (code: string, version: string) => code === AI_APPROVED_SETTINGS_TOOL_CODE && version === AI_TOOL_DRAFT_VERSION
      ? Object.freeze({ operation: 'idempotent' as const, execute }) : null });
}
