/** Existing bounded scene content on the public wire. These references and
 * hashes are data/provenance only, never authority, dispatch or approval. The
 * legacy content version is preserved for stored inputs and future runtimes. */
import type { AiWorkspaceScope, AiToolMaturity, AI_CONTRACT_DRAFT_VERSION } from './ai-native';
import type { AiOrderReadFactsDraft } from './ai-order-facts-draft';
import type { AiSceneQuotePreparationDraft } from './ai-scene-quote-http-draft';
import type { AiSceneRequestReceiptDraft, AiSceneTaskReceiptDraft } from './ai-scene-request-draft';
import type { RentalInventoryMode, RentalFulfillmentLocation, RENTAL_PRICING_UNIT_CODES, RENTAL_FULFILLMENT_MODES } from './core';
import { z } from 'zod';

type Unit = typeof RENTAL_PRICING_UNIT_CODES[number];
type Mode = typeof RENTAL_FULFILLMENT_MODES[number];
type ReadAudience = 'operator' | 'staff';
export interface AiSealedBusinessMaterialDraft<S extends string, T> {
  version: 'lane-a-business-content-1'; scenario: S; payload: T; payloadFingerprint: string; payloadBytes: number;
  trust: 'source_text_is_data_not_instructions'; authority: 'none_reauthorize_before_consumption';
}
export interface AiOrderEvidenceReferenceDraft { scope: AiWorkspaceScope; resourceType: 'order'; resourceId: string;
  version: string; field: 'order' | 'amounts' | 'saved_basis' | 'payment_records' | 'rental_period' | 'inspection_records'; observedAt: string }
type Covered<T> = { coverage: 'partial'; value: T; source: AiOrderEvidenceReferenceDraft };
type OptionalEvidence<T> = Covered<T> | { coverage: 'unavailable' | 'not_loaded' };
export interface AiOrderHistoryFactsDraft {
  contractVersion: typeof AI_CONTRACT_DRAFT_VERSION; requestId: string; audience: ReadAudience; scope: AiWorkspaceScope; observedAt: string;
  orderId: string; sourceOrderUpdatedAt: string; basis: 'order_snapshot'; complete: false;
  savedQuote: { status: 'missing_link' | 'not_loaded' | 'missing' | 'unavailable' } | {
    status: 'available'; basis: 'order_linked_quote'; quoteId: string; createdAt: string; currency?: string; ruleVersion: string;
    pricingPlanVersion: string; priceVersionId?: string; priceVersion?: string; calendarVersion?: string; timeZone?: string;
    contextStatus: 'partial' | 'missing'; ratesStatus: 'available' | 'missing';
    rates: Array<{ id: string; itemGroupId: string; pricingGroupId?: string; unit: Unit; baseAmount: number }>;
    calendarsEvidence: 'not_projected' };
  rule: { status: 'missing' } | { status: 'available'; version: string; pickupInspectionRequired: boolean; returnInspectionRequired: boolean };
  price: { status: 'references_only' | 'missing'; pricingPlanVersion?: string; priceVersionId?: string; priceVersion?: string;
    calendarVersion?: string; rateEvidence: 'not_loaded' };
  inspection: { status: 'missing' | 'available'; templates: Array<{ id: string; code: string; stage: 'pickup' | 'return'; version: string }> };
}
export interface AiOrderLocalPaymentsDraft { requestId: string; audience: ReadAudience; scope: AiWorkspaceScope; orderId: string;
  observedAt: string; source: 'persisted_payment_runtime'; status: 'available';
  intents: Array<{ intentId: string; instrument: 'rental' | 'deposit' | 'preauthorization'; amount: number; currency: string;
    status: 'pending' | 'paid' | 'failed' | 'funding_failed' | 'closed'; expiresAt: string; paidAt?: string }>;
  refunds: Array<{ refundId: string; paymentIntentId: string; orderId: string; amount: number; currency: string;
    status: 'pending' | 'accepted' | 'funding_pending' | 'succeeded' | 'failed' | 'closed'; acceptedAt?: string; succeededAt?: string;
    fundedAt?: string; createdAt: string; updatedAt: string }>;
  fundingLedger: 'not_loaded'; totals: 'not_computed'; truncated: boolean; freshness: 'local_records_not_provider_refresh';
}
export interface AiOrderInspectionEvidenceDraft { scope: AiWorkspaceScope; audience: ReadAudience; orderId: string;
  sourceOrderUpdatedAt: string; observedAt: string;
  records: Array<{ id: string; stage: 'pickup' | 'return'; templateId: string; templateCode: string; templateVersion: string;
    exchangeId?: string; baselineInspectionId?: string; createdAt: string; exceptions: Array<{ code: string; description: string;
      allocationId?: string; reviewStatus: 'pending' | 'approved' | 'rejected'; customerResponseStatus?: 'not_required' | 'pending' | 'confirmed' | 'disputed' }> }>;
  coverage: 'partial'; pageCoverage: 'page_not_total'; truncated: boolean; nextCursor: string | null;
  queryBound: 'persisted_core_page_limit_plus_one'; queryLimit: 50; queryPages: 1;
  semantics: 'recorded_inspection_and_review_only_not_liability_or_settlement'; attachments: 'not_loaded'; execution: 'not_attempted';
}
export interface AiOrderNextCandidateDraft { code: 'rental.order.explain' | 'rental.quote.preview' | 'rental.change.preview' | 'rental.order.commit';
  version: string; risk: 'R0' | 'R1' | 'R2' | 'R3'; maturity: AiToolMaturity; kind: 'readonly' | 'preview' | 'confirmation_required_write';
  executable: false; permission: 'original_route_must_revalidate'; requirements: string[];
  source: { kind: 'tool_inventory'; code: string; version: string } }
type OrderStatus = Covered<{ id: string; status: AiOrderReadFactsDraft['order']['status']; updatedAt: string }>;
type Amounts = Covered<AiOrderReadFactsDraft['order']['amounts']> & { currency: string; meaning: 'core_order_amounts_not_payment_totals' };
type Fulfillment = Covered<Pick<AiOrderReadFactsDraft['order'], 'startAt' | 'originalEndAt' | 'effectiveEndAt' | 'effectiveEndBasis'>> & { inspectionExecution: 'not_loaded' };
type OrderProjection =
  | { question: 'status' | 'next_steps'; facts: { order: OrderStatus } }
  | { question: 'fees'; facts: { order: OrderStatus; amounts: Amounts; fulfillment: Fulfillment;
      history: OptionalEvidence<AiOrderHistoryFactsDraft>; inspections: OptionalEvidence<AiOrderInspectionEvidenceDraft> } }
  | { question: 'payments'; facts: { order: OrderStatus; amounts: Amounts; payments: OptionalEvidence<AiOrderLocalPaymentsDraft>;
      actualReceivedTotal: { coverage: 'not_loaded' }; fundingLedger: { coverage: 'not_loaded' } } };
export type AiOrderExplanationMaterialDraft = AiSealedBusinessMaterialDraft<'order_explanation', OrderProjection & {
  status: 'facts_only'; scope: AiWorkspaceScope; audience: ReadAudience; orderId: string; orderVersion: string; observedAt: string;
  gaps: Array<{ field: 'history' | 'inspections' | 'payments' | 'actualReceivedTotal' | 'fundingLedger' | 'allowedActions';
    status: 'partial' | 'not_loaded' | 'unavailable' }>;
  model: { status: 'not_requested' | 'unavailable'; answer: 'not_generated' };
  handoff: { status: 'manual_review_only'; resource: { kind: 'order_resource'; scope: AiWorkspaceScope; orderId: string;
      navigation?: 'host_existing_order_route'; authorization?: 'destination_rechecks_permissions' };
    operatorRouteKey?: 'APP_ROUTES.orderDetail'; routeSource?: 'apps/admin/src/app/AppRouter.tsx'; candidates: AiOrderNextCandidateDraft[];
    allowedActions: 'unavailable' | 'not_queried'; blockers: string[]; informationNeeded: string[]; execution: 'not_attempted' }
}>;
/** Orders-only publication version. Legacy material, original request and model
 * input versions above remain unchanged; this packet never grants execution. */
export const AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION = 'ain-order-explanation-material-2' as const;
export const AI_ORDER_EXPLANATION_SOURCE_FIELDS_V2 = ['order', 'amounts', 'saved_basis', 'payment_records',
  'rental_period', 'inspection_records', 'funding_records', 'lifecycle_records'] as const;
export type AiOrderEvidenceFieldV2 = typeof AI_ORDER_EXPLANATION_SOURCE_FIELDS_V2[number];
export interface AiOrderEvidenceReferenceV2 extends Omit<AiOrderEvidenceReferenceDraft, 'field'> { field: AiOrderEvidenceFieldV2 }
export type AiOrderCoveredEvidenceV2<T> = { coverage: 'partial'; value: T; source: AiOrderEvidenceReferenceV2 };
export type AiOrderOptionalEvidenceV2<T> = AiOrderCoveredEvidenceV2<T> | { coverage: 'unavailable' | 'not_loaded' };
export type AiOrderCalendarFactsV2 = { status: 'missing' | 'unavailable' } | { status: 'available'; rows: Array<{
  date: string; year: number; dayType: 'workday' | 'weekend' | 'statutory_holiday' | 'makeup_workday' | 'tenant_special';
  businessStatus: 'open' | 'limited' | 'closed' | 'self_service'; source: 'week_rule' | 'official_cn' | 'tenant_override';
  calendarVersion: string; itemGroupId: string; unitCount: number; unitAmount: number; multiplier: number; amount: number;
  priceAt?: string; hitLayer?: 'date_override' | 'periodic' | 'day_type' | 'day_type_legacy' | 'base'; pricingPlanVersion?: string;
}> };
/** Applied order-owned daily facts; amount is not quantity-multiplied/capped
 * line rent. Annual calendars/full repricing remain outside this projection. */
export interface AiOrderHistoryFactsV2 extends AiOrderHistoryFactsDraft { calendar: AiOrderCalendarFactsV2 }
/** Original Core whitelist, not a second template applicability contract or an
 * execution grant. Optional on v2 inspection evidence for older saved packets. */
export type AiOrderInspectionBasisFactsV2 = import('./core').RentalOrderInspectionBasisFacts;
export type AiOrderFrozenInspectionBasisV2 = { status: 'unavailable' }
  | { status: 'available'; value: AiOrderInspectionBasisFactsV2 };
export interface AiOrderInspectionEvidenceV2 extends AiOrderInspectionEvidenceDraft {
  frozenBasis?: AiOrderFrozenInspectionBasisV2;
}
export interface AiOrderFundingFactsV2 {
  tenantId: string; workspaceId: string; orderId: string; currency: string; sourceOrderUpdatedAt: string; observedAt: string;
  consistency: 'repeatable_read_snapshot_not_provider_refresh'; coverage: 'complete_within_200_row_caps';
  source: 'persisted_original_funding_domain';
  rentalCash: { coverage: 'unavailable' } | { coverage: 'available'; collected: number; refunded: number; netReceived: number };
  deposit: { coverage: 'unavailable' } | { coverage: 'available'; collected: number; captured: number; refunded: number; balance: number };
  preauthorization: { coverage: 'unavailable'; reason: 'no_verified_provider_preauthorization_port' };
  legacySecurity: { unverified: boolean; unverifiedAmount: number };
  events: Array<{ id: string; instrument: 'rental' | 'deposit' | 'preauthorization';
    action: 'initiate' | 'append' | 'capture' | 'refund' | 'release' | 'fail'; amount: number;
    recordedProvider: 'mock' | 'offline' | 'alipay' | 'wechat_pay' | 'stripe';
    accountingProvider: 'mock' | 'offline' | 'alipay' | 'wechat_pay' | 'stripe'; at: string;
    accounting: 'original_recorded_funds' | 'simulation_or_unverified_not_real_funds' }>;
  offlineRegistrations: Array<{ id: string; instrument: 'rental' | 'deposit'; amount: number; status: 'pending' | 'confirmed';
    registeredAt: string; confirmedAt: string | null; fundingEventId: string | null }>;
  corporateAllocations: 'not_cash_not_loaded'; settlementBalance: 'not_computed'; execution: 'not_attempted';
}
export interface AiOrderLifecycleFactsV2 {
  tenantId: string; workspaceId: string; orderId: string; sourceOrderUpdatedAt: string;
  allocations: Array<{ id: string; status: 'pre_assigned' | 'locked' | 'allocated' | 'picked_up' | 'returned' | 'released' | 'consumed'; quantity: number }>;
  changes: Array<{ id: string; type: string; status: string; requestedAt: string; appliedAt?: string }>;
  extensions: Array<{ id: string; status: 'pending_payment' | 'effective' | 'cancelled' | 'expired'; originalEndAt: string; newEndAt: string }>;
  truncated: { changes: boolean; extensions: boolean }; semantics: 'recorded_lifecycle_not_financial_or_action_eligibility';
}
export interface AiOrderSourceValueMapV2 {
  order: AiOrderCoveredEvidenceV2<OrderStatus['value']>;
  amounts: Omit<Amounts, 'source'> & { source: AiOrderEvidenceReferenceV2 };
  saved_basis: AiOrderCoveredEvidenceV2<AiOrderHistoryFactsV2>;
  payment_records: AiOrderCoveredEvidenceV2<AiOrderLocalPaymentsDraft>;
  rental_period: Omit<Fulfillment, 'source'> & { source: AiOrderEvidenceReferenceV2 };
  inspection_records: AiOrderCoveredEvidenceV2<AiOrderInspectionEvidenceV2>;
  funding_records: AiOrderCoveredEvidenceV2<AiOrderFundingFactsV2>;
  lifecycle_records: AiOrderCoveredEvidenceV2<AiOrderLifecycleFactsV2>;
}
export interface AiOrderDeterministicExplanationV2 {
  text: string; claims: Array<{ field: string; sourceId: string; value: string | number | boolean | null }>;
  generation: 'deterministic_authorized_facts'; modelProse: 'not_used'; executionAllowed: false;
}
type OrderProjectionV2 =
  | { question: 'status'; facts: { order: AiOrderSourceValueMapV2['order']; lifecycle: AiOrderOptionalEvidenceV2<AiOrderLifecycleFactsV2> } }
  | { question: 'next_steps'; facts: { order: AiOrderSourceValueMapV2['order'] } }
  | { question: 'fees'; facts: { order: AiOrderSourceValueMapV2['order']; amounts: AiOrderSourceValueMapV2['amounts'];
      fulfillment: AiOrderSourceValueMapV2['rental_period']; history: AiOrderOptionalEvidenceV2<AiOrderHistoryFactsV2>;
      inspections: AiOrderOptionalEvidenceV2<AiOrderInspectionEvidenceV2>; lifecycle: AiOrderOptionalEvidenceV2<AiOrderLifecycleFactsV2> } }
  | { question: 'payments'; facts: { order: AiOrderSourceValueMapV2['order']; amounts: AiOrderSourceValueMapV2['amounts'];
      payments: AiOrderOptionalEvidenceV2<AiOrderLocalPaymentsDraft>; actualReceivedTotal: { coverage: 'not_loaded' };
      fundingLedger: AiOrderOptionalEvidenceV2<AiOrderFundingFactsV2> } };
export interface AiOrderMaterialEnvelopeV2<P> {
  version: typeof AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION; scenario: 'order_explanation'; payload: P;
  payloadFingerprint: string; payloadBytes: number;
  trust: 'source_text_is_data_not_instructions'; authority: 'none_reauthorize_before_consumption';
}
export type AiOrderExplanationMaterialV2 = AiOrderMaterialEnvelopeV2<OrderProjectionV2 & {
  status: 'facts_only'; scope: AiWorkspaceScope; audience: ReadAudience; orderId: string; orderVersion: string; observedAt: string;
  consistency: 'revalidated_reads_not_atomic_snapshot';
  model: AiOrderExplanationMaterialDraft['payload']['model']; handoff: AiOrderExplanationMaterialDraft['payload']['handoff'];
  gaps: Array<{ field: 'history' | 'inspections' | 'payments' | 'actualReceivedTotal' | 'fundingLedger' | 'allowedActions' | 'lifecycle';
    status: 'partial' | 'not_loaded' | 'unavailable' }>;
  explanation: AiOrderDeterministicExplanationV2;
}>;
export interface AiOrderSourceReopenRequestV2 extends Omit<AiOrderEvidenceReferenceV2, 'observedAt'> {
  materialVersion: typeof AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION; question: 'status' | 'fees' | 'payments' | 'next_steps';
}
type SourceReadCommonV2 = { materialVersion: typeof AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION;
  scope: AiWorkspaceScope; orderId: string; field: AiOrderEvidenceFieldV2 };
export type AiOrderSourceReadV2 =
  | (SourceReadCommonV2 & { status: 'stale'; reason: 'order_version_changed_reread_material' })
  | (SourceReadCommonV2 & { status: 'missing'; reason: 'historical_or_optional_source_not_loaded' })
  | { [K in AiOrderEvidenceFieldV2]: SourceReadCommonV2 & { status: 'available'; field: K; value: AiOrderSourceValueMapV2[K];
      observedAt: string; freshness: 'current_observation_not_frozen_material';
      reauthorization: 'current_order_authority_rechecked'; execution: 'not_attempted' } }[AiOrderEvidenceFieldV2];

const calendarText = z.string().min(1).max(191).refine(value => value.trim().length > 0);
const calendarTime = z.string().max(40).datetime({ offset: true });
const calendarYear = z.number().int().min(1).max(9999);
const calendarBinding = z.object({ id: calendarText, year: calendarYear, version: calendarText,
  status: z.literal('published'), revision: z.number().int().min(0).max(2147483647), publishedAt: calendarTime,
  officialSource: z.object({ versionId: calendarText.nullable(), version: calendarText.nullable(),
    publishedAt: calendarTime.nullable(), importedAt: calendarTime.nullable() }).strict() }).strict();
/** Original bounded Core calendar metadata. Null references stay null; an
 * adopted version is not an editable target or an official-registry check. */
export const aiOpeningCalendarSourceDraft = z.object({ version: z.literal('rental-calendar-read-source-1'),
  tenantId: calendarText, workspaceId: calendarText,
  years: z.array(z.discriminatedUnion('status', [
    z.object({ year: calendarYear, status: z.literal('adopted'), binding: calendarBinding }).strict(),
    z.object({ year: calendarYear, status: z.literal('not_adopted'), binding: z.null() }).strict()
  ])).min(1).max(3), sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  observations: z.object({ startedAt: calendarTime, completedAt: calendarTime,
    consistency: z.enum(['caller_transaction_reads', 'independent_persisted_reads']) }).strict()
}).strict().superRefine((value, context) => {
  const startedAt = Date.parse(value.observations.startedAt);
  if (Date.parse(value.observations.completedAt) < startedAt || new Set(value.years.map(row => row.year)).size !== value.years.length
    || value.years.some(row => row.status === 'adopted' && (row.binding.year !== row.year
      || [row.binding.publishedAt, row.binding.officialSource.publishedAt, row.binding.officialSource.importedAt]
        .some(at => at !== null && Date.parse(at) > startedAt)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'AI_RESOURCE_UNAVAILABLE' });
  }
});
export type AiOpeningCalendarSourceDraft = z.infer<typeof aiOpeningCalendarSourceDraft>;
/** Source identity and business dates remain binding; query clock changes do
 * not invalidate the same version. Preserve the original consistency claim. */
export function aiOpeningCalendarSourceBasis(value: AiOpeningCalendarSourceDraft) {
  const { observations, ...facts } = value;
  return { ...facts, observations: { consistency: observations.consistency } };
}

interface ConfigurationSource { scope: AiWorkspaceScope; resourceType: 'business_configuration'; version: string; observedAt: string }
export interface AiOpeningSectionMaterialDraft { key: string; title: string; required: boolean;
  status: 'source_unavailable' | 'readiness_check_passed' | 'missing_configuration' | 'readiness_unsatisfied' | 'unclassified';
  /** Original bounded Core text, never parsed to attest a rule/calendar revision. */
  summary?: string;
  issue?: string; impact: 'optional_configuration' | 'required_readiness_item';
  evidence: { scope: AiWorkspaceScope; resourceType: 'readiness_item'; resourceId: string; version: string; observedAt: string };
  manual: { kind: 'configuration_section'; section: string; scope: AiWorkspaceScope; navigation: 'host_existing_section' } | { status: 'unavailable' };
  candidate: { status: 'candidate_only'; currentVersion: string; fieldsToReview: string[]; proposedChanges: [];
    persistence: 'unavailable_no_formal_draft_port' };
  externalVerification: 'not_loaded'; unresolvedClassification: Array<'missing_configuration' | 'configured_unverified' | 'formal_check_failed'
    | 'not_implemented' | 'external_credentials_pending' | 'owner_decision_pending'>;
}
export interface AiOpeningBusinessMaterialDraft { scope: AiWorkspaceScope; audience: ReadAudience; configVersion: string; observedAt: string;
  integrationObservation?: import('./ai-opening-integration-observation').AiOpeningIntegrationFactsDraft;
  /** Optional for legacy materials and omitted outside the selected calendar partition. */
  calendarSource?: AiOpeningCalendarSourceDraft;
  sections: AiOpeningSectionMaterialDraft[];
  configuration: {
    products?: { source: ConfigurationSource; rows: Array<{ id: string; code: string; status: 'enabled' | 'disabled'; inventoryMode: RentalInventoryMode; unit: string }>; truncated: boolean };
    pricing?: { source: ConfigurationSource; currency: string; enabledUnits: Unit[]; groups: Array<{ id: string; code: string;
      status: 'enabled' | 'disabled'; version: number }>; truncated: boolean; rates: 'not_projected' };
    fulfillment?: { source: ConfigurationSource; enabledModes: Mode[]; locations: Array<{ id: string; code: string; status: 'enabled' | 'disabled';
      capabilities: RentalFulfillmentLocation['capabilities'] }>; truncated: boolean };
    inventory?: { source: ConfigurationSource; coverage: 'not_loaded'; meaning: 'item_modes_are_not_stock_balances' };
  };
  atomicity: 'independent_sections_not_a_transaction'; externalVerification: 'not_loaded';
}
type WithoutUnified<T> = T extends unknown ? Omit<T, 'next' | 'authority' | 'sideEffects'> : never;
export type AiQuoteBusinessFactsDraft = WithoutUnified<AiSceneQuotePreparationDraft>;
export type AiQuoteBusinessMaterialDraft = AiSealedBusinessMaterialDraft<'quote_clarification', {
  scope: AiWorkspaceScope; audience: ReadAudience; observedAt: string; facts: AiQuoteBusinessFactsDraft;
  model: { status: 'not_requested' | 'unavailable'; answer: 'not_generated' }; gaps: string[]; execution: 'not_attempted';
}>;
interface SceneTaskMaterial<S extends AiSceneRequestReceiptDraft['sceneCode'], M> {
  original: Omit<AiSceneRequestReceiptDraft, 'sceneCode'> & { sceneCode: S }; material: M; materialHash: string;
  trust: 'source_text_is_data_not_instructions'; task: AiSceneTaskReceiptDraft; model: 'not_called'; plan: 'requires_host_plan_start';
}
export type AiSceneTaskMaterialResponseDraft =
  | SceneTaskMaterial<'order_explanation', AiOrderExplanationMaterialDraft>
  | SceneTaskMaterial<'opening_diagnosis', AiOpeningBusinessMaterialDraft>
  | SceneTaskMaterial<'quote_clarification', AiQuoteBusinessMaterialDraft>;
/** New public preparation wrapper only, never an original v1 model receipt. */
export type AiOrderSceneTaskMaterialV2 = SceneTaskMaterial<'order_explanation', AiOrderExplanationMaterialV2>;
