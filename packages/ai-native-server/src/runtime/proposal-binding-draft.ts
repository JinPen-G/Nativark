/** Compatibility binding for the original closed Rental action vocabulary. */
import { AI_TOOL_CODES } from '@rental-os/shared';
import { AI_PROPOSAL_TARGETS } from '@rental-os/platform-contracts';
import { createAiProposalBinding } from './proposal-binding';
const tools = new Set<string>(AI_TOOL_CODES), targets = new Set<string>(AI_PROPOSAL_TARGETS);
export const { fingerprintAiProposalDraft, checkAiApprovalBindingDraft } = createAiProposalBinding({
  admits: action => tools.has(action.toolCode) && targets.has(action.target.resourceType)
});
