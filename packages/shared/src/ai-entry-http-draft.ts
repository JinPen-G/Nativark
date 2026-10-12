/** Explicit opt-in transport locations; publication never enables production routes. */
export const AI_CLIENT_ENTRY_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/client-entry', method: 'POST',
  /** Current Client Guard authenticates this prefix; old opt-in path is retained. */
  authenticatedBasePath: 'client/v1/ai-native/entry',
  readHostCapabilities: 'host-capabilities/read',
  /** Original task command only; neither endpoint starts or resumes execution. */
  readTaskSnapshot: 'tasks/snapshot/read', readTaskEvents: 'tasks/events/read',
  /** Request only; observe the original snapshot after success or unknown. */
  requestTaskCancellation: 'tasks/cancel/request',
  /** Converge only a proved released input wait, never arbitrary active work. */
  reconcileTaskInputCancellation: 'tasks/cancel/input-wait/reconcile',
  /** Reads the original clarification, never starts or resumes a run. */
  readTaskInput: 'tasks/input/read',
  /** Same-key submission/receipt observation; neither route invokes a model. */
  submitTaskInput: 'tasks/input/submit', readTaskInputReceipt: 'tasks/input/receipt/read',
  readOrderExplanation: 'orders/explanation/read', readSource: 'sources/read',
  issueAction: 'action', createBookingDraft: 'booking-drafts/create',
  chooseBookingDraft: 'booking-drafts/choose', readBookingDraft: 'booking-drafts/read',
  handoffBookingDraft: 'booking-drafts/handoff', readBookingHandoff: 'booking-handoffs/read',
  readBookingOperation: 'booking-operations/read',
  acceptBookingSubmission: 'booking-submissions/accept',
  submitAcceptedBooking: 'booking-submissions/submit',
  readBookingSubmission: 'booking-submissions/read',
});

export const AI_KNOWLEDGE_POLICY_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/knowledge-policy-management', method: 'POST',
  prepareTarget: 'targets/prepare', target: 'targets/read', bindTarget: 'targets/bind',
  read: 'read', prepare: 'prepare', preparation: 'preparations/read',
  commit: 'commit', operation: 'operations/read',
});

/** Safe error translation only. Unknown internal exceptions must not expose details. */
/** Explicit staff transport only. Task metadata never authorizes a model call. */
export const AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT = Object.freeze({
  basePath: 'staff/v1/ai-native/inspection-tasks', method: 'POST',
  create: 'create', readCreation: 'creation/read', start: 'start',
    reconcile: 'reconcile', requestCancel: 'cancel', readInput: 'input/read', resume: 'input/resume',
    readAnswer: 'input/receipt', continueAnswer: 'input/continue',
});

/** Original staff inspection services, never an arbitrary tool dispatcher. */
export const AI_STAFF_INSPECTION_HTTP_DRAFT = Object.freeze({
  basePath: 'staff/v1/ai-native/inspection-assist', method: 'POST',
  operations: Object.freeze({ hostRead: 'host-read', templateRead: 'template-read', evidenceBind: 'evidence-bind', evidenceFingerprint: 'evidence-fingerprint',
    draftCreate: 'draft-create', draftRead: 'draft-read', draftEdit: 'draft-edit', evidenceReplace: 'evidence-replace',
    draftOperation: 'draft-operation', inputPrepare: 'input-prepare', inputReceipt: 'input-receipt', resultRead: 'result-read',
    resultSave: 'result-save', resultSaveReceipt: 'result-save-receipt',
    submissionReview: 'submission-review', submissionPrepare: 'submission-prepare',
    submissionPreparation: 'submission-preparation', submissionSubmit: 'submission-submit', submissionRead: 'submission-read' }),
});

export const AI_KNOWLEDGE_POLICY_HTTP_ERRORS = Object.freeze({
  invalid_input: { status: 400, code: 'AI_INVALID_INPUT' },
  conflict: { status: 409, code: 'AI_REVISION_CONFLICT' },
  unavailable: { status: 503, code: 'AI_RESOURCE_UNAVAILABLE' },
  trusted_authority_missing: { status: 503, code: 'AI_RESOURCE_UNAVAILABLE' },
});
