/** Original C05 action consumption and durable recovery. Core supplies only its effect proof. */
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiApprovalConsumptionInput, AiApprovalConsumptionRecord, AiApprovalConsumptionRepository } from './approval-consumption.ports';
import { z } from 'zod';
import { aiTaskAccessFromContext } from './task-owner-access';
import { isAiStepExecutionContext } from '../execution-context-validation';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import type { AiTaskTransactionBoundary } from '../task-transactions';
import { bindAiBodyStorageTransaction } from './privacy/prisma-ai-body-storage';

type Db = Pick<PrismaClient, '$transaction' | 'aiApproval' | 'aiApprovalConsumption' | 'aiProposal' | 'aiProposalAction' | 'aiProposalVersion'>;
type Tx = Prisma.TransactionClient;
export type ApprovalConsumptionDatabase = Db;
export interface HeldApprovalConsumptionInput extends AiApprovalConsumptionInput {
  lease: { runId: string; holderId: string; revision: number; fencingToken: string };
}
/** The original business transaction owns its result, idempotency and locks.
 * These ports must reauthorize and attest the exact native effect. */
export interface ApprovalEffectSource<Binding> {
  resolve(input: Readonly<HeldApprovalConsumptionInput>, binding: Readonly<Binding>, action: 'execute' | 'replay', tx?: Tx): Promise<AiExecutionContext>;
  assertCommitted(tx: Tx, binding: Readonly<Binding>, resultRef: string): Promise<void>;
}


export class AiApprovalConsumptionRepositoryError extends Error {
  constructor(readonly code: 'INVALID_BINDING' | 'CONFLICT' | 'UNKNOWN' | 'STORAGE_UNAVAILABLE') { super(code); this.name = 'AiApprovalConsumptionRepositoryError'; }
}

const select = {
  scopeId: true, taskId: true, actionId: true, approvalId: true, proposalId: true,
  proposalRevision: true, actionFingerprint: true, businessIdempotencyKey: true,
  status: true, resultRef: true
} satisfies Prisma.AiApprovalConsumptionSelect;

const project = (row: { scopeId: string; taskId: string; actionId: string; approvalId: string; proposalId: string; proposalRevision: number; actionFingerprint: string; businessIdempotencyKey: string; status: string; resultRef: string | null }): AiApprovalConsumptionRecord => ({
  scopeId: row.scopeId, taskId: row.taskId, actionId: row.actionId, approvalId: row.approvalId,
  proposalId: row.proposalId, proposalRevision: row.proposalRevision, actionFingerprint: row.actionFingerprint,
  businessIdempotencyKey: row.businessIdempotencyKey, status: row.status as AiApprovalConsumptionRecord['status'], resultRef: row.resultRef
});

/**
 * Prisma adapter for the already-migrated AIN-07 tables. Core still owns the
 * business transaction: this adapter only reserves/records the approval action.
 */
export class ApprovalConsumptionPersistenceRepository implements AiApprovalConsumptionRepository {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  protected effectTransaction<Binding>(value: HeldApprovalConsumptionInput, toolCode: string, source: ApprovalEffectSource<Binding>,
    transactions?: Pick<AiTaskTransactionBoundary<Tx>, 'withHeldAiTaskTransaction'>) {
    const identifier = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
    const parsed = z.object({ context: z.unknown(), scopeId: identifier.max(36), taskId: identifier.max(36), actionId: identifier,
      approvalId: identifier.max(36), proposalId: identifier.max(36), proposalRevision: z.number().int().positive().max(4294967294),
      actionFingerprint: z.string().regex(/^[a-f0-9]{64}$/u), businessIdempotencyKey: identifier,
      lease: z.object({ runId: identifier.max(36), holderId: identifier, revision: z.number().int().positive().max(4294967294),
        fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict()
    }).strict().safeParse(structuredClone(value));
    if (!parsed.success || !isAiStepExecutionContext(parsed.data.context) || !identifier.safeParse(toolCode).success || !source
      || typeof source.resolve !== 'function' || typeof source.assertCommitted !== 'function') throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
    const input: HeldApprovalConsumptionInput = { ...parsed.data, context: parsed.data.context };
    if (input.context.actor.kind === 'automation') throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
    const authorizeEffect = source.resolve.bind(source), assertCommitted = source.assertCommitted.bind(source);
    const identity = (context: HeldApprovalConsumptionInput['context']) => {
      const { requestId: _, authorizedAt: __, ...bound } = context;
      return requestFingerprint(bound);
    };
    const current = async (binding: Readonly<Binding>, action: 'execute' | 'replay', tx?: Tx) => {
      try {
        const context = structuredClone(await authorizeEffect(structuredClone(input), structuredClone(binding), action, tx));
        if (!isAiStepExecutionContext(context) || identity(context) !== identity(input.context)) throw Error();
        return aiTaskAccessFromContext(context, input.taskId, this.clock());
      } catch { throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING'); }
    };
    const where = { scopeId: input.scopeId, taskId: input.taskId, actionId: input.actionId };
    const same = (row: AiApprovalConsumptionRecord) => row.approvalId === input.approvalId && row.proposalId === input.proposalId
      && row.proposalRevision === input.proposalRevision && row.actionFingerprint === input.actionFingerprint
      && row.businessIdempotencyKey === input.businessIdempotencyKey;
    const read = async (binding: Readonly<Binding>) => this.db.$transaction(async tx => {
      const access = await current(binding, 'replay', tx);
      const task = await tx.aiTask.findFirst({ where: { ...access.where, scopeId: input.scopeId }, select: { id: true } });
      if (!task) throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
      const row = await tx.aiApprovalConsumption.findFirst({ where, select });
      if (row && !same(project(row))) throw new AiApprovalConsumptionRepositoryError('CONFLICT');
      if (row && (row.status !== 'COMMITTED' || !row.resultRef)) throw new AiApprovalConsumptionRepositoryError('UNKNOWN');
      await current(binding, 'replay', tx);
      return row?.resultRef ?? null;
    // This is a non-writing observation, not consumption or execution admission.
    // Keep both current-binding checks, but avoid shared SELECT locks behind a
    // caller's business writes and allow their bounded original-input readers.
    }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 15000 });
    const verify = async (tx: Tx, binding: Readonly<Binding>) => {
      const access = await current(binding, 'execute', tx);
      const taskWhere = { ...access.where, scopeId: input.scopeId, status: 'RUNNING' as const, cancelRequestedAt: null };
      const task = await tx.aiTask.findFirst({ where: taskWhere, select: { revision: true } });
      if (!task) throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
      const taskLock = await tx.aiTask.updateMany({ where: { ...taskWhere, revision: task.revision }, data: { revision: task.revision } });
      if (taskLock.count !== 1) throw new AiApprovalConsumptionRepositoryError('CONFLICT');
      const held = await tx.aiRun.updateMany({ where: { id: input.lease.runId, scopeId: input.scopeId, taskId: input.taskId,
        revision: input.lease.revision, fencingToken: new prismaRuntime.Decimal(input.lease.fencingToken), leaseOwnerId: input.lease.holderId,
        leaseExpiresAt: { gt: access.now }, actorKind: access.actorKind, actorId: access.actorId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { authorizedAt: access.authorizedAt } });
      if (held.count !== 1) throw new AiApprovalConsumptionRepositoryError('CONFLICT');
      const proposal = await tx.aiProposal.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, id: input.proposalId }, select: { stateRevision: true, status: true, currentRevision: true } });
      if (!proposal || proposal.status !== 'CONFIRMED' || proposal.currentRevision !== input.proposalRevision) throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
      const locked = await tx.aiProposal.updateMany({ where: { scopeId: input.scopeId, taskId: input.taskId, id: input.proposalId,
        stateRevision: proposal.stateRevision, status: 'CONFIRMED', currentRevision: input.proposalRevision }, data: { stateRevision: proposal.stateRevision } });
      if (locked.count !== 1) throw new AiApprovalConsumptionRepositoryError('CONFLICT');
      const approval = await tx.aiApproval.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, id: input.approvalId,
        proposalId: input.proposalId, proposalRevision: input.proposalRevision, actorKind: access.actorKind, actorId: access.actorId, audience: access.audience },
        select: { payloadHash: true, expiresAt: true, decision: true } });
      const version = await tx.aiProposalVersion.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, proposalId: input.proposalId,
        revision: input.proposalRevision }, select: { payloadHash: true, expiresAt: true } });
      const action = await tx.aiProposalAction.findFirst({ where: { ...where, proposalId: input.proposalId, proposalRevision: input.proposalRevision,
        requestFingerprint: input.actionFingerprint, step: { is: { scopeId: input.scopeId, taskId: input.taskId, runId: input.lease.runId,
          actionId: input.actionId, toolCode, requestFingerprint: input.actionFingerprint, status: 'RUNNING' } } }, select: { actionId: true } });
      const latest = await current(binding, 'execute', tx);
      if (!approval || approval.decision !== 'APPROVED' || approval.expiresAt <= latest.now || !version
        || version.payloadHash !== approval.payloadHash || version.expiresAt <= latest.now || !action) throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
      const live = await tx.aiRun.updateMany({ where: { id: input.lease.runId, scopeId: input.scopeId, taskId: input.taskId,
        revision: input.lease.revision, fencingToken: new prismaRuntime.Decimal(input.lease.fencingToken), leaseOwnerId: input.lease.holderId,
        leaseExpiresAt: { gt: latest.now }, actorKind: latest.actorKind, actorId: latest.actorId }, data: { authorizedAt: latest.authorizedAt } });
      if (live.count !== 1) throw new AiApprovalConsumptionRepositoryError('CONFLICT');
    };
    const underBusinessLock = <T>(native: Tx, work: (tx: Tx) => Promise<T>) => {
      // The held lease belongs to Native. Use the protected view only inside it.
      const consume = () => work(bindAiBodyStorageTransaction(this.db, native));
      return transactions ? transactions.withHeldAiTaskTransaction(native, { kind: 'task', taskId: input.taskId }, consume) : consume();
    };
    return {
      authorize: async (binding: Readonly<Binding>) => { await current(binding, 'execute'); },
      recover: (binding: Readonly<Binding>) => read(structuredClone(binding)),
      replay: async (binding: Readonly<Binding>, resultRef: string) => {
        if (await read(structuredClone(binding)) !== resultRef) throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
      },
      prepare: (native: Tx, binding: Readonly<Binding>) => underBusinessLock(native, async tx => {
        await verify(tx, binding);
        const existing = await tx.aiApprovalConsumption.findFirst({ where, select });
        if (existing) throw new AiApprovalConsumptionRepositoryError(same(project(existing)) ? 'UNKNOWN' : 'CONFLICT');
        const { context: _, lease: __, ...record } = input;
        await tx.aiApprovalConsumption.create({ data: { ...record, status: 'RESERVED', resultRef: null }, select });
      }),
      commit: (native: Tx, binding: Readonly<Binding>, resultRef: string) => underBusinessLock(native, async tx => {
        if (!identifier.safeParse(resultRef).success) throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
        await verify(tx, binding);
        await assertCommitted(tx, structuredClone(binding), resultRef);
        const { context: _, lease: __, ...bound } = input;
        const changed = await tx.aiApprovalConsumption.updateMany({ where: { ...bound, status: 'RESERVED', resultRef: null }, data: { status: 'COMMITTED', resultRef } });
        if (changed.count !== 1) throw new AiApprovalConsumptionRepositoryError('CONFLICT');
        await verify(tx, binding);
      })
    };
  }

  async reserve(input: Omit<AiApprovalConsumptionRecord, 'status' | 'resultRef'>): Promise<AiApprovalConsumptionRecord> {
    try {
      return await this.db.$transaction(async (tx: Tx) => {
        const proposal = await tx.aiProposal.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, id: input.proposalId }, select: { status: true, currentRevision: true } });
        const approval = await tx.aiApproval.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, id: input.approvalId, proposalId: input.proposalId, proposalRevision: input.proposalRevision }, select: { decision: true, expiresAt: true, payloadHash: true } });
        const version = await tx.aiProposalVersion.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, proposalId: input.proposalId, revision: input.proposalRevision }, select: { payloadHash: true, expiresAt: true } });
        const action = await tx.aiProposalAction.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, proposalId: input.proposalId, proposalRevision: input.proposalRevision, actionId: input.actionId, requestFingerprint: input.actionFingerprint }, select: { actionId: true } });
        const now = this.clock();
        if (!proposal || proposal.status !== 'CONFIRMED' || proposal.currentRevision !== input.proposalRevision
          || !approval || approval.decision !== 'APPROVED' || approval.expiresAt <= now
          || !version || version.payloadHash !== approval.payloadHash || version.expiresAt <= now || !action) {
          throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
        }
        const existing = await tx.aiApprovalConsumption.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, actionId: input.actionId }, select });
        if (existing) {
          const same = existing.approvalId === input.approvalId && existing.proposalId === input.proposalId
            && existing.proposalRevision === input.proposalRevision && existing.actionFingerprint === input.actionFingerprint
            && existing.businessIdempotencyKey === input.businessIdempotencyKey;
          if (!same) throw new AiApprovalConsumptionRepositoryError('CONFLICT');
          return project(existing);
        }
        const row = await tx.aiApprovalConsumption.create({ data: {
          scopeId: input.scopeId, taskId: input.taskId, actionId: input.actionId, approvalId: input.approvalId,
          proposalId: input.proposalId, proposalRevision: input.proposalRevision, actionFingerprint: input.actionFingerprint,
          businessIdempotencyKey: input.businessIdempotencyKey, status: 'RESERVED', resultRef: null
        }, select });
        return project(row);
      }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiApprovalConsumptionRepositoryError) throw error;
      if (error instanceof prismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002') throw new AiApprovalConsumptionRepositoryError('CONFLICT');
      throw new AiApprovalConsumptionRepositoryError('STORAGE_UNAVAILABLE');
    }
  }

  private async transition(input: { scopeId: string; taskId: string; actionId: string; businessIdempotencyKey: string }, to: 'COMMITTED' | 'UNKNOWN' | 'FAILED_NO_EFFECT', resultRef?: string) {
    try {
      return await this.db.$transaction(async (tx: Tx) => {
        const current = await tx.aiApprovalConsumption.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, actionId: input.actionId }, select });
        if (!current || current.businessIdempotencyKey !== input.businessIdempotencyKey) throw new AiApprovalConsumptionRepositoryError('CONFLICT');
        if (current.status === to) {
          if (to === 'COMMITTED' && current.resultRef !== resultRef) throw new AiApprovalConsumptionRepositoryError('CONFLICT');
          return project(current);
        }
        if (current.status !== 'RESERVED') {
          // UNKNOWN is deliberately sticky; callers must use a separate trusted reconcile path.
          throw new AiApprovalConsumptionRepositoryError(current.status === 'UNKNOWN' ? 'UNKNOWN' : 'CONFLICT');
        }
        const changed = await tx.aiApprovalConsumption.updateMany({
          where: { scopeId: input.scopeId, taskId: input.taskId, actionId: input.actionId, businessIdempotencyKey: input.businessIdempotencyKey, status: 'RESERVED' },
          data: { status: to, resultRef: to === 'COMMITTED' ? resultRef! : null }
        });
        if (changed.count !== 1) throw new AiApprovalConsumptionRepositoryError('CONFLICT');
        const next = await tx.aiApprovalConsumption.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, actionId: input.actionId }, select });
        if (!next) throw new AiApprovalConsumptionRepositoryError('STORAGE_UNAVAILABLE');
        return project(next);
      }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiApprovalConsumptionRepositoryError) throw error;
      throw new AiApprovalConsumptionRepositoryError('STORAGE_UNAVAILABLE');
    }
  }

  commit(input: { scopeId: string; taskId: string; actionId: string; businessIdempotencyKey: string; resultRef: string }) { return this.transition(input, 'COMMITTED', input.resultRef); }
  markUnknown(input: { scopeId: string; taskId: string; actionId: string; businessIdempotencyKey: string }) { return this.transition(input, 'UNKNOWN'); }
  markFailedNoEffect(input: { scopeId: string; taskId: string; actionId: string; businessIdempotencyKey: string }) { return this.transition(input, 'FAILED_NO_EFFECT'); }
}
