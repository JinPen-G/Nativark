/** Original human decision and same-row approval CAS. The application
 * supplies its action catalogue and current Task transaction authority. */
import type { AiTaskTransactionBoundary } from '../task-transactions';
import { randomUUID } from 'node:crypto';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient, AiActorKind, AiAudience, AiApprovalDecision as PrismaAiApprovalDecision } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import type { AiProposalPayloadDraft } from '@rental-os/platform-contracts';
import type { createAiProposalBinding } from './proposal-binding';

type Db = Pick<PrismaClient, '$transaction' | 'aiProposal' | 'aiProposalVersion' | 'aiApproval'>;
type Tx = Prisma.TransactionClient;
export type ApprovalPersistenceDatabase = Db;
type ProposalBinding = Pick<ReturnType<typeof createAiProposalBinding>, 'fingerprintAiProposalDraft'>;
type Transactions = Pick<AiTaskTransactionBoundary<Tx>, 'withAiTaskTransaction'>;
export type AiApprovalDecisionValue = 'approved' | 'rejected';
export interface AiApprovalPrincipal { actorKind: 'saas_admin' | 'user' | 'customer'; actorId: string; audience: 'operator' | 'staff' | 'client'; scopeId: string; }
export interface AiApprovalDecisionInput<Tool extends string = string, Target extends string = string> { context: AiExecutionContext; scopeId: string; taskId: string; proposalId: string; proposalRevision: number; payload: AiProposalPayloadDraft<Tool, Target>; reviewedPayloadHash: string; decision: AiApprovalDecisionValue; }
export interface AiApprovalRecord { approvalId: string; scopeId: string; taskId: string; proposalId: string; proposalRevision: number; payloadHash: string; audience: AiApprovalPrincipal['audience']; actorKind: AiApprovalPrincipal['actorKind']; actorId: string; decision: AiApprovalDecisionValue; issuedAt: Date; expiresAt: Date; }

export interface AiApprovalRepository<Tool extends string = string, Target extends string = string> { decide(input: Omit<AiApprovalDecisionInput<Tool, Target>, 'context'>, principal: AiApprovalPrincipal): Promise<AiApprovalRecord>; }
export interface AiApprovalAuthority<Tool extends string = string, Target extends string = string> { authorize(context: AiExecutionContext, input: Readonly<AiApprovalDecisionInput<Tool, Target>>): Promise<AiApprovalPrincipal | null>; }
export class AiApprovalRepositoryError extends Error { constructor(readonly code: 'INVALID' | 'FORBIDDEN' | 'CONFLICT' | 'UNAVAILABLE') { super(code); this.name = 'AiApprovalRepositoryError'; } }

/** Approval is a durable decision, not a tool invocation or Core business commit. */
export class ApprovalDecisionService<Tool extends string = string, Target extends string = string> {
  constructor(private readonly repository: AiApprovalRepository<Tool, Target>, private readonly authority: AiApprovalAuthority<Tool, Target>,
    private readonly binding: ProposalBinding) {
    if (!repository || !authority || typeof repository.decide !== 'function' || typeof authority.authorize !== 'function') throw new AiApprovalRepositoryError('UNAVAILABLE');
  }
  async decide(input: AiApprovalDecisionInput<Tool, Target>): Promise<AiApprovalRecord> {
    input = structuredClone(input);
    if (!input || !input.context || !input.scopeId || !input.taskId || !input.proposalId || !Number.isSafeInteger(input.proposalRevision) || input.proposalRevision < 1
      || !/^[a-f0-9]{64}$/u.test(input.reviewedPayloadHash) || !['approved', 'rejected'].includes(input.decision)) throw new AiApprovalRepositoryError('INVALID');
    const payloadHash = this.binding.fingerprintAiProposalDraft(input.payload);
    if (input.payload.proposalId !== input.proposalId || input.payload.taskId !== input.taskId || input.payload.revision !== input.proposalRevision || payloadHash !== input.reviewedPayloadHash) throw new AiApprovalRepositoryError('CONFLICT');
    let principal: AiApprovalPrincipal | null;
    try { principal = structuredClone(await this.authority.authorize(structuredClone(input.context), structuredClone(input))); } catch { principal = null; }
    if (!principal || principal.scopeId !== input.scopeId) throw new AiApprovalRepositoryError('FORBIDDEN');
    try { const { context: _context, ...persisted } = input; return structuredClone(await this.repository.decide(persisted, principal)); }
    catch (error) { if (error instanceof AiApprovalRepositoryError) throw error; throw new AiApprovalRepositoryError('UNAVAILABLE'); }
  }
}

const approvalSelect = { id: true, scopeId: true, taskId: true, proposalId: true, proposalRevision: true, payloadHash: true, audience: true, actorKind: true, actorId: true, decision: true, issuedAt: true, expiresAt: true } satisfies Prisma.AiApprovalSelect;
const project = (row: { id: string; scopeId: string; taskId: string; proposalId: string; proposalRevision: number; payloadHash: string; audience: string; actorKind: string; actorId: string; decision: string; issuedAt: Date; expiresAt: Date }): AiApprovalRecord => ({ approvalId: row.id, scopeId: row.scopeId, taskId: row.taskId, proposalId: row.proposalId, proposalRevision: row.proposalRevision, payloadHash: row.payloadHash, audience: row.audience.toLowerCase() as AiApprovalRecord['audience'], actorKind: row.actorKind.toLowerCase() as AiApprovalRecord['actorKind'], actorId: row.actorId, decision: row.decision.toLowerCase() as AiApprovalDecisionValue, issuedAt: row.issuedAt, expiresAt: row.expiresAt });

export class ApprovalPersistenceRepository<Tool extends string = string, Target extends string = string> implements AiApprovalRepository<Tool, Target> {
  constructor(private readonly db: Db, private readonly transactions: Transactions, private readonly clock: () => Date = () => new Date()) {}
  async decide(input: Omit<AiApprovalDecisionInput<Tool, Target>, 'context'>, principal: AiApprovalPrincipal) {
    input = structuredClone(input); principal = structuredClone(principal);
    const issuedAt = this.clock(), expiresAt = new Date(input.payload.expiresAt);
    if (principal.scopeId !== input.scopeId || !Number.isFinite(expiresAt.getTime()) || expiresAt <= issuedAt) throw new AiApprovalRepositoryError('INVALID');
    try {
      return await this.db.$transaction(async (tx: Tx) => {
return this.transactions.withAiTaskTransaction(tx, { kind: input.decision === 'rejected' ? 'task_control' : 'task', taskId: input.taskId }, async () => {
        const proposal = await tx.aiProposal.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, id: input.proposalId }, select: { stateRevision: true, currentRevision: true, status: true } });
        const version = await tx.aiProposalVersion.findFirst({ where: { scopeId: input.scopeId, taskId: input.taskId, proposalId: input.proposalId, revision: input.proposalRevision }, select: { payloadHash: true, expiresAt: true } });
        if (!proposal || proposal.stateRevision < 1 || !version || version.payloadHash !== input.reviewedPayloadHash
          || !(version.expiresAt instanceof Date) || version.expiresAt.getTime() !== expiresAt.getTime()
          || version.expiresAt <= issuedAt) throw new AiApprovalRepositoryError('CONFLICT');
        const existing = await tx.aiApproval.findFirst({ where: { scopeId: input.scopeId, proposalId: input.proposalId, proposalRevision: input.proposalRevision, actorKind: principal.actorKind.toUpperCase() as AiActorKind, actorId: principal.actorId }, select: approvalSelect });
        if (existing) {
          // The unique actor/decision key omits audience and receipt dates.
          // Replay must preserve the full original binding, never repair a row
          // or create another approval because a matching hash was found.
          const binding = { scopeId: input.scopeId, taskId: input.taskId, proposalId: input.proposalId,
            proposalRevision: input.proposalRevision, actorKind: principal.actorKind.toUpperCase(),
            actorId: principal.actorId, audience: principal.audience.toUpperCase() };
          if (Object.entries(binding).some(([key, value]) => existing[key as keyof typeof existing] !== value)
            || existing.payloadHash !== input.reviewedPayloadHash || existing.decision.toLowerCase() !== input.decision
            || !(existing.issuedAt instanceof Date) || !Number.isFinite(existing.issuedAt.getTime())
            || !(existing.expiresAt instanceof Date) || existing.expiresAt.getTime() !== expiresAt.getTime()
            || existing.issuedAt >= existing.expiresAt || existing.issuedAt > issuedAt
            || proposal.currentRevision !== input.proposalRevision || proposal.status !== (input.decision === 'approved' ? 'CONFIRMED' : 'CANCELLED')) throw new AiApprovalRepositoryError('CONFLICT');
          return project(existing);
        }
        if (proposal.status !== 'PENDING_CONFIRMATION' || proposal.currentRevision !== null) throw new AiApprovalRepositoryError('CONFLICT');
        const approvalId = randomUUID();
        const approval = await tx.aiApproval.create({ data: { id: approvalId, scopeId: input.scopeId, taskId: input.taskId, proposalId: input.proposalId, proposalRevision: input.proposalRevision, payloadHash: input.reviewedPayloadHash, audience: principal.audience.toUpperCase() as AiAudience, actorKind: principal.actorKind.toUpperCase() as AiActorKind, actorId: principal.actorId, decision: input.decision.toUpperCase() as PrismaAiApprovalDecision, issuedAt, expiresAt }, select: approvalSelect });
        const changed = await tx.aiProposal.updateMany({ where: { scopeId: input.scopeId, taskId: input.taskId, id: input.proposalId, stateRevision: proposal.stateRevision, status: 'PENDING_CONFIRMATION', currentRevision: null }, data: { stateRevision: { increment: 1 }, currentRevision: input.proposalRevision, status: input.decision === 'approved' ? 'CONFIRMED' : 'CANCELLED' } });
        if (changed.count !== 1) throw new AiApprovalRepositoryError('CONFLICT');
        return project(approval);

});
}, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiApprovalRepositoryError) throw error;
      if (error instanceof prismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002') throw new AiApprovalRepositoryError('CONFLICT');
      throw new AiApprovalRepositoryError('UNAVAILABLE');
    }
  }
}
