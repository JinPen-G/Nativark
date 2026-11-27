/** Rental compatibility: original C05 decisions and the original Task boundary. */
import type { AiToolCode } from '@rental-os/shared';
import type { AiProposalTarget } from '@rental-os/platform-contracts';
import { fingerprintAiProposalDraft } from './proposal-binding-draft';
import { withAiTaskTransaction } from './task-transaction-authority';
import { ApprovalDecisionService, ApprovalPersistenceRepository, type ApprovalPersistenceDatabase,
  type AiApprovalAuthority as Authority, type AiApprovalDecisionInput as Decision, type AiApprovalRepository as Repository } from './approval-persistence.repository';
export { AiApprovalRepositoryError, type AiApprovalDecisionValue, type AiApprovalPrincipal, type AiApprovalRecord } from './approval-persistence.repository';
export type AiApprovalDecisionInput = Decision<AiToolCode, AiProposalTarget>;
export type AiApprovalRepository = Repository<AiToolCode, AiProposalTarget>;
export type AiApprovalAuthority = Authority<AiToolCode, AiProposalTarget>;

export class AiApprovalService extends ApprovalDecisionService<AiToolCode, AiProposalTarget> {
  constructor(repository: AiApprovalRepository, authority: AiApprovalAuthority) { super(repository, authority, { fingerprintAiProposalDraft }); }
}

export class PrismaAiApprovalRepository extends ApprovalPersistenceRepository<AiToolCode, AiProposalTarget> {
  constructor(db: ApprovalPersistenceDatabase, clock?: () => Date) { super(db, { withAiTaskTransaction }, clock); }
}
