import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiProposalPayloadDraft } from '@rental-os/shared';
import { fingerprintAiProposalDraft } from './proposal-binding-draft';

type Db = Pick<PrismaClient, '$transaction' | 'aiProposal' | 'aiProposalVersion' | 'aiProposalAction'>;
type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface AiProposalActionBinding { actionId: string; requestFingerprint: string; }
export interface AiProposalCreateInput { scopeId: string; taskId: string; payload: AiProposalPayloadDraft; actions: readonly AiProposalActionBinding[]; }
export interface AiProposalHead { scopeId: string; taskId: string; proposalId: string; stateRevision: number; currentRevision: number | null; status: string; payloadHash: string; }

export class AiProposalRepositoryError extends Error {
  constructor(readonly code: 'INVALID' | 'CONFLICT' | 'UNAVAILABLE') { super(code); this.name = 'AiProposalRepositoryError'; }
}

const headSelect = { scopeId: true, taskId: true, id: true, stateRevision: true, currentRevision: true, status: true, currentVersion: { select: { payloadHash: true } } } satisfies Prisma.AiProposalSelect;
const project = (row: { scopeId: string; taskId: string; id: string; stateRevision: number; currentRevision: number | null; status: string; currentVersion: { payloadHash: string } | null }): AiProposalHead => ({ scopeId: row.scopeId, taskId: row.taskId, proposalId: row.id, stateRevision: row.stateRevision, currentRevision: row.currentRevision, status: row.status, payloadHash: row.currentVersion?.payloadHash ?? '' });

/** Persists only server-built proposal metadata and immutable action references. */
export class AiProposalRepository {
  constructor(private readonly db: Db) {}

  async createPending(input: AiProposalCreateInput, transaction?: Prisma.TransactionClient): Promise<AiProposalHead> {
    const payloadHash = fingerprintAiProposalDraft(input.payload);
    const ids = input.payload.actions.map(action => action.actionId);
    if (!input.scopeId || !input.taskId || input.payload.proposalId.length === 0 || new Set(ids).size !== ids.length
      || input.actions.length !== ids.length || input.actions.some(binding => !ids.includes(binding.actionId) || !/^[a-f0-9]{64}$/u.test(binding.requestFingerprint))) {
      throw new AiProposalRepositoryError('INVALID');
    }
    try {
      const write = async (tx: Tx) => {
        const existing = await tx.aiProposal.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, id: input.payload.proposalId }, select: headSelect });
        if (existing) {
          const same = existing.currentRevision === null && existing.status === 'PENDING_CONFIRMATION'
            && (await tx.aiProposalVersion.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, proposalId: input.payload.proposalId, revision: input.payload.revision }, select: { payloadHash: true } }))?.payloadHash === payloadHash;
          if (!same) throw new AiProposalRepositoryError('CONFLICT');
          return project(existing);
        }
        await tx.aiProposal.create({ data: { id: input.payload.proposalId, scopeId: input.scopeId, taskId: input.taskId, stateRevision: 1, currentRevision: null, status: 'PENDING_CONFIRMATION' }, select: { id: true } });
        await tx.aiProposalVersion.create({ data: { scopeId: input.scopeId, taskId: input.taskId, proposalId: input.payload.proposalId, revision: input.payload.revision, payloadHash, payload: input.payload as unknown as Prisma.InputJsonValue, expiresAt: new Date(input.payload.expiresAt) }, select: { revision: true } });
        for (const [sequence, binding] of input.actions.entries()) {
          const action = input.payload.actions.find(item => item.actionId === binding.actionId)!;
          const step = await tx.aiStep.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, actionId: action.actionId, requestFingerprint: binding.requestFingerprint }, select: { actionId: true } });
          if (!step) throw new AiProposalRepositoryError('INVALID');
          await tx.aiProposalAction.create({ data: { scopeId: input.scopeId, taskId: input.taskId, proposalId: input.payload.proposalId, proposalRevision: input.payload.revision, actionId: action.actionId, sequence: sequence + 1, requestFingerprint: binding.requestFingerprint }, select: { actionId: true } });
        }
        const created = await tx.aiProposal.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, id: input.payload.proposalId }, select: headSelect });
        if (!created) throw new AiProposalRepositoryError('UNAVAILABLE');
        return project(created);
      };
      return transaction ? await write(transaction) : await this.db.$transaction(write,
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiProposalRepositoryError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AiProposalRepositoryError('CONFLICT');
      throw new AiProposalRepositoryError('UNAVAILABLE');
    }
  }
}
