/** Wire projections of the original clarified-quote flow, not new Core inputs,
 * pricing rules or approval. Missing preparation and an unobserved original
 * operation remain distinct; none of these replies authorizes order execution. */
import type { AiWorkspaceScope } from './ai-native';
import { AI_CONTRACT_DRAFT_VERSION } from './ai-native';
import type { RentalQuoteRequest, RentalQuoteSnapshotV1 } from './core';
import { RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES, RentalInventoryMode, CUSTOMER_MEMBERSHIP_STATUSES } from './core';
import type { AiSceneQuoteCandidate, AiSceneRequestReceiptDraft } from './ai-scene-request-draft';
import type { AiTaskInputReceiptObservationDraft } from './ai-task-input-draft';
import { leafClosed as object, leafEnum as choice, leafId as id, leafText as text, leafInt as integer,
  leafList as list, leafTime, leafRef as ref, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export type AiCoreQuotePreviewFailureDraft = 'missing_input' | 'ambiguous' | 'out_of_stock' | 'qualification_required' | 'expired' | 'unavailable';
type QuotePreviewBase = {
  contractVersion: 'ain-09-quote-preview-draft-1'; requestId: string; observedAt: string; scope: AiWorkspaceScope;
};
type QuotePreviewSnapshot = {
    id: string; quoteNo: string; currency?: string; chargeLines: RentalQuoteSnapshotV1['chargeLines'];
    rentalAmount: number; discountAmount: number; couponAmount: number; serviceAmount: number; fulfillmentAmount: number;
    depositAmount: number; preAuthAmount: number; payableAmount: number; receivableAmount: number;
    pricingPlanVersion: string; priceVersionId?: string; priceVersion?: string; ruleVersion: string; calendarVersion?: string;
    expiresAt: string; createdAt: string; timeZone?: string; reservation: 'not_reserved';
    period: { startAt: string; endAt: string };
    lineUnits: Array<Pick<RentalQuoteRequest['lines'][number], 'itemGroupId' | 'pricingUnit' | 'quantity' | 'usageQuantity'>>;
    promotionEvidence: Array<{ code: string; sourceId?: string; sourceVersion?: string }>;
    promotionVersionCoverage: 'charge_line_references_only'; roundingEvidence: 'not_projected';
};
export type AiCoreQuotePreviewResultDraft = QuotePreviewBase & (
  | { status: 'quoted' | 'expired'; quotePersistence: 'saved'; quote: QuotePreviewSnapshot;
      missingFields?: never; message?: never; nextAction?: never; retryable?: never }
  | { status: AiCoreQuotePreviewFailureDraft; missingFields?: string[]; message?: string; quote?: never;
      quotePersistence?: 'saved' | 'unknown'; nextAction?: 'reconcile'; retryable?: false }
);

type ObservedAnswer = Extract<AiTaskInputReceiptObservationDraft, { state: 'observed' }>;
type UnobservedAnswer = Extract<AiTaskInputReceiptObservationDraft, { state: 'not_observed' }>;
const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const booleanFalse: AiLeafSchemaDraft = { type: 'boolean', const: false };
const nullable = (schema: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [schema, { type: 'null' }] });
const scope = object({ kind: choice('workspace'), tenantId: id(), workspaceId: id() });
const identity = { oneOf: [object({ bookingIdentity: choice('personal') }), object({ bookingIdentity: choice('enterprise_employee'),
  corporateCustomerId: id(), enterpriseContractAndPayer: { type: 'boolean' } })] };
const usageQuantity: AiLeafSchemaDraft = { type: 'number', minimum: 0, maximum: 1000000 };
const line = object({ itemGroupId: id(), quantity: integer(1, 10000), pricingUnit: choice(...RENTAL_PRICING_UNIT_CODES),
  usageQuantity }, ['itemGroupId', 'quantity', 'pricingUnit']);
const request = object({ customerType: choice('personal'), customerId: id(), bookingIdentity: identity,
  deliveryAddressId: id(), lines: list(line, 50, 1), startAt: leafTime, endAt: leafTime,
  fulfillmentMode: choice(...RENTAL_FULFILLMENT_MODES), fulfillmentLocationId: id(), returnLocationId: id() },
  ['customerType', 'customerId', 'lines', 'startAt', 'endAt', 'fulfillmentMode', 'fulfillmentLocationId']);
// Fifty supported lines can each require multiple fields plus customer,
// period, locations and revision; keep the finite refusal list large enough.
const fields = list(text(191), 200);
const phoneMasked = { ...text(64, 0), pattern: '^(?:|[0-9]{0,3}\\*{3,}[0-9]{0,4})$' };
const clarifications = list(object({ field: text(191), reason: text(191), action: text(191),
  candidates: list(object({ id: id(), label: text(191), phoneMasked }, ['id', 'label']), 10),
  truncated: { type: 'boolean' } }, ['field', 'reason', 'action', 'candidates']), 200);
// These are the existing candidate producer's finite failure variants. The
// preparation wrapper adds current read metadata; input-source failures do not.
const incomplete = (extra: Record<string, AiLeafSchemaDraft>, required: string[] = []): AiLeafSchemaDraft[] => [
  object({ ...extra, status: choice('missing_input'), missingFields: fields, ambiguousFields: fields,
    clarifications, selectionRevision: hash }, [...required, 'status', 'missingFields']),
  object({ ...extra, status: choice('qualification_required'), reason: choice('enterprise_identity_reader_unavailable'),
    clarifications }, [...required, 'status', 'reason', 'clarifications']),
  object({ ...extra, status: choice('unavailable'), reason: choice('category_unavailable', 'enterprise_payer_authority_unavailable',
    'current_product_rates_unavailable', 'category_configuration_unavailable', 'current_customer_addresses_unavailable'),
    missingFields: fields, clarifications, selectionRevision: hash }, [...required, 'status', 'reason']),
  object({ ...extra, status: choice('ambiguous'), ambiguousFields: fields, missingFields: fields, selectionRevision: hash,
    clarifications, customerCandidates: list(object({ customerId: text(191), name: text(191), phoneMasked,
      membershipStatus: choice(...CUSTOMER_MEMBERSHIP_STATUSES) }), 50) },
    [...required, 'status', 'ambiguousFields', 'missingFields', 'selectionRevision', 'clarifications', 'customerCandidates'])
];
const sourceBase = { kind: choice('supplied_candidate', 'server_resolved_candidate'), confirmed: booleanFalse,
  confirmationEvidence: choice('not_loaded') };
const sourceField = (field: string, value: AiLeafSchemaDraft, optional = false) => object({ ...sourceBase, field: choice(field), value },
  optional ? ['kind', 'confirmed', 'confirmationEvidence', 'field'] : ['kind', 'confirmed', 'confirmationEvidence', 'field', 'value']);
const sourceFields = list({ oneOf: [sourceField('customerId', id()), sourceField('bookingIdentity', identity),
  sourceField('items', list(line, 50, 1)), sourceField('startAt', leafTime), sourceField('endAt', leafTime),
  sourceField('fulfillmentMode', choice(...RENTAL_FULFILLMENT_MODES)), sourceField('fulfillmentLocationId', id()),
  sourceField('returnLocationId', id(), true), sourceField('deliveryAddressId', id())] }, 9, 7);
const noEffects = object({ quoteSaved: booleanFalse, inventoryReserved: booleanFalse, orderCreated: booleanFalse, approvalGranted: booleanFalse });
const preparationMetadata = { scope, audience: choice('operator', 'staff'), observedAt: leafTime,
  next: choice('clarify_input', 'use_qualification_flow', 'manual_review'),
  authority: choice('current_guarded_business_context'), sideEffects: noEffects };
const availabilityResult = object({ available: { type: 'boolean' }, locationId: id(), startAt: leafTime, endAt: leafTime,
  lines: list(object({ itemGroupId: id(), itemGroupCode: id(), itemGroupName: text(191), inventoryMode: choice(...Object.values(RentalInventoryMode)),
    requestedQuantity: integer(0, Number.MAX_SAFE_INTEGER), availableQuantity: integer(0, Number.MAX_SAFE_INTEGER), available: { type: 'boolean' },
    reasons: list(text(191, 0), 20) }), 100) });
const availability = object({ contractVersion: choice(AI_CONTRACT_DRAFT_VERSION), requestId: id(), scope,
  audience: choice('operator', 'staff'), observedAt: leafTime, result: availabilityResult,
  source: object({ scope, resourceType: choice('availability'), request: object({ locationId: id(), startAt: leafTime, endAt: leafTime }),
    observedAt: leafTime, fingerprint: hash }) });
const ready = (available: boolean) => object({ ...preparationMetadata, status: choice(available ? 'ready' : 'unavailable'),
  next: choice(available ? 'preview_quote' : 'manual_review'),
  ...(available ? {} : { reason: choice('current_availability_insufficient') }),
  request, timeZone: text(100), selectionRevision: hash, configurationFingerprint: hash,
  configVersion: text(191), addressFingerprint: hash, reservation: choice('not_reserved'), availability,
  confirmation: choice('host_must_verify_explicit_human_selection'), quotePersistence: choice('not_attempted'),
  review: object({ configVersion: text(191), selectionRevision: hash, configurationFingerprint: hash,
    availabilityObservedAt: leafTime, priceDifference: choice('unknown_no_previous_trusted_quote'),
    quoteValidity: choice('not_quoted'), atomicity: choice('sequential_reads_not_stock_lock') }) },
  [...Object.keys(preparationMetadata), 'status', ...(!available ? ['reason'] : []), 'request', 'timeZone', 'selectionRevision',
    'configurationFingerprint', 'configVersion', 'reservation', 'availability', 'confirmation', 'quotePersistence', 'review']);
const observedAnswer = object({ state: choice('observed'), retryable: booleanFalse, taskId: { ...id(), maxLength: 36 },
  requestId: { ...id(), maxLength: 36 }, receiptId: { ...id(), maxLength: 36 }, taskRevision: integer(1, 4294967294),
  runId: { ...id(), maxLength: 36 }, execution: choice('not_inferred_from_receipt') });
const unobservedAnswer = object({ state: choice('not_observed'), retryable: booleanFalse });
const amount: AiLeafSchemaDraft = { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const quote = object({ id: id(), quoteNo: text(191), currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  chargeLines: list(object({ code: text(191), name: text(500), type: choice('rental', 'calendar_adjustment', 'fulfillment', 'preauthorization',
    'discount', 'coupon', 'service', 'deposit', 'cancellation', 'overdue', 'damage', 'extension', 'early_return_refund', 'order_change'),
    amount: { type: 'number', minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    sourceId: text(191, 0), sourceVersion: text(191, 0), detail: text(2000, 0) }, ['code', 'name', 'type', 'amount']), 100),
  ...Object.fromEntries(['rentalAmount', 'discountAmount', 'couponAmount', 'serviceAmount', 'fulfillmentAmount', 'depositAmount',
    'preAuthAmount', 'payableAmount', 'receivableAmount'].map(field => [field, amount])),
  pricingPlanVersion: text(191), priceVersionId: id(), priceVersion: text(191), ruleVersion: text(191), calendarVersion: text(4096, 0),
  expiresAt: leafTime, createdAt: leafTime, timeZone: text(100), reservation: choice('not_reserved'),
  period: object({ startAt: leafTime, endAt: leafTime }),
  lineUnits: list(object({ itemGroupId: id(), pricingUnit: choice(...RENTAL_PRICING_UNIT_CODES), quantity: integer(1, 10000), usageQuantity }, ['quantity']), 100, 1),
  promotionEvidence: list(object({ code: text(191), sourceId: text(191, 0), sourceVersion: text(191, 0) }, ['code']), 100),
  promotionVersionCoverage: choice('charge_line_references_only'), roundingEvidence: choice('not_projected') },
  ['id', 'quoteNo', 'chargeLines', 'rentalAmount', 'discountAmount', 'couponAmount', 'serviceAmount', 'fulfillmentAmount', 'depositAmount',
    'preAuthAmount', 'payableAmount', 'receivableAmount', 'pricingPlanVersion', 'ruleVersion', 'expiresAt', 'createdAt', 'reservation',
    'period', 'lineUnits', 'promotionEvidence', 'promotionVersionCoverage', 'roundingEvidence']);
const resultBase = { contractVersion: choice('ain-09-quote-preview-draft-1'), requestId: id(), observedAt: leafTime, scope };
const preparation = { oneOf: [ready(true), ready(false), ...incomplete(preparationMetadata, Object.keys(preparationMetadata))] };
const sources = { oneOf: [object({ status: choice('prepared_input_sources'), request, selectionRevision: hash, inputFingerprint: hash,
  fields: sourceFields, coreNormalization: choice('not_yet_called'), humanConfirmation: choice('required_before_preview') }), ...incomplete({})] };
const previewResponse = { oneOf: [
  object({ ...resultBase, status: choice('quoted', 'expired'), quotePersistence: choice('saved'), quote }),
  object({ ...resultBase, status: choice('missing_input', 'ambiguous', 'out_of_stock', 'qualification_required', 'expired', 'unavailable'),
    missingFields: fields, message: text(512), quotePersistence: choice('saved', 'unknown'), nextAction: choice('reconcile'), retryable: booleanFalse },
    [...Object.keys(resultBase), 'status'])
] };
const operation = { original: ref('AiSceneRequestReceiptDraft'), receipt: observedAnswer, result: ref('AiCoreQuotePreviewResultDraft'),
  orderApproval: choice('not_granted'), inventoryReservation: choice('not_attempted') };

export const AI_SCENE_QUOTE_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiCoreQuotePreviewResultDraft: previewResponse,
  AiSceneQuotePreparationDraft: preparation,
  AiSceneQuoteInputSourcesDraft: sources,
  AiSceneModelQuotePreparationResponseDraft: { oneOf: [
    object({ receipt: unobservedAnswer, preparation: choice('unavailable') }),
    object({ original: ref('AiSceneRequestReceiptDraft'), receipt: observedAnswer, candidate: ref('AiSceneQuoteCandidateDraft'), preparation, sources,
      inputFingerprint: hash, formalInputFingerprint: nullable(hash), quotation: choice('not_attempted'),
      inventoryReservation: choice('not_attempted'), orderApproval: choice('not_granted'), nextAction: choice('review_current_parameters_before_formal_quote') })
  ] },
  AiSceneModelQuoteConfirmResponseDraft: { oneOf: [
    object({ receipt: observedAnswer, preparation, quotation: choice('not_attempted') }),
    object({ ...operation, observation: choice('explicit_clarified_quote_request'), taskOutcome: choice('not_changed_by_quote') })
  ] },
  AiSceneModelQuoteReceiptResponseDraft: { oneOf: [
    object({ receipt: unobservedAnswer, quotation: choice('unavailable') }),
    object({ ...operation, observation: choice('original_clarified_quote_operation_only') })
  ] }
};

export type AiSceneModelQuotePreparationResponseDraft =
  | { receipt: UnobservedAnswer; preparation: 'unavailable' }
  | { original: AiSceneRequestReceiptDraft; receipt: ObservedAnswer; candidate: AiSceneQuoteCandidate;
      inputFingerprint: string; formalInputFingerprint: string | null; quotation: 'not_attempted';
      inventoryReservation: 'not_attempted'; orderApproval: 'not_granted'; nextAction: 'review_current_parameters_before_formal_quote';
      preparation: AiSceneQuotePreparationDraft; sources: AiSceneQuoteInputSourcesDraft };
type Clarifications = Array<{ field: string; reason: string; action: string;
  candidates: Array<{ id: string; label: string; phoneMasked?: string }>; truncated?: boolean }>;
type Incomplete =
  | { status: 'missing_input'; missingFields: string[]; ambiguousFields?: string[]; selectionRevision?: string; clarifications?: Clarifications }
  | { status: 'qualification_required'; reason: 'enterprise_identity_reader_unavailable'; clarifications: Clarifications }
  | { status: 'unavailable'; reason: 'category_unavailable' | 'enterprise_payer_authority_unavailable' |
      'current_product_rates_unavailable' | 'category_configuration_unavailable' | 'current_customer_addresses_unavailable';
      missingFields?: string[]; selectionRevision?: string; clarifications?: Clarifications }
  | { status: 'ambiguous'; ambiguousFields: string[]; missingFields: string[]; selectionRevision: string; clarifications: Clarifications;
      customerCandidates: Array<{ customerId: string; name: string; phoneMasked: string; membershipStatus: typeof CUSTOMER_MEMBERSHIP_STATUSES[number] }> };
type FormalLine = { itemGroupId: string; quantity: number; pricingUnit: NonNullable<RentalQuoteRequest['lines'][number]['pricingUnit']>; usageQuantity?: number };
type FormalRequest = Pick<RentalQuoteRequest, 'bookingIdentity' | 'deliveryAddressId' |
  'startAt' | 'endAt' | 'fulfillmentMode' | 'fulfillmentLocationId' | 'returnLocationId'> & {
    customerType: 'personal'; customerId: string; lines: FormalLine[] };
type PreparationMetadata = { scope: AiWorkspaceScope; audience: 'operator' | 'staff'; observedAt: string;
  next: 'preview_quote' | 'clarify_input' | 'use_qualification_flow' | 'manual_review'; authority: 'current_guarded_business_context';
  sideEffects: { quoteSaved: false; inventoryReserved: false; orderCreated: false; approvalGranted: false } };
export type AiSceneQuotePreparationDraft = PreparationMetadata & (Incomplete | ({
  status: 'ready'; reason?: never } | { status: 'unavailable'; reason: 'current_availability_insufficient' }) & {
  request: FormalRequest; timeZone: string;
  selectionRevision: string; configurationFingerprint: string; configVersion: string; addressFingerprint?: string; reservation: 'not_reserved';
  availability: { contractVersion: typeof AI_CONTRACT_DRAFT_VERSION; requestId: string; audience: 'operator' | 'staff'; scope: AiWorkspaceScope;
    observedAt: string; result: import('./core').RentalAvailabilityResult; source: { scope: AiWorkspaceScope; resourceType: 'availability';
      request: { locationId: string; startAt: string; endAt: string }; observedAt: string; fingerprint: string } };
  confirmation: 'host_must_verify_explicit_human_selection'; quotePersistence: 'not_attempted';
  review: { configVersion: string; selectionRevision: string; configurationFingerprint: string; availabilityObservedAt: string;
    priceDifference: 'unknown_no_previous_trusted_quote'; quoteValidity: 'not_quoted'; atomicity: 'sequential_reads_not_stock_lock' }
});
export type AiSceneQuoteInputSourcesDraft = Incomplete | { status: 'prepared_input_sources'; request: FormalRequest;
  selectionRevision: string; inputFingerprint: string; coreNormalization: 'not_yet_called'; humanConfirmation: 'required_before_preview';
  fields: Array<{ kind: 'supplied_candidate' | 'server_resolved_candidate'; confirmed: false; confirmationEvidence: 'not_loaded' } & (
    { field: 'customerId' | 'startAt' | 'endAt' | 'fulfillmentLocationId' | 'deliveryAddressId'; value: string } |
    { field: 'returnLocationId'; value?: string } | { field: 'bookingIdentity'; value: NonNullable<RentalQuoteRequest['bookingIdentity']> } |
    { field: 'items'; value: FormalLine[] } | { field: 'fulfillmentMode'; value: RentalQuoteRequest['fulfillmentMode'] })> };
export type AiSceneModelQuoteConfirmResponseDraft = { receipt: ObservedAnswer; preparation: AiSceneQuotePreparationDraft; quotation: 'not_attempted' }
  | { original: AiSceneRequestReceiptDraft; receipt: ObservedAnswer; result: AiCoreQuotePreviewResultDraft; observation: 'explicit_clarified_quote_request';
      orderApproval: 'not_granted'; inventoryReservation: 'not_attempted'; taskOutcome: 'not_changed_by_quote' };
export type AiSceneModelQuoteReceiptResponseDraft = { receipt: UnobservedAnswer; quotation: 'unavailable' }
  | { original: AiSceneRequestReceiptDraft; receipt: ObservedAnswer; result: AiCoreQuotePreviewResultDraft;
      observation: 'original_clarified_quote_operation_only'; orderApproval: 'not_granted'; inventoryReservation: 'not_attempted' };
