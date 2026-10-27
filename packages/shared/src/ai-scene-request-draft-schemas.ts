import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_SCENE_CODES } from './ai-scene-request-draft';
import { AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT, AI_TASK_DRAFT_VERSION } from './ai-task-draft';
import { RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES } from './core';
import { AI_TASK_INPUT_DRAFT_SCHEMAS } from './ai-task-input-draft-schemas';
import { AI_QUOTE_SELECTION_DRAFT_SCHEMAS } from './ai-quote-selection-draft-schemas';
import { AI_APPROVED_SETTINGS_DRAFT_SCHEMAS } from './ai-approved-settings-draft-schemas';
import { leafClosed as object, leafEnum as choice, leafId as id, leafText as text, leafInt as integer, leafList as list, leafTime, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

const uuid = { type: 'string', format: 'uuid' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const candidate = object({ customerType: choice('personal', 'corporate'), customerId: text(), customerName: text(),
  bookingIdentity: { oneOf: [object({ bookingIdentity: choice('personal') }),
    object({ bookingIdentity: choice('enterprise_employee'), corporateCustomerId: id(), enterpriseContractAndPayer: { type: 'boolean' } }, ['bookingIdentity'])] },
  deliveryAddressId: id(),
  items: list(object({ productName: text(), itemGroupId: id(), quantity: integer(1, 10000), pricingUnit: choice(...RENTAL_PRICING_UNIT_CODES),
    usageQuantity: { type: 'number', minimum: 0, maximum: 1000000 } }, ['quantity']), 50, 1),
  start: text(80), end: text(80), fulfillmentMode: choice(...RENTAL_FULFILLMENT_MODES), locationName: text(), returnLocationName: text(),
  locationId: id(), returnLocationId: id(), selectionRevision: hash }, ['customerType']);
const inputs = [
  { sceneCode: choice('order_explanation'), input: object({ orderId: id(), question: choice('status', 'fees', 'payments', 'next_steps') }) },
  { sceneCode: choice('opening_diagnosis'), input: object({ sections: { ...list(id(), 9, 1), uniqueItems: true } }) },
  { sceneCode: choice('quote_clarification'), input: object({ candidate }) }
];
const base = { draftVersion: choice(AI_SCENE_REQUEST_DRAFT_VERSION), requestKey: { ...id(), maxLength: 128 } };
const originalReference = object({ draftVersion: base.draftVersion, inputRef: uuid });
const noTask = object({ state: choice('not_observed'), retryable: { type: 'boolean', const: false } });
const observedTask = object({ state: choice('observed'), taskId: uuid, runId: uuid, status: choice(...AI_TASK_STATUSES_DRAFT),
  revision: integer(1, 4294967294), plan: choice('stored', 'not_observed'), resultAvailable: { type: 'boolean' }, execution: choice('not_inferred_from_metadata') });
const recoveryStep = object({ stepId: id(), runId: id(), actionId: id(), revision: integer(1, 4294967294), status: choice(...AI_STEP_STATUSES_DRAFT),
  effect: choice('none', 'possible', 'committed'), resultAvailable: { type: 'boolean' }, nextAction: choice('reconcile_original_action', 'read_authorized_result', 'runner_owned') });
const recordedUsage = object({ invocationId: text(36), callId: text(128), accounting: choice('recorded'), reservationId: text(36), sceneCode: text(128),
  runId: text(36), stepId: text(36), revision: integer(1, 4294967295), observedVersionAt: leafTime,
  status: choice('reserved', 'settled', 'released', 'pending_reconciliation'), reserved: { $ref: '#/components/schemas/AiUsageQuantityDraft' },
  actual: { oneOf: [{ $ref: '#/components/schemas/AiUsageQuantityDraft' }, { type: 'null' }] }, budgetDispatchMarked: { type: 'boolean' },
  modelPolicy: { oneOf: [object({ mode: choice('platform_managed'), serviceName: choice('Rental OS AI') }),
    object({ mode: choice('tenant_managed'), model: text(256) })] } });
const budgetAmountGroup: AiLeafSchemaDraft = { oneOf: [
  ...(['money', 'tokens', 'calls'] as const).map(unit => object({ unit: choice(unit),
    currency: unit === 'money' ? { type: 'string', pattern: '^[A-Z]{3}$' } : { type: 'null' },
    scale: integer(unit === 'money' ? 6 : 0, unit === 'money' ? 6 : 0),
    ...Object.fromEntries(['reservedAtoms', 'pendingAtoms', 'settledAtoms', 'releasedReservationAtoms', 'settledExcessAtoms']
      .map(field => [field, { type: 'string', pattern: '^(0|[1-9][0-9]{0,31})$' }])) }))
] };
const budgetSummary = { taskId: text(36), observedAt: leafTime, invocationLimit: integer(50, 50),
  consistency: choice('revalidated_reads_not_atomic_snapshot'), execution: choice('read_only_no_dispatch_or_release'),
  basis: choice('persisted_budget_records_not_provider_invoice'), absenceSemantics: choice('no_record_is_not_proof_of_no_consumption'),
  businessExecution: choice('not_inferred_from_usage'), admission: choice('not_granted') };
export const AI_SCENE_REQUEST_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiSceneRequestBodyDraft: { oneOf: inputs.map(input => object(input)) },
  AiSceneCreatedTaskDraft: object({ taskId: uuid, runId: uuid, status: choice(...AI_TASK_STATUSES_DRAFT),
    revision: integer(1, 4294967295), replayed: { type: 'boolean' } }),
  AiSceneRequestCreationResponseDraft: { oneOf: [
    object({ stage: choice('existing_request'), receipt: { $ref: '#/components/schemas/AiSceneRequestReceiptDraft' },
      task: { $ref: '#/components/schemas/AiSceneTaskReceiptDraft' }, model: choice('not_called') }),
    object({ stage: choice('task_metadata_created'), receipt: { $ref: '#/components/schemas/AiSceneRequestReceiptDraft' },
      task: { $ref: '#/components/schemas/AiSceneCreatedTaskDraft' }, plan: choice('not_started'), model: choice('not_called') }),
    object({ stage: choice('request_stored'), receipt: { $ref: '#/components/schemas/AiSceneRequestReceiptDraft' }, model: choice('not_called'),
      creation: { oneOf: [object({ code: choice('AI_STORAGE_UNAVAILABLE'), state: choice('requires_reconciliation'), retryable: { type: 'boolean', const: false } }),
        object({ code: choice('AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_REVISION_CONFLICT'),
          state: choice('blocked'), retryable: { type: 'boolean', const: false } })] } })] },
  AiSceneRequestReadResponseDraft: object({ receipt: { $ref: '#/components/schemas/AiSceneRequestReceiptDraft' },
    request: { $ref: '#/components/schemas/AiSceneRequestBodyDraft' } }),
  AiSceneRequestReconcileResponseDraft: { oneOf: [noTask,
    object({ state: choice('observed'), receipt: { $ref: '#/components/schemas/AiSceneRequestReceiptDraft' },
      task: { $ref: '#/components/schemas/AiSceneTaskReceiptDraft' } })] },
  AiSceneQuoteCandidateDraft: candidate,
  AiTaskBudgetUsageSummaryDraft: { oneOf: [
    object({ ...budgetSummary, state: choice('limit_exceeded'), coverage: choice('not_computed') }),
    object({ ...budgetSummary, state: choice('observed'), coverage: choice('all_registered_invocations'),
      invocationCount: integer(0, 50), recordedCount: integer(0, 100), notRecordedCount: integer(0, 50),
      accountingComplete: { type: 'boolean' }, groups: list(budgetAmountGroup, 100) })
  ] },
  AiSceneOrderExtensionPreviewDraft: object({ draftVersion: base.draftVersion, inputRef: uuid,
    expectedOrderVersion: leafTime,
    extension: object({ newEndAt: leafTime, services: list(object({ serviceId: id(), quantity: { type: 'number', minimum: 1 },
      scheduledStartAt: leafTime, scheduledEndAt: leafTime, serviceLocationId: id() }, ['serviceId', 'quantity']), 50),
      memo: text(2000, 0) }, ['newEndAt']) }),
  AiOpeningReadFactsDraft: object({ requestId: id(), scope: object({ kind: choice('workspace'), tenantId: id(), workspaceId: id() }),
    observedAt: leafTime, ready: { type: 'boolean' }, readinessBasis: choice('core_workspace_aggregate'),
    coverage: choice('requested_sections', 'all_readiness_sections'),
    items: list(object({ key: id(), title: text(200), missing: text(1000, 0), optional: { type: 'boolean' },
      status: choice('unavailable', 'ready', 'missing') }), 50) }),
  AiOriginalOpeningReadSourceDraft: object({ original: { $ref: '#/components/schemas/AiSceneRequestReceiptDraft' },
    source: object({ original: object({ contractVersion: choice(AI_TASK_DRAFT_VERSION),
      taskId: uuid, resultId: uuid, runId: uuid, stepId: uuid, actionId: id(), status: choice('succeeded'), errorCode: { type: 'null' },
      contentHash: hash, outputBytes: { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' },
      activeMs: { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' }, completeMeasurement: { type: 'boolean', const: true }, observedAt: leafTime }),
      facts: { $ref: '#/components/schemas/AiOpeningReadFactsDraft' }, observation: choice('current_authorized_reobservation'),
      originalPayload: choice('not_returned'), execution: choice('not_invoked') }) }),
  AiSceneSettingsTaskDraft: object({ taskId: id(), runId: id() }),
  AiSceneSettingsConfirmationReadDraft: object({ taskId: id(), runId: id(), stepId: id() }),
  AiSceneSettingsContinueDraft: object({ taskId: id(), runId: id(), checkpointRef: id() }),
  AiSceneSettingsCancelDraft: object({ taskId: id(), expectedRevision: integer(1, 4294967294) }),
  AiSceneSettingsDecisionDraft: AI_APPROVED_SETTINGS_DRAFT_SCHEMAS.AiApprovedSettingsDecisionDraft as AiLeafSchemaDraft,
  AiSceneSettingsDecisionReadDraft: AI_APPROVED_SETTINGS_DRAFT_SCHEMAS.AiApprovedSettingsReferenceDraft as AiLeafSchemaDraft,
  AiSceneQuoteConfirmDraft: object({ draftVersion: base.draftVersion, inputRef: uuid,
    selectionRevision: hash, inputFingerprint: hash, confirmQuote: { type: 'boolean', const: true } }),
  AiSceneQuoteReceiptReadDraft: object({ draftVersion: base.draftVersion, inputRef: uuid,
    selectionRevision: hash, inputFingerprint: hash }, ['draftVersion', 'inputRef']),
  AiSceneModelTaskPageDraft: object({ limit: integer(1, 50), cursor: { type: 'string', maxLength: 512 },
    status: { type: 'string', minLength: 1, maxLength: 64 }, sceneCode: { type: 'string', minLength: 1, maxLength: 191 } }, []),
  AiSceneModelTaskEventsDraft: object({ original: originalReference,
    after: { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' }, limit: integer(1, 100) }),
  AiSceneModelTaskSceneDraft: { oneOf: [
    object({ kind: choice('original'), taskId: id(), runId: id(), original: originalReference,
      resultId: id(), review: {}, decision: {}, order: AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiSelectedQuoteTaskRequestDraft }, ['kind', 'taskId', 'runId', 'original']),
    object({ kind: choice('settings'), taskId: id(), runId: id(), reference: {} })
  ] },
  AiSceneModelReferenceDraft: originalReference,
  AiSceneOrderReadReferenceDraft: originalReference,
  AiSceneOrderReadCancelDraft: object({ original: originalReference, expectedRevision: integer(1, 4294967294) }),
  AiSceneOrderReadTakeoverDraft: object({ original: originalReference, expectedTaskRevision: integer(1, 4294967294),
    expectedRunRevision: integer(1, 4294967294), expectedFencingToken: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' } }),
  AiSceneTaskUsageReadDraft: object({ original: originalReference, taskId: text(36), limit: integer(1, 20), after: text(36) }, ['original', 'limit']),
  AiTaskBudgetUsageRecordDraft: recordedUsage,
  AiOriginalTaskAccountingRequestDraft: object({ original: originalReference,
    callId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' } }),
  AiOriginalTaskAccountingOperationRequestDraft: object({ original: originalReference,
    callId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }, operation: choice('releaseUnsent', 'reconcile') }),
  AiOriginalTaskAccountingOperationResponseDraft: object({ original: originalReference,
    callId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }, operation: choice('releaseUnsent', 'reconcile'),
    taskId: text(36), reservationId: text(36), status: choice('observed', 'not_observed'),
    execution: choice('read_only_no_dispatch_or_release'), automaticRetry: { type: 'boolean', const: false },
    semantics: choice('original_accounting_operation_not_current_balance') }),
  AiOriginalTaskAccountingResponseDraft: object({ draftVersion: base.draftVersion, original: originalReference,
    taskId: text(36), record: recordedUsage, accounting: choice('observed', 'original_operation_only'),
    execution: choice('not_invoked'), automaticRetry: { type: 'boolean', const: false },
    businessExecution: choice('not_inferred_from_usage'), admission: choice('not_granted') }),
  AiTaskBudgetUsagePageDraft: object({ taskId: text(36), items: list({ oneOf: [
    object({ invocationId: text(36), callId: text(128), accounting: choice('not_recorded') }),
    // Pagination is over 20 invocations; each may have a count and a generation reservation.
    recordedUsage] }, 40), nextAfter: { oneOf: [text(36), { type: 'null' }] },
    observedAt: leafTime, coverage: choice('page_not_total'), totals: choice('not_computed'),
    pageAmounts: object({ coverage: choice('visible_page_only'), basis: choice('persisted_budget_records_not_provider_invoice'),
      recordedCount: integer(0, 40), notRecordedCount: integer(0, 20), groups: list(budgetAmountGroup, 40) }),
    consistency: choice('revalidated_reads_not_atomic_snapshot'), absenceSemantics: choice('no_record_is_not_proof_of_no_consumption'),
    businessExecution: choice('not_inferred_from_usage'), admission: choice('not_granted') },
    ['taskId', 'items', 'nextAfter', 'observedAt', 'coverage', 'totals', 'consistency', 'absenceSemantics', 'businessExecution', 'admission']),
  AiSceneModelInputRefreshDraft: object({ original: originalReference, requestId: id(), expectedRevision: integer(1, 4294967293) }),
  AiSceneModelResumeDraft: object({ original: originalReference, submission: AI_TASK_INPUT_DRAFT_SCHEMAS.AiTaskInputSubmissionDraft }),
  AiSceneModelAnswerQueryDraft: { oneOf: [
    object({ original: originalReference, submission: AI_TASK_INPUT_DRAFT_SCHEMAS.AiTaskInputSubmissionDraft }),
    object({ original: originalReference, reference: AI_TASK_INPUT_DRAFT_SCHEMAS.AiTaskInputReceiptReferenceDraft })] },
  AiSceneModelQuoteConfirmDraft: { oneOf: [
    object({ original: originalReference, submission: AI_TASK_INPUT_DRAFT_SCHEMAS.AiTaskInputSubmissionDraft,
      selectionRevision: hash, inputFingerprint: hash, confirmQuote: { type: 'boolean', const: true } }),
    object({ original: originalReference, reference: AI_TASK_INPUT_DRAFT_SCHEMAS.AiTaskInputReceiptReferenceDraft,
      selectionRevision: hash, inputFingerprint: hash, confirmQuote: { type: 'boolean', const: true } })] },
  AiSceneModelCancelDraft: object({ original: originalReference, expectedRevision: integer(1, 4294967294) }),
  AiSceneModelTakeoverDraft: object({ original: originalReference, expectedTaskRevision: integer(1, 4294967294),
    expectedRunRevision: integer(1, 4294967294), expectedFencingToken: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' } }),
  AiSceneModelResultReadDraft: object({ original: originalReference, resultId: id() }),
  AiSceneOpeningModelSourceReadDraft: object({ original: originalReference, resultId: id(), key: id() }),
  AiSceneOriginalQuotesCompareDraft: object({ previous: originalReference, current: originalReference }),
  AiSceneModelSourceReadDraft: object({ original: originalReference, resultId: id(), sourceIndex: integer(0, 4),
    sourceKind: choice('order', 'knowledge') }, ['original', 'resultId', 'sourceIndex']),
  AiSceneTaskReceiptDraft: { oneOf: [noTask, observedTask] },
  AiSceneRequestRecoveryDraft: { oneOf: [object({ task: noTask, nextAction: choice('reconcile_request_or_explicit_create_task'), automaticExecution: { type: 'boolean', const: false } }),
    object({ task: observedTask, steps: list(recoveryStep, 50), hasMore: { type: 'boolean' }, automaticExecution: { type: 'boolean', const: false },
      nextAction: choice('host_plan_handoff', 'existing_runner_recovery'), observedResults: choice('preserved_even_if_task_cancelled'), snapshot: choice('bounded_sequential_read') })] },
  AiSceneRequestCreateDraft: { oneOf: inputs.map(input => object({ ...base, ...input })) },
  AiSceneRequestReissueDraft: { oneOf: inputs.map(input => object({ ...base, ...input, previousInputRef: uuid })) },
  AiSceneRequestReadDraft: object({ draftVersion: base.draftVersion, inputRef: uuid }),
  AiSceneRequestReceiptDraft: object({ draftVersion: base.draftVersion, inputRef: uuid, revision: integer(1, 4294967294), contentHash: hash,
    sceneCode: choice(...AI_SCENE_CODES), sceneVersion: { ...id(), maxLength: 64 }, requestKey: base.requestKey,
    previousInputRef: { oneOf: [uuid, { type: 'null' }] }, expiresAt: leafTime, createdAt: leafTime, state: choice('stored', 'expired', 'revoked') })
};
