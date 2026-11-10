export const AI_ENTRY_ACTION_CONTRACT_VERSION = 'ain-entry-action-draft-1' as const;
export const AI_ENTRY_AUDIENCE_MAP = { operations: 'operator', staff: 'staff', customer: 'client', platform: 'platform' } as const;
export const AI_CUSTOMER_ENTRY_SURFACES = ['client_miniprogram', 'tenant_website'] as const;
export type AiCustomerEntrySurface = (typeof AI_CUSTOMER_ENTRY_SURFACES)[number];
export const AI_ENTRY_ACTION_CODES = ['OPEN_ORDER', 'OPEN_CUSTOMER', 'OPEN_PRODUCT', 'OPEN_BOOKING', 'OPEN_PROFILE',
  'OPEN_PAYMENT', 'OPEN_DISPATCH', 'CREATE_BOOKING_DRAFT', 'CREATE_NOTIFICATION_DRAFT'] as const;
export type AiEntryActionCode = (typeof AI_ENTRY_ACTION_CODES)[number];
export const AI_ENTRY_ACTION_REGISTRY = {
  OPEN_ORDER: { resourceKind: 'order', riskLevel: 'R0', requiresConfirmation: false, availability: 'requires_server_assembly' },
  CREATE_BOOKING_DRAFT: { resourceKind: 'quote', riskLevel: 'R1', requiresConfirmation: true, availability: 'requires_server_assembly' },
  OPEN_BOOKING: { resourceKind: 'booking_draft', riskLevel: 'R0', requiresConfirmation: false, availability: 'requires_server_assembly' },
  OPEN_CUSTOMER: { availability: 'unavailable' }, OPEN_PRODUCT: { availability: 'unavailable' },
  OPEN_PROFILE: { availability: 'unavailable' }, OPEN_PAYMENT: { availability: 'unavailable' },
  OPEN_DISPATCH: { availability: 'unavailable' }, CREATE_NOTIFICATION_DRAFT: { availability: 'unavailable' }
} as const;


export interface AiCustomerEntryScope {
  kind: 'workspace';
  tenantId: string;
  workspaceId: string;
}

export interface AiEntryActionDraft {
  contractVersion: typeof AI_ENTRY_ACTION_CONTRACT_VERSION;
  actionId: string;
  actionCode: 'OPEN_ORDER' | 'OPEN_BOOKING' | 'CREATE_BOOKING_DRAFT';
  audience: 'customer';
  surface: AiCustomerEntrySurface;
  scope: AiCustomerEntryScope;
  resource: { kind: 'order' | 'quote' | 'booking_draft'; id: string; resourceVersion: string };
  requiresConfirmation: boolean;
  riskLevel: 'R0' | 'R1';
  issuedAt: string;
  expiresAt: string;
  inputFingerprint: string;
  bindingFingerprint: string;
  policyFingerprint: string;
  associations: { materialRef: string; taskId: null; proposalId: null; quoteId: string | null; bookingDraftId: string | null };
}

export interface AiEntryFailureDraft {
  code: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_PROPOSAL_STALE' | 'AI_REVISION_CONFLICT' | 'AI_RESULT_UNKNOWN';
  reason: string;
  retryable: false;
  nextAction: 'manual_booking' | 'clarify' | 'reprepare' | 'read_booking_operation' | 'read_original_submission';
}
