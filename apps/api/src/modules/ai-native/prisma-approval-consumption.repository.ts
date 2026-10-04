import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiApprovalConsumptionRecord, AiApprovalConsumptionRepository } from './approval-consumption.ports';

type Db = Pick<PrismaClient, '$transaction' | 'aiApproval' | 'aiApprovalConsumption' | 'aiProposal' | 'aiProposalAction' | 'aiProposalVersion'>;
type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

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
export class PrismaAiApprovalConsumptionRepository implements AiApprovalConsumptionRepository {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

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
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiApprovalConsumptionRepositoryError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AiApprovalConsumptionRepositoryError('CONFLICT');
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
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiApprovalConsumptionRepositoryError) throw error;
      throw new AiApprovalConsumptionRepositoryError('STORAGE_UNAVAILABLE');
    }
  }

  commit(input: { scopeId: string; taskId: string; actionId: string; businessIdempotencyKey: string; resultRef: string }) { return this.transition(input, 'COMMITTED', input.resultRef); }
  markUnknown(input: { scopeId: string; taskId: string; actionId: string; businessIdempotencyKey: string }) { return this.transition(input, 'UNKNOWN'); }
  markFailedNoEffect(input: { scopeId: string; taskId: string; actionId: string; businessIdempotencyKey: string }) { return this.transition(input, 'FAILED_NO_EFFECT'); }
}
