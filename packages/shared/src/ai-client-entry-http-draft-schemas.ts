import { AI_CLIENT_QUOTE_PREPARATION_VERSION } from './ai-client-quote-draft';
import { AI_TASK_DRAFT_VERSION } from './ai-task-draft';
import { AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS } from './ai-entry-management-draft-schemas';

/** Customer HTTP publication only, not authorization or execution. Business
 * materials/input reuse CLIENT-01; internal persistence is not a wire DTO. */
const id = { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const uuid = { type: 'string', format: 'uuid' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const date = { type: 'string', format: 'date-time' };
const literal = (value: string | boolean | number) => ({ const: value });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullableId = { anyOf: [id, { type: 'null' }] };
const amount = { type: 'number', minimum: 0 };
const revision = { type: 'integer', minimum: 1, maximum: 4294967295 };
// All customer cancellation variants share the original receipt's wire bound.
const cancelTransition = { taskRevision: revision,
  cursor: AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS.AiClientTaskUnstartedCancellationReceipt.properties.cursor, observedAt: date };
const quotePreparation = { contractVersion: literal(AI_CLIENT_QUOTE_PREPARATION_VERSION), materialRef: uuid,
  materialHash: hash, inputHash: hash, revision: literal(1), expiresAt: date,
  preparation: literal('normalized_parameters'), eligibility: literal('not_attested'),
  quotePersistence: literal('not_attempted'), inventoryReservation: literal('not_attempted'),
  humanAction: literal('explicit_confirmation_required'), freshness: literal('recheck_at_confirmation') };
const originalQuoteFacts = object({ quoteId: id, currency: { anyOf: [{ type: 'string', pattern: '^[A-Z]{3}$' }, { type: 'null' }] },
  payableAmount: { anyOf: [amount, { type: 'null' }] }, depositAmount: { anyOf: [amount, { type: 'null' }] },
  preAuthAmount: { anyOf: [amount, { type: 'null' }] }, pricingPlanVersion: nullableId, ruleVersion: nullableId,
  priceVersionId: nullableId, calendarVersion: nullableId, categoryVersionId: nullableId,
  createdAt: { anyOf: [date, { type: 'null' }] }, expiresAt: { anyOf: [date, { type: 'null' }] },
  chargeLines: { anyOf: [{ type: 'array', maxItems: 100, items: object({ type: id, amount: { type: 'number' },
    sourceId: nullableId, sourceVersion: nullableId }) }, { type: 'null' }] } });
const quoteResult = { contractVersion: literal(AI_CLIENT_QUOTE_PREPARATION_VERSION),
  source: object({ materialRef: uuid, materialHash: hash }), inventoryReservation: literal('not_attempted'),
  orderExecution: literal('not_attempted'), confirmation: literal('parameters_only_not_order_approval'),
  retryable: literal(false), nextAction: literal('read_original_quote') };
const clientPublication = object({ tenantCode: { type: 'string' }, channel: { enum: ['wechat_miniprogram', 'app', 'web'] },
  service: object({ code: { type: 'string' }, name: { type: 'string' }, categoryCode: { type: 'string' }, status: literal('open') }) });
const clientOrderText = { type: 'string', minLength: 1, maxLength: 191 };
const clientOrderTime = { ...date, maxLength: 40 };
const orderFact = (field: string, value: Record<string, unknown>) => {
  const source = object({ kind: literal('client_order_projection'), orderId: id, field: literal(field),
    version: { anyOf: [clientOrderTime, { type: 'null' }] } });
  return { oneOf: [object({ coverage: literal('unknown'), source }), object({ coverage: literal('recorded'), value, source })] };
};
const orderFeeSource = object({ kind: literal('client_order_projection'), orderId: id, field: literal('feeItems'),
  version: { anyOf: [clientOrderTime, { type: 'null' }] } });
const orderExplanation = { orderId: id, status: orderFact('status', clientOrderText), orderVersion: orderFact('updatedAt', clientOrderTime),
  fulfillment: object({ mode: orderFact('fulfillmentMode', clientOrderText), startAt: orderFact('startAt', clientOrderTime),
    endAt: orderFact('endAt', clientOrderTime), effectiveEndAt: orderFact('effectiveEndAt', clientOrderTime) }),
  gaps: object({ historicalQuote: literal('unavailable_client_history_port_missing'), payments: literal('not_loaded_no_received_total_inferred'),
    refunds: literal('not_loaded_no_refund_outcome_inferred'), allowedActions: literal('unavailable_client_allowed_actions_port_missing') }),
  inspectionFees: { oneOf: [object({ coverage: literal('unavailable'), reason: literal('client_fee_items_port_missing'), source: orderFeeSource }),
    object({ coverage: literal('recorded'), source: orderFeeSource, value: object({ apiVersion: clientOrderText, orderId: clientOrderText,
      items: { type: 'array', maxItems: 50, items: object({ inspectionId: clientOrderText, exceptionIndex: { type: 'integer', minimum: 0 },
        stage: { enum: ['pickup', 'return'] }, code: clientOrderText, description: { type: 'string', maxLength: 2000 }, amount,
        currency: clientOrderText, responseStatus: { enum: ['pending', 'confirmed', 'disputed'] }, evidenceCount: { type: 'integer', minimum: 0 } }) },
      pendingCount: { type: 'integer', minimum: 0 } }, ['orderId', 'items', 'pendingCount']) })] },
  amountSemantics: literal('recorded_order_amounts_not_payment_or_refund_evidence'), model: literal('not_requested'), businessExecution: literal('not_attempted') };
const orderAmountFields = ['rentalAmount', 'discountAmount', 'couponAmount', 'serviceAmount', 'fulfillmentAmount',
  'depositAmount', 'preAuthAmount', 'payableAmount', 'adjustmentAmount', 'finalPayableAmount'];
const clientSourcePacket = { state: literal('saved'), operationKey: id, inputHash: hash, revision: literal(1), materialRef: uuid, materialHash: hash,
  source: object({ materialRef: uuid, tenantCode: id, serviceCode: id, channel: { enum: ['wechat_miniprogram', 'app', 'web'] } }),
  publication: clientPublication, expiresAt: date, createdAt: date, verifiedAt: date,
  trust: literal('client_api_projection_not_model_instructions'), durability: literal('persisted_client_material_not_task_history'),
  model: literal('unavailable_client_execution_contract_missing'), automaticExecution: literal(false) };

export const AI_CLIENT_ENTRY_HTTP_SCHEMAS = {
  // Keep the nested input on the original CLIENT-01 DTO, not an AI quote DSL.
  AiClientQuotePreparationRequest: object({ operationKey: { ...id, maxLength: 128 }, input: ref('ClientQuoteRequest') }),
  AiClientQuoteConfirmationRequest: object({ materialRef: uuid, expectedMaterialHash: hash }),
  AiClientQuotePreparationResponse: object({ ...quotePreparation, replayed: { type: 'boolean' } }),
  AiClientQuotePreparationReadResponse: { oneOf: [
    object({ ...quotePreparation, state: literal('observed'), retryable: literal(false), execution: literal('read_only') }),
    object({ contractVersion: literal(AI_CLIENT_QUOTE_PREPARATION_VERSION), state: literal('unknown'),
      operationKey: id, retryable: literal(false), execution: literal('read_only') })] },
  AiClientQuoteFacts: originalQuoteFacts,
  AiClientQuoteResultReadResponse: { oneOf: [
    object({ ...quoteResult, state: literal('observed'), quote: ref('AiClientQuoteFacts'), quotePersistence: literal('saved') }),
    object({ ...quoteResult, state: literal('unknown'), quote: { type: 'null' }, quotePersistence: literal('unknown') })] },
  AiClientTaskCancelReceipt: object({ contractVersion: literal(AI_TASK_DRAFT_VERSION), taskId: { ...id, maxLength: 36 },
    ...cancelTransition, status: literal('cancel_requested'), cancellation: literal('requested_not_rollback'),
    retryable: literal(false), nextAction: literal('read_original_task') }),
  AiClientTaskInputCancellationReceipt: object({ contractVersion: literal(AI_TASK_DRAFT_VERSION), taskId: { ...id, maxLength: 36 },
    ...cancelTransition, status: literal('cancelled'), cancellation: literal('released_input_wait_settled'),
    externalRollback: literal('not_claimed'), retryable: literal(false), nextAction: literal('read_original_task') }),
  AiClientOrderExplanationReadResponse: object({ scope: object({ tenantId: id, workspaceId: id }), publication: clientPublication,
    observedAt: date, execution: literal('read_only_no_task_start'), facts: { oneOf: [
      object({ ...orderExplanation, question: literal('status') }),
      object({ ...orderExplanation, question: literal('fees'), currency: orderFact('currency', clientOrderText),
        amounts: object(Object.fromEntries(orderAmountFields.map(field => [field, orderFact(field, { type: 'number' })]))) })] } }),
  // Original CLIENT-01 projections may contain optional business fields; this
  // wrapper does not silently reinterpret them as an AI-owned closed fact.
  AiClientSourceReadResponse: { oneOf: [
    ...([['catalog', 'ClientCatalog'], ['help', 'ClientPublicDocumentResponse'], ['profile', 'ClientProfile'], ['order', 'ClientOrder']] as const)
      .map(([kind, schema]) => object({ ...clientSourcePacket, kind: literal(kind), material: ref(schema), handoff: { type: 'null' } })),
    object({ ...clientSourcePacket, kind: literal('booking_quote'), material: AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS.AiBookingDraft.properties.material,
      handoff: { type: 'null' } }),
    object({ ...clientSourcePacket, kind: literal('cancellation_preview'), material: ref('ClientCancellationPreview'),
      handoff: object({ method: literal('POST'), path: { type: 'string', pattern: '^/api/client/v1/orders/[A-Za-z0-9][A-Za-z0-9._:-]*/cancel$' },
        requiredBodyFields: { type: 'array', minItems: 1, maxItems: 1, items: literal('reason') },
        confirmation: literal('explicit_human_action'), execution: literal('not_attempted') }) })] },
  AiEntryActionRequest: object({ actionCode: { enum: ['OPEN_ORDER', 'CREATE_BOOKING_DRAFT'] }, materialRef: uuid }),
  AiBookingActionRequest: object({ action: ref('AiEntryActionDraft'), operationKey: id }),
  AiBookingDraftSelection: object({ bookingDraftId: uuid }),
  AiBookingHandoffSelection: object({ handoffRef: uuid }),
  AiBookingChoiceRequest: object({ bookingDraftId: uuid, expectedRevision: { ...revision, maximum: 4294967294 },
    inputFingerprint: hash, operationKey: id, decision: { enum: ['continue_booking', 'abandon'] } }),
  AiBookingCreateResponse: object({ draft: ref('AiBookingDraft'), operation: id, replayed: { type: 'boolean' } }),
  AiBookingChoiceResponse: { oneOf: [object({ draft: ref('AiBookingDraft'), replayed: { type: 'boolean' } }),
    object({ bookingDraftId: uuid, state: literal('abandoned'), revision, replayed: { type: 'boolean' } })] },
  AiBookingHandoffResponse: object({ handoff: ref('AiBookingHandoff'), replayed: { type: 'boolean' } }),
  AiBookingOperationReadRequest: object({ operationKey: id }),
  AiBookingOperationReadResponse: { oneOf: [
    object({ state: literal('unknown'), operationKey: id, retryable: literal(false), nextAction: literal('read_booking_operation') }),
    object({ state: literal('observed'), operationKey: id, bookingDraftId: uuid, kind: { enum: ['create', 'select', 'handoff', 'abandon'] },
      resultRevision: revision, handoffRef: { anyOf: [uuid, { type: 'null' }] }, businessSubmission: literal('not_attested'), retryable: literal(false) })] },
} as const;
