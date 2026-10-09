/** Explicit opt-in transport locations; publication never enables production routes. */
export const AI_CLIENT_ENTRY_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/client-entry', method: 'POST',
  issueAction: 'action', createBookingDraft: 'booking-drafts/create',
  chooseBookingDraft: 'booking-drafts/choose', readBookingDraft: 'booking-drafts/read',
  handoffBookingDraft: 'booking-drafts/handoff', readBookingHandoff: 'booking-handoffs/read',
  readBookingOperation: 'booking-operations/read',
});

export const AI_KNOWLEDGE_POLICY_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/knowledge-policy-management', method: 'POST',
  prepareTarget: 'targets/prepare', target: 'targets/read', bindTarget: 'targets/bind',
  read: 'read', prepare: 'prepare', preparation: 'preparations/read',
  commit: 'commit', operation: 'operations/read',
});

/** Safe error translation only. Unknown internal exceptions must not expose details. */
export const AI_KNOWLEDGE_POLICY_HTTP_ERRORS = Object.freeze({
  invalid_input: { status: 400, code: 'AI_INVALID_INPUT' },
  conflict: { status: 409, code: 'AI_REVISION_CONFLICT' },
  unavailable: { status: 503, code: 'AI_RESOURCE_UNAVAILABLE' },
  trusted_authority_missing: { status: 503, code: 'AI_RESOURCE_UNAVAILABLE' },
});
