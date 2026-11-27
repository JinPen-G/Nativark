/** Rental compatibility: same C05 persistence, original closed tool set and transaction. */
import type { AiToolCode } from '@rental-os/shared';
import type { AiProposalTarget } from '@rental-os/platform-contracts';
import { fingerprintAiProposalDraft } from './proposal-binding-draft';
import { withAiTaskTransaction, withHeldAiTaskTransaction } from './task-transaction-authority';
import { ProposalPersistenceRepository, type ProposalPersistenceDatabase, type AiProposalCreateInput as CreateInput } from './proposal-persistence.repository';
export { AiProposalRepositoryError, type AiProposalActionBinding, type AiProposalHead } from './proposal-persistence.repository';
export type AiProposalCreateInput = CreateInput<AiToolCode, AiProposalTarget>;

export class AiProposalRepository extends ProposalPersistenceRepository<AiToolCode, AiProposalTarget> {
  constructor(db: ProposalPersistenceDatabase) { super(db, { fingerprintAiProposalDraft }, { withAiTaskTransaction, withHeldAiTaskTransaction }); }
}
