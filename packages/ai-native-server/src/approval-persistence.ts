/** Same C05 persistence for installed hosts. A server-owned catalogue and the
 * original strict Task transaction boundary are mandatory. Core owns its effect. */
import type { Prisma } from '@prisma/client';
import { isStrictAiTaskTransactionBoundary, type AiTaskTransactionAuthority, type AiTaskTransactionBoundary } from './task-transactions';
import { AiTaskRepositoryError } from './task-errors';
import { createAiProposalBinding, ProposalPersistenceRepository, ApprovalDecisionService, ApprovalPersistenceRepository,
  ApprovalConsumptionPersistenceRepository, type ProposalCatalogue, type ProposalPersistenceDatabase, type AiProposalCreateInput,
  type ApprovalPersistenceDatabase, type AiApprovalAuthority, type AiApprovalDecisionInput, type ApprovalConsumptionDatabase,
  type ApprovalEffectSource, type HeldApprovalConsumptionInput } from './runtime/public-approval-persistence';
export * from './runtime/public-approval-persistence';

type Tx = Prisma.TransactionClient;
type Database = ProposalPersistenceDatabase & ApprovalPersistenceDatabase & ApprovalConsumptionDatabase;
export function createPublicAiApprovalPersistence(input: { db: Database; catalogue: ProposalCatalogue;
  decisions: AiApprovalAuthority; transactions: AiTaskTransactionBoundary<Tx>; clock?: () => Date }) {
  const { db, transactions, clock } = input;
  if (!isStrictAiTaskTransactionBoundary(transactions)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const binding = createAiProposalBinding(input.catalogue);
  const proposals = new ProposalPersistenceRepository(db, binding, transactions);
  const approvals = new ApprovalDecisionService(new ApprovalPersistenceRepository(db, transactions, clock), input.decisions, binding);
  class HeldConsumption extends ApprovalConsumptionPersistenceRepository {
    bind<Binding>(value: HeldApprovalConsumptionInput, toolCode: string, source: ApprovalEffectSource<Binding>) {
      return this.effectTransaction(value, toolCode, source, transactions);
    }
  }
  const held = new HeldConsumption(db, clock);
  const once = transactions.withAiTaskTransactionAuthority;
  return Object.freeze({
    createPending: (authority: AiTaskTransactionAuthority<Tx>, value: AiProposalCreateInput, native?: Tx) =>
      once(authority, () => proposals.createPending(value, native)),
    decide: (authority: AiTaskTransactionAuthority<Tx>, value: AiApprovalDecisionInput) =>
      once(authority, () => approvals.decide(value)),
    /** Prepare and commit on the caller's already-held business transaction.
     * Missing, unsettled and conflicting receipts never grant a retry. */
    attachEffect: held.bind.bind(held)
  });
}
