/** The original Rental tool vocabulary remains closed at this compatibility edge. */
import { createAiProposalDraftSchemas } from '@rental-os/platform-contracts';
import { AI_TOOL_CODES } from './ai-native';
export const AI_PROPOSAL_DRAFT_SCHEMAS = createAiProposalDraftSchemas(AI_TOOL_CODES);
