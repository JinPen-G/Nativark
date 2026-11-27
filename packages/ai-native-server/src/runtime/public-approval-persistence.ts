/** Public C05 participants. This explicit infrastructure entry is also
 * available to the original installed Rental compatibility package. */
export { createAiProposalBinding, type ProposalCatalogue } from './proposal-binding';
export { ProposalPersistenceRepository, AiProposalRepositoryError, type ProposalPersistenceDatabase,
  type AiProposalActionBinding, type AiProposalCreateInput, type AiProposalHead } from './proposal-persistence.repository';
export { ApprovalDecisionService, ApprovalPersistenceRepository, AiApprovalRepositoryError, type ApprovalPersistenceDatabase,
  type AiApprovalRepository, type AiApprovalRecord, type AiApprovalPrincipal, type AiApprovalDecisionInput,
  type AiApprovalAuthority, type AiApprovalDecisionValue } from './approval-persistence.repository';
export { ApprovalConsumptionPersistenceRepository, AiApprovalConsumptionRepositoryError, type ApprovalConsumptionDatabase,
  type ApprovalEffectSource, type HeldApprovalConsumptionInput } from './approval-consumption-persistence.repository';
export type { AiApprovalConsumptionInput, AiApprovalConsumptionRecord } from './approval-consumption.ports';
export { AiApprovalConsumptionService } from './approval-consumption.service';
