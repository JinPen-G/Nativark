/** Shared closed projections of the existing guarded scene readers. Missing
 * evidence stays explicit; these schemas neither grant access nor price data. */
import { AI_CONTRACT_DRAFT_VERSION } from './ai-native';
import { AI_OPENING_INTEGRATION_OBSERVATION_SCHEMAS } from './ai-opening-integration-observation';
import { AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION, AI_ORDER_EXPLANATION_SOURCE_FIELDS_V2 } from './ai-business-material-draft';
import { RentalCoreOrderStatus, RentalInventoryMode, RENTAL_PRICING_UNIT_CODES, RENTAL_FULFILLMENT_MODES } from './core';
import { AI_ORDER_FACTS_DRAFT_SCHEMAS } from './ai-order-facts-draft-schemas';
import { AI_SCENE_QUOTE_HTTP_SCHEMAS } from './ai-scene-quote-http-draft';
import { AI_SCENE_REQUEST_DRAFT_SCHEMAS } from './ai-scene-request-draft-schemas';
import type { RentalFulfillmentLocation } from './core';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id, leafList as list,
  leafText as text, leafTime as time, leafInt as integer, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

const scope = ref('AiWorkspaceScope'), audience = choice('operator', 'staff'), bool: AiLeafSchemaDraft = { type: 'boolean' };
const no: AiLeafSchemaDraft = { type: 'boolean', const: false }, hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const currency = { type: 'string', pattern: '^[A-Z]{3}$' }, amount = { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const version = text(191), units = choice(...RENTAL_PRICING_UNIT_CODES);
const locationCapabilities = ['pickup', 'return', 'storage', 'delivery'] as const satisfies readonly RentalFulfillmentLocation['capabilities'][number][];
const meta = { scope, audience, observedAt: time };
const reference = obj({ scope, resourceType: choice('order'), resourceId: id(), version, observedAt: time,
  field: choice('order', 'amounts', 'saved_basis', 'payment_records', 'rental_period', 'inspection_records') });
const covered = (value: AiLeafSchemaDraft) => obj({ coverage: choice('partial'), value, source: reference });
const optional = (name: string): AiLeafSchemaDraft => ({ oneOf: [covered(ref(name)), obj({ coverage: choice('unavailable', 'not_loaded') })] });
const notLoaded = obj({ coverage: choice('not_loaded') });
const order = covered(obj({ id: id(), status: choice(...Object.values(RentalCoreOrderStatus)), updatedAt: time }));
const amounts = obj({ coverage: choice('partial'), value: AI_ORDER_FACTS_DRAFT_SCHEMAS.AiOrderReadFactsDraft.properties!.order.properties!.amounts,
  source: reference, currency, meaning: choice('core_order_amounts_not_payment_totals') });
const fulfillment = obj({ coverage: choice('partial'), value: obj({ startAt: time, originalEndAt: time, effectiveEndAt: time,
  effectiveEndBasis: choice('effectiveEndAt', 'endAt_fallback') }), source: reference, inspectionExecution: choice('not_loaded') });
const candidate = obj({ code: choice('rental.order.explain', 'rental.quote.preview', 'rental.change.preview', 'rental.order.commit'),
  version, risk: choice('R0', 'R1', 'R2', 'R3'), maturity: choice('unavailable', 'preview_only', 'executable'),
  kind: choice('readonly', 'preview', 'confirmation_required_write'), executable: no,
  permission: choice('original_route_must_revalidate'), requirements: list(text(512), 32),
  source: obj({ kind: choice('tool_inventory'), code: text(191), version }) });
const model = obj({ status: choice('not_requested', 'unavailable'), answer: choice('not_generated') });
const handoff = obj({ status: choice('manual_review_only'), resource: obj({ kind: choice('order_resource'), scope, orderId: id(),
  navigation: choice('host_existing_order_route'), authorization: choice('destination_rechecks_permissions') }, ['kind', 'scope', 'orderId']),
  operatorRouteKey: choice('APP_ROUTES.orderDetail'), routeSource: choice('apps/admin/src/app/AppRouter.tsx'), candidates: list(candidate, 4),
  allowedActions: choice('unavailable', 'not_queried'), blockers: list(text(191), 2, 2), informationNeeded: list(text(191), 3),
  execution: choice('not_attempted') }, ['status', 'resource', 'candidates', 'allowedActions', 'blockers', 'informationNeeded', 'execution']);
const orderPayload = (question: string, facts: Record<string, AiLeafSchemaDraft>) => obj({ ...meta, status: choice('facts_only'),
  orderId: id(), orderVersion: time, question: choice(question), facts: obj({ order, ...facts }),
  gaps: list(obj({ field: choice('history', 'inspections', 'payments', 'actualReceivedTotal', 'fundingLedger', 'allowedActions'),
    status: choice('partial', 'not_loaded', 'unavailable') }), 3), model, handoff });
const sealed = (scenario: string, payload: AiLeafSchemaDraft) => obj({ version: choice('lane-a-business-content-1'), scenario: choice(scenario),
  payload, payloadFingerprint: hash, payloadBytes: integer(0, 131072), trust: choice('source_text_is_data_not_instructions'),
  authority: choice('none_reauthorize_before_consumption') });
const template = obj({ id: id(), code: text(191), stage: choice('pickup', 'return'), version });
const configurationSource = obj({ scope, resourceType: choice('business_configuration'), version, observedAt: time });
const section = obj({ key: id(), title: text(200), required: bool,
  status: choice('source_unavailable', 'readiness_check_passed', 'missing_configuration', 'readiness_unsatisfied', 'unclassified'), issue: text(1000, 0),
  impact: choice('optional_configuration', 'required_readiness_item'), evidence: obj({ scope, resourceType: choice('readiness_item'),
    resourceId: id(), version, observedAt: time }), manual: { oneOf: [obj({ kind: choice('configuration_section'), section: id(), scope,
      navigation: choice('host_existing_section') }), obj({ status: choice('unavailable') })] },
  candidate: obj({ status: choice('candidate_only'), currentVersion: version, fieldsToReview: list(text(191), 16),
    proposedChanges: list(obj({}), 0), persistence: choice('unavailable_no_formal_draft_port') }), externalVerification: choice('not_loaded'),
  unresolvedClassification: { ...list(choice('missing_configuration', 'configured_unverified', 'formal_check_failed', 'not_implemented',
    'external_credentials_pending', 'owner_decision_pending'), 6, 6), uniqueItems: true } },
  ['key', 'title', 'required', 'status', 'impact', 'evidence', 'manual', 'candidate', 'externalVerification', 'unresolvedClassification']);
// This is exactly prepare(), before prepareUnified() adds its host navigation
// metadata. Derive it from the same preparation branches, never another rule set.
const rawQuoteFacts = { oneOf: AI_SCENE_QUOTE_HTTP_SCHEMAS.AiSceneQuotePreparationDraft.oneOf!.map(branch => ({ ...branch,
  properties: Object.fromEntries(Object.entries(branch.properties!).filter(([key]) => !['next', 'authority', 'sideEffects'].includes(key))),
  required: branch.required!.filter(key => !['next', 'authority', 'sideEffects'].includes(key)) })) };
const sceneMaterial = (scene: string, material: string) => obj({
  original: { ...AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReceiptDraft,
    properties: { ...AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReceiptDraft.properties!, sceneCode: choice(scene) } },
  material: ref(material), materialHash: hash, trust: choice('source_text_is_data_not_instructions'),
  task: ref('AiSceneTaskReceiptDraft'), model: choice('not_called'), plan: choice('requires_host_plan_start') });

export const AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  ...AI_OPENING_INTEGRATION_OBSERVATION_SCHEMAS,
  AiOrderEvidenceReferenceDraft: reference,
  AiOrderHistoryFactsDraft: obj({ ...meta, contractVersion: choice(AI_CONTRACT_DRAFT_VERSION), requestId: id(), orderId: id(),
    sourceOrderUpdatedAt: time, basis: choice('order_snapshot'), complete: no,
    savedQuote: { oneOf: [obj({ status: choice('missing_link', 'not_loaded', 'missing', 'unavailable') }),
      obj({ status: choice('available'), basis: choice('order_linked_quote'), quoteId: id(), createdAt: time, currency,
        ruleVersion: version, pricingPlanVersion: version, priceVersionId: id(), priceVersion: version, calendarVersion: text(4096, 0), timeZone: text(100),
        contextStatus: choice('partial', 'missing'), ratesStatus: choice('available', 'missing'),
        rates: list(obj({ id: id(), itemGroupId: id(), pricingGroupId: id(), unit: units, baseAmount: amount }, ['id', 'itemGroupId', 'unit', 'baseAmount']), 100),
        calendarsEvidence: choice('not_projected') }, ['status', 'basis', 'quoteId', 'createdAt', 'ruleVersion', 'pricingPlanVersion', 'contextStatus', 'ratesStatus', 'rates', 'calendarsEvidence'])] },
    rule: { oneOf: [obj({ status: choice('missing') }), obj({ status: choice('available'), version, pickupInspectionRequired: bool, returnInspectionRequired: bool })] },
    price: obj({ status: choice('references_only', 'missing'), pricingPlanVersion: version, priceVersionId: id(), priceVersion: version,
      calendarVersion: text(4096, 1), rateEvidence: choice('not_loaded') }, ['status', 'rateEvidence']),
    inspection: obj({ status: choice('missing', 'available'), templates: list(template, 50) }) }),
  AiOrderLocalPaymentsDraft: obj({ ...meta, requestId: id(), orderId: id(), source: choice('persisted_payment_runtime'), status: choice('available'),
    intents: list(obj({ intentId: id(), instrument: choice('rental', 'deposit', 'preauthorization'), amount, currency,
      status: choice('pending', 'paid', 'failed', 'funding_failed', 'closed'), expiresAt: time, paidAt: time },
      ['intentId', 'instrument', 'amount', 'currency', 'status', 'expiresAt']), 20),
    refunds: list(obj({ refundId: id(), paymentIntentId: id(), orderId: id(), amount, currency,
      status: choice('pending', 'accepted', 'funding_pending', 'succeeded', 'failed', 'closed'), acceptedAt: time, succeededAt: time, fundedAt: time,
      createdAt: time, updatedAt: time }, ['refundId', 'paymentIntentId', 'orderId', 'amount', 'currency', 'status', 'createdAt', 'updatedAt']), 100),
    fundingLedger: choice('not_loaded'), totals: choice('not_computed'), truncated: bool, freshness: choice('local_records_not_provider_refresh') }),
  AiOrderInspectionEvidenceDraft: obj({ ...meta, orderId: id(), sourceOrderUpdatedAt: time,
    records: list(obj({ id: id(), stage: choice('pickup', 'return'), templateId: id(), templateCode: text(191), templateVersion: version,
      exchangeId: id(), baselineInspectionId: id(), createdAt: time, exceptions: list(obj({ code: text(191), description: text(2000, 0), allocationId: id(),
        reviewStatus: choice('pending', 'approved', 'rejected'), customerResponseStatus: choice('not_required', 'pending', 'confirmed', 'disputed') },
        ['code', 'description', 'reviewStatus']), 50) }, ['id', 'stage', 'templateId', 'templateCode', 'templateVersion', 'createdAt', 'exceptions']), 50),
    coverage: choice('partial'), pageCoverage: choice('page_not_total'), truncated: bool, nextCursor: { type: ['string', 'null'], minLength: 1, maxLength: 191 },
    queryBound: choice('persisted_core_page_limit_plus_one'), queryLimit: { type: 'integer', const: 50 }, queryPages: { type: 'integer', const: 1 },
    semantics: choice('recorded_inspection_and_review_only_not_liability_or_settlement'), attachments: choice('not_loaded'), execution: choice('not_attempted') }),
  AiOrderExplanationMaterialDraft: sealed('order_explanation', { oneOf: [orderPayload('status', {}), orderPayload('next_steps', {}),
    orderPayload('fees', { amounts, fulfillment, history: optional('AiOrderHistoryFactsDraft'), inspections: optional('AiOrderInspectionEvidenceDraft') }),
    orderPayload('payments', { amounts, payments: optional('AiOrderLocalPaymentsDraft'), actualReceivedTotal: notLoaded, fundingLedger: notLoaded })] }),
  AiOpeningSectionMaterialDraft: section,
  AiOpeningBusinessMaterialDraft: obj({ ...meta, configVersion: version, sections: list(section, 9, 1),
    configuration: obj({
      products: obj({ source: configurationSource, rows: list(obj({ id: id(), code: text(191), status: choice('enabled', 'disabled'),
        inventoryMode: choice(...Object.values(RentalInventoryMode)), unit: text(191) }), 100), truncated: bool }),
      pricing: obj({ source: configurationSource, currency, enabledUnits: list(units, RENTAL_PRICING_UNIT_CODES.length),
        groups: list(obj({ id: id(), code: text(191), status: choice('enabled', 'disabled'), version: integer(1, Number.MAX_SAFE_INTEGER) }), 100), truncated: bool, rates: choice('not_projected') }),
      fulfillment: obj({ source: configurationSource, enabledModes: list(choice(...RENTAL_FULFILLMENT_MODES), RENTAL_FULFILLMENT_MODES.length),
        locations: list(obj({ id: id(), code: text(191), status: choice('enabled', 'disabled'), capabilities: { ...list(choice(...locationCapabilities), locationCapabilities.length), uniqueItems: true } }), 100), truncated: bool }),
      inventory: obj({ source: configurationSource, coverage: choice('not_loaded'), meaning: choice('item_modes_are_not_stock_balances') })
    }, []), atomicity: choice('independent_sections_not_a_transaction'), externalVerification: choice('not_loaded'),
    integrationObservation: ref('AiOpeningIntegrationFactsDraft') }, [...Object.keys(meta), 'configVersion', 'sections', 'configuration', 'atomicity', 'externalVerification']),
  AiQuoteBusinessFactsDraft: rawQuoteFacts,
  AiQuoteBusinessMaterialDraft: sealed('quote_clarification', obj({ ...meta, facts: rawQuoteFacts, model,
    gaps: list(choice('human_selection_evidence_owned_by_mainline', 'no_stock_reservation', 'no_order_approval'), 3, 3), execution: choice('not_attempted') })),
  AiSceneTaskMaterialResponseDraft: { oneOf: [sceneMaterial('order_explanation', 'AiOrderExplanationMaterialDraft'),
    sceneMaterial('opening_diagnosis', 'AiOpeningBusinessMaterialDraft'), sceneMaterial('quote_clarification', 'AiQuoteBusinessMaterialDraft')] }
};

// New orders-only components. Never mutate a legacy component or widen the
// v1 union; the Controller owner chooses which named publication to expose.
const v2Reference = obj({ ...reference.properties!, field: choice(...AI_ORDER_EXPLANATION_SOURCE_FIELDS_V2) });
const v2Covered = (value: AiLeafSchemaDraft, field: string) => obj({ coverage: choice('partial'), value,
  source: obj({ ...v2Reference.properties!, field: choice(field) }) });
const v2Optional = (value: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [value, obj({ coverage: choice('unavailable', 'not_loaded') })] });
const nullableTime: AiLeafSchemaDraft = { anyOf: [time, { type: 'null' }] };
const nullableId: AiLeafSchemaDraft = { anyOf: [id(), { type: 'null' }] };
const provider = choice('mock', 'offline', 'alipay', 'wechat_pay', 'stripe');
const calendarV2: AiLeafSchemaDraft = { oneOf: [obj({ status: choice('missing', 'unavailable') }), obj({ status: choice('available'),
  rows: list(obj({ date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, year: integer(1, 9999),
    dayType: choice('workday', 'weekend', 'statutory_holiday', 'makeup_workday', 'tenant_special'),
    businessStatus: choice('open', 'limited', 'closed', 'self_service'), source: choice('week_rule', 'official_cn', 'tenant_override'),
    calendarVersion: version, itemGroupId: id(), unitCount: amount, unitAmount: amount, multiplier: amount, amount,
    priceAt: time, hitLayer: choice('date_override', 'periodic', 'day_type', 'day_type_legacy', 'base'), pricingPlanVersion: version
  }, ['date', 'year', 'dayType', 'businessStatus', 'source', 'calendarVersion', 'itemGroupId', 'unitCount', 'unitAmount', 'multiplier', 'amount']), 200) })] };
const historyV2 = obj({ ...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS.AiOrderHistoryFactsDraft.properties!, calendar: ref('AiOrderCalendarFactsV2') });
const frozenTemplateRef = obj({ id: id(), tenantId: id(), code: text(191), stage: choice('pickup', 'return'), version, enabled: bool });
const inspectionBasisV2 = obj({ contractVersion: choice('rental-order-inspection-basis-1'), orderId: id(), tenantId: id(), workspaceId: id(), sourceOrderUpdatedAt: time,
  originalTemplateRefs: list(frozenTemplateRef, 50),
  allocations: list(obj({ id: id(), orderLineId: id(), itemGroupId: id(), status: choice('pre_assigned', 'locked', 'allocated', 'picked_up', 'consumed', 'returned', 'released'),
    quantity: integer(1, Number.MAX_SAFE_INTEGER), exchangeId: id() }, ['id', 'orderLineId', 'status', 'quantity']), 200),
  exchanges: list(obj({ id: id(), type: choice('post_pickup_exchange'), status: choice('applied'), templateRefs: list(frozenTemplateRef, 50) }, ['id', 'type', 'status']), 50),
  applicableTemplateRefs: list(obj({ ...frozenTemplateRef.properties!, id: { ...id(), maxLength: 512 }, sourceTemplateId: id(),
    allocationIds: { ...list(id(), 200), uniqueItems: true }, exchangeId: id() }, [...frozenTemplateRef.required!, 'sourceTemplateId']), 200),
  recordResourceCoverage: choice('not_projected'), semantics: choice('frozen_template_applicability_not_inspection_or_execution_authority') });
const frozenInspectionBasisV2: AiLeafSchemaDraft = { oneOf: [obj({ status: choice('unavailable') }), obj({ status: choice('available'), value: ref('AiOrderInspectionBasisFactsV2') })] };
// Keep old inspection components untouched, and accept old saved v2 packets
// without this newly optional source. Missing is never promoted to available.
const inspectionV2 = obj({ ...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS.AiOrderInspectionEvidenceDraft.properties!, frozenBasis: ref('AiOrderFrozenInspectionBasisV2') },
  [...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS.AiOrderInspectionEvidenceDraft.required!]);
const fundingV2 = obj({ tenantId: id(), workspaceId: id(), orderId: id(), currency, sourceOrderUpdatedAt: time, observedAt: time,
  consistency: choice('repeatable_read_snapshot_not_provider_refresh'), coverage: choice('complete_within_200_row_caps'),
  source: choice('persisted_original_funding_domain'),
  rentalCash: { oneOf: [obj({ coverage: choice('unavailable') }), obj({ coverage: choice('available'), collected: amount, refunded: amount,
    netReceived: { type: 'number', minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER } })] },
  deposit: { oneOf: [obj({ coverage: choice('unavailable') }), obj({ coverage: choice('available'), collected: amount, captured: amount, refunded: amount, balance: amount })] },
  preauthorization: obj({ coverage: choice('unavailable'), reason: choice('no_verified_provider_preauthorization_port') }),
  legacySecurity: obj({ unverified: bool, unverifiedAmount: amount }),
  events: list(obj({ id: id(), instrument: choice('rental', 'deposit', 'preauthorization'), action: choice('initiate', 'append', 'capture', 'refund', 'release', 'fail'),
    amount, recordedProvider: provider, accountingProvider: provider, at: time,
    accounting: choice('original_recorded_funds', 'simulation_or_unverified_not_real_funds') }), 200),
  offlineRegistrations: list(obj({ id: id(), instrument: choice('rental', 'deposit'), amount, status: choice('pending', 'confirmed'),
    registeredAt: time, confirmedAt: nullableTime, fundingEventId: nullableId }), 200),
  corporateAllocations: choice('not_cash_not_loaded'), settlementBalance: choice('not_computed'), execution: choice('not_attempted') });
const lifecycleV2 = obj({ tenantId: id(), workspaceId: id(), orderId: id(), sourceOrderUpdatedAt: time,
  allocations: list(obj({ id: id(), status: choice('pre_assigned', 'locked', 'allocated', 'picked_up', 'returned', 'released', 'consumed'),
    quantity: integer(1, Number.MAX_SAFE_INTEGER) }), 200),
  changes: list(obj({ id: id(), type: id(), status: id(), requestedAt: time, appliedAt: time }, ['id', 'type', 'status', 'requestedAt']), 50),
  extensions: list(obj({ id: id(), status: choice('pending_payment', 'effective', 'cancelled', 'expired'), originalEndAt: time, newEndAt: time }), 50),
  truncated: obj({ changes: bool, extensions: bool }), semantics: choice('recorded_lifecycle_not_financial_or_action_eligibility') });
const v2Sources: Record<string, AiLeafSchemaDraft> = {
  order: v2Covered(order.properties!.value, 'order'),
  amounts: obj({ ...amounts.properties!, source: obj({ ...v2Reference.properties!, field: choice('amounts') }) }),
  saved_basis: v2Covered(ref('AiOrderHistoryFactsV2'), 'saved_basis'),
  payment_records: v2Covered(ref('AiOrderLocalPaymentsDraft'), 'payment_records'),
  rental_period: obj({ ...fulfillment.properties!, source: obj({ ...v2Reference.properties!, field: choice('rental_period') }) }),
  inspection_records: v2Covered(ref('AiOrderInspectionEvidenceV2'), 'inspection_records'),
  funding_records: v2Covered(ref('AiOrderFundingFactsV2'), 'funding_records'),
  lifecycle_records: v2Covered(ref('AiOrderLifecycleFactsV2'), 'lifecycle_records')
};
const explanationV2 = obj({ text: text(131072, 0), claims: list(obj({ field: text(512), sourceId: id(), value: {
  anyOf: [text(500, 0), { type: 'number' }, bool, { type: 'null' }] } }), 1024),
  generation: choice('deterministic_authorized_facts'), modelProse: choice('not_used'), executionAllowed: no });
const v2Payload = (question: string, facts: Record<string, AiLeafSchemaDraft>) => obj({ ...meta, status: choice('facts_only'),
  consistency: choice('revalidated_reads_not_atomic_snapshot'),
  orderId: id(), orderVersion: time, question: choice(question), facts: obj({ order: v2Sources.order, ...facts }),
  gaps: list(obj({ field: choice('history', 'inspections', 'payments', 'actualReceivedTotal', 'fundingLedger', 'allowedActions', 'lifecycle'),
    status: choice('partial', 'not_loaded', 'unavailable') }), 3), model, handoff, explanation: ref('AiOrderDeterministicExplanationV2') });
const materialV2 = obj({ version: choice(AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION), scenario: choice('order_explanation'),
  payload: { oneOf: [v2Payload('status', { lifecycle: v2Optional(v2Sources.lifecycle_records) }), v2Payload('next_steps', {}),
    v2Payload('fees', { amounts: v2Sources.amounts, fulfillment: v2Sources.rental_period, history: v2Optional(v2Sources.saved_basis),
      inspections: v2Optional(v2Sources.inspection_records), lifecycle: v2Optional(v2Sources.lifecycle_records) }),
    v2Payload('payments', { amounts: v2Sources.amounts, payments: v2Optional(v2Sources.payment_records),
      actualReceivedTotal: notLoaded, fundingLedger: v2Optional(v2Sources.funding_records) })] },
  payloadFingerprint: hash, payloadBytes: integer(0, 131072), trust: choice('source_text_is_data_not_instructions'),
  authority: choice('none_reauthorize_before_consumption') });
const sourceV2Common = { materialVersion: choice(AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION), scope, orderId: id(),
  field: choice(...AI_ORDER_EXPLANATION_SOURCE_FIELDS_V2) };
Object.assign(AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, {
  AiOrderEvidenceReferenceV2: v2Reference, AiOrderCalendarFactsV2: calendarV2, AiOrderHistoryFactsV2: historyV2,
  AiOrderInspectionBasisFactsV2: inspectionBasisV2, AiOrderFrozenInspectionBasisV2: frozenInspectionBasisV2, AiOrderInspectionEvidenceV2: inspectionV2,
  AiOrderFundingFactsV2: fundingV2, AiOrderLifecycleFactsV2: lifecycleV2, AiOrderDeterministicExplanationV2: explanationV2,
  AiOrderExplanationMaterialV2: materialV2,
  AiOrderSceneTaskMaterialV2: sceneMaterial('order_explanation', 'AiOrderExplanationMaterialV2'),
  AiOrderSourceReopenRequestV2: obj({ scope, resourceType: choice('order'), resourceId: id(), version,
    field: choice(...AI_ORDER_EXPLANATION_SOURCE_FIELDS_V2), materialVersion: choice(AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION),
    question: choice('status', 'fees', 'payments', 'next_steps') }),
  AiOrderSourceReadV2: { oneOf: [obj({ ...sourceV2Common, status: choice('stale'), reason: choice('order_version_changed_reread_material') }),
    obj({ ...sourceV2Common, status: choice('missing'), reason: choice('historical_or_optional_source_not_loaded') }),
    ...AI_ORDER_EXPLANATION_SOURCE_FIELDS_V2.map(field => obj({ ...sourceV2Common, status: choice('available'), field: choice(field),
      value: v2Sources[field], observedAt: time, freshness: choice('current_observation_not_frozen_material'),
      reauthorization: choice('current_order_authority_rechecked'), execution: choice('not_attempted') }))] }
});
