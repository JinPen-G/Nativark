import { AI_APPROVAL_APPLICATION_DRAFT_VERSION } from '../../../../../../packages/shared/src/ai-approval-application-draft';
import type { ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';
import type { composeApprovedOrderHumanApproval } from './approved-order-human.composition';
import { approvalApplicationContract } from './approval-application-contracts';
import { composeApprovedOrderReprepareEligibility } from './approved-order-reprepare-eligibility';

export function composeApprovedOrderApplication(d: ControlledApprovedOrderDependencies, human: ReturnType<typeof composeApprovedOrderHumanApproval>) {
  return Object.freeze({
    readProposal: async (taskId: string, value: unknown) => {
      const reference = approvalApplicationContract('AiApprovalApplicationReferenceDraft', value);
      const { proposal, deterministic, generatedText } = await human.readProposal(taskId, reference);
      return approvalApplicationContract('AiApprovalApplicationReviewDraft', {
        draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, proposal, deterministic, generatedText
      }, true);
    },
    decide: async (taskId: string, value: unknown) => {
      const command = approvalApplicationContract('AiApprovalApplicationDecisionDraft', value);
      const record = await human.decide(taskId, command);
      return approvalApplicationContract('AiApprovalApplicationReceiptDraft', { kind: 'recorded', record }, true);
    },
    readReceipt: async (taskId: string, value: unknown) => {
      const command = approvalApplicationContract('AiApprovalApplicationDecisionDraft', value);
      return approvalApplicationContract('AiApprovalApplicationReceiptDraft', await human.readReceipt(taskId, command), true);
    },
    readReprepareEligibility: composeApprovedOrderReprepareEligibility(d, human)
  });
}
