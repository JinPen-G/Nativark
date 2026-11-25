import { AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION } from '@rental-os/shared';
import type { ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';
import type { composeApprovedOrderHumanApproval } from './approved-order-human.composition';
import { approvalApplicationContract } from './approval-application-contracts';
import { composeApprovedOrderReprepareEligibility } from './approved-order-reprepare-eligibility';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { ApprovedOrderReprepareApplication } from './approved-order-reprepare.ports';

export function composeApprovedOrderApplication(d: ControlledApprovedOrderDependencies, human: ReturnType<typeof composeApprovedOrderHumanApproval>, reprepares: ApprovedOrderReprepareApplication) {
  const commandFor = (taskId: string, value: unknown) => {
    const command = approvalApplicationContract('AiApprovalReprepareCommandDraft', value);
    if (command.originalTaskId !== taskId) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return command;
  };
  return Object.freeze({
    readProposal: async (taskId: string, value: unknown) => {
      const reference = approvalApplicationContract('AiApprovalApplicationReferenceDraft', value);
      const { proposal, deterministic, generatedText } = await human.readProposal(taskId, reference);
      return approvalApplicationContract('AiApprovalApplicationReviewDraft', {
        draftVersion: AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION, proposal, deterministic, generatedText
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
    readReprepareEligibility: composeApprovedOrderReprepareEligibility(d, human),
    reprepare: async (taskId: string, value: unknown) => reprepares.reprepare(commandFor(taskId, value)),
    readReprepareReceipt: async (taskId: string, value: unknown) => reprepares.readReceipt(commandFor(taskId, value))
  });
}
