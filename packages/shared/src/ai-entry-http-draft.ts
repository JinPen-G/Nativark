/** Explicit opt-in transport locations; publication never enables production routes. */
import { AI_INSPECTION_TASK_RESULT_REFERENCE_PATH } from './ai-inspection-draft';
export const AI_CLIENT_ENTRY_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/client-entry', method: 'POST',
  /** Current Client Guard authenticates this prefix; old opt-in path is retained. */
  authenticatedBasePath: 'client/v1/ai-native/entry',
  /** Fixed WeChat surface alias. It still requires current client identity,
   * publication, persisted scene policy and every original business guard. */
  authenticatedWechatBasePath: 'client/v1/ai-native/wechat-entry',
  readHostCapabilities: 'host-capabilities/read',
  /** Owned order facts -> immutable material -> metadata task only. */
  prepareOrderMaterial: 'orders/material/prepare', readOrderMaterialReceipt: 'orders/material/receipt',
  createTask: 'tasks/create', readTaskCreation: 'tasks/creation/read',
  /** Original financial lifecycle only; never creates a reservation/dispatch. */
  readTaskAccounting: 'tasks/accounting/read', reconcileTaskAccounting: 'tasks/accounting/reconcile',
  /** Original task command only; neither endpoint starts or resumes execution. */
  readTaskSnapshot: 'tasks/snapshot/read', readTaskEvents: 'tasks/events/read',
  /** Request only; observe the original snapshot after success or unknown. */
  requestTaskCancellation: 'tasks/cancel/request',
  readTaskCancellationReceipt: 'tasks/cancel/receipt/read',
  readTaskCancellationSettlementReceipt: 'tasks/cancel/settlement/receipt/read',
  settleTaskUnstartedCancellation: 'tasks/cancel/unstarted/settle',
  /** Converge only a proved released input wait, never arbitrary active work. */
  reconcileTaskInputCancellation: 'tasks/cancel/input-wait/reconcile',
  /** Reads the original clarification, never starts or resumes a run. */
  readTaskInput: 'tasks/input/read',
  /** Same-key submission/receipt observation; neither route invokes a model. */
  submitTaskInput: 'tasks/input/submit', readTaskInputReceipt: 'tasks/input/receipt/read',
  /** Requires explicit persisted server model dependencies and current policy. */
  startTaskModel: 'tasks/model/start', recoverTaskModel: 'tasks/model/recover',
  reconcileTaskModel: 'tasks/model/reconcile', continueTaskInput: 'tasks/input/continue',
  /** Current owner/original lineage result discovery; never model execution. */
  readTaskModelResult: 'tasks/model/result/read',
  readOrderExplanation: 'orders/explanation/read', readSource: 'sources/read',
  /** Current human parameters -> original Core quote. Never order approval. */
  prepareQuoteParameters: 'quotes/parameters/prepare', readQuotePreparationOperation: 'quotes/preparation/read',
  prepareGoal: 'goals/prepare', readGoalPreparation: 'goals/operation', readGoalCandidates: 'goals/candidates',
  prepareGoalQuote: 'goals/quote/prepare', readGoalQuotePreparation: 'goals/quote/operation',
  confirmQuoteParameters: 'quotes/parameters/confirm', readPreparedQuoteOriginal: 'quotes/original/read',
  /** Original server-host flow; creates only booking material and its Action. */
  prepareOriginalQuoteBooking: 'quotes/booking/prepare', readOriginalQuoteBookingOperation: 'quotes/booking/operation',
  issueAction: 'action', createBookingDraft: 'booking-drafts/create',
  chooseBookingDraft: 'booking-drafts/choose', readBookingDraft: 'booking-drafts/read',
  handoffBookingDraft: 'booking-drafts/handoff', readBookingHandoff: 'booking-handoffs/read',
  readBookingOperation: 'booking-operations/read',
  acceptBookingSubmission: 'booking-submissions/accept',
  readBookingAcceptance: 'booking-submissions/acceptance/read',
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
  readResultReference: AI_INSPECTION_TASK_RESULT_REFERENCE_PATH,
    readAccounting: 'accounting/read', reconcileAccounting: 'accounting/reconcile',
    reconcile: 'reconcile', requestCancel: 'cancel', readCancelReceipt: 'cancel/receipt', readInput: 'input/read', resume: 'input/resume',
    settleUnstartedCancellation: 'cancel/settle-unstarted', readCancellationSettlementReceipt: 'cancel/settlement/receipt',
    settleReleasedInputCancellation: 'cancel/settle-released-input',
    readAnswer: 'input/receipt', continueAnswer: 'input/continue',
});
/** Current same-staff-owner candidate-runtime policies only, never Core
 * inspection submission, model credentials or a general permissions editor. */
export const AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT = Object.freeze({
  basePath: 'staff/v1/ai-native/inspection-task-policies', method: 'POST',
  read: 'read', configure: 'configure', clear: 'clear'
});
/** Operator-managed customer scene gates and text plan, not customer grants. */
export const AI_CLIENT_TASK_POLICY_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/client-task-policies', method: 'POST',
  read: 'read', change: 'change', operation: 'operation',
  readModelPlan: 'model-plan/read', changeModelPlan: 'model-plan/change'
});

/** Original staff inspection services, never an arbitrary tool dispatcher. */
export const AI_STAFF_INSPECTION_HTTP_DRAFT = Object.freeze({
  basePath: 'staff/v1/ai-native/inspection-assist', method: 'POST',
  operations: Object.freeze({ hostRead: 'host-read', historyRead: 'history-read', receiptHostRead: 'receipt-host-read',
    templateRead: 'template-read', evidenceBind: 'evidence-bind', evidenceFingerprint: 'evidence-fingerprint',
    draftCreate: 'draft-create', draftRead: 'draft-read', draftEdit: 'draft-edit', evidenceReplace: 'evidence-replace',
    draftOperation: 'draft-operation', inputPrepare: 'input-prepare', inputReceipt: 'input-receipt', resultRead: 'result-read',
    resultSave: 'result-save', resultSaveReceipt: 'result-save-receipt',
    submissionReview: 'submission-review', submissionPrepare: 'submission-prepare',
    submissionPreparation: 'submission-preparation', submissionSubmit: 'submission-submit', submissionRead: 'submission-read',
    fulfillmentReceiptRead: 'fulfillment-receipt-read' }),
});

export const AI_KNOWLEDGE_POLICY_HTTP_ERRORS = Object.freeze({
  result_unknown: { status: 409, code: 'AI_RESULT_UNKNOWN' },
  invalid_input: { status: 400, code: 'AI_INVALID_INPUT' },
  conflict: { status: 409, code: 'AI_REVISION_CONFLICT' },
  unavailable: { status: 503, code: 'AI_RESOURCE_UNAVAILABLE' },
  trusted_authority_missing: { status: 503, code: 'AI_RESOURCE_UNAVAILABLE' },
});
