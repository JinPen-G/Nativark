import { z } from 'zod';
import { RENTAL_FULFILLMENT_MODES, type RentalFulfillmentMode } from './core';
import type { AiCustomerEntryScope, AiCustomerEntrySurface, AiEntryActionDraft } from './ai-entry-action-draft';

export const AI_BOOKING_DRAFT_CONTRACT_VERSION = 'ain-booking-draft-1' as const;
export const AI_BOOKING_DRAFT_STATES = ['draft_created', 'user_selected', 'handed_to_booking_page', 'submitted', 'stale', 'expired', 'abandoned'] as const;
export type AiBookingDraftState = (typeof AI_BOOKING_DRAFT_STATES)[number];
export const AI_BOOKING_INPUT_SOURCES = ['user_explicit', 'server_default', 'core_normalized', 'authorized_fact', 'model_candidate'] as const;
export type AiBookingInputSource = (typeof AI_BOOKING_INPUT_SOURCES)[number];

/** Explicit original-page choice only; never carries address text or grants submission. */
export interface AiBookingOneTimeAddressConfirmation {
  source: 'original_quote_one_time_address';
  snapshotFingerprint: string;
  confirmed: true;
}

export interface AiBookingSelection {
  quoteId: string;
  timeZone: string;
  startAt: string;
  endAt: string;
  fulfillmentMode: RentalFulfillmentMode;
  fulfillmentLocationId: string;
  returnLocationId?: string;
  deliveryAddressId?: string;
  deliveryAddressConfirmation?: AiBookingOneTimeAddressConfirmation;
  bookingIdentity: { bookingIdentity: 'personal' | 'enterprise_employee'; corporateCustomerId?: string; enterpriseContractAndPayer: boolean };
  lines: Array<{ itemGroupId: string; quantity: number }>;
  services?: Array<{ serviceId: string; quantity: number; scheduledStartAt?: string; scheduledEndAt?: string; serviceLocationId?: string }>;
}

/** Same closed human-selection contract used by the original server reader.
 * Current quote, catalog, identity and availability checks remain server-side. */
const selectionId = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const selectionDate = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
export const aiBookingSelectionSchema: z.ZodType<AiBookingSelection> = z.object({
  quoteId: selectionId, timeZone: z.string().min(1).max(100), startAt: selectionDate, endAt: selectionDate,
  fulfillmentMode: z.enum(RENTAL_FULFILLMENT_MODES), fulfillmentLocationId: selectionId, returnLocationId: selectionId.optional(),
  deliveryAddressId: selectionId.optional(), deliveryAddressConfirmation: z.object({
    source: z.literal('original_quote_one_time_address'), snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/u), confirmed: z.literal(true)
  }).strict().optional(),
  bookingIdentity: z.object({ bookingIdentity: z.enum(['personal', 'enterprise_employee']), corporateCustomerId: selectionId.optional(),
    enterpriseContractAndPayer: z.boolean() }).strict(),
  lines: z.array(z.object({ itemGroupId: selectionId, quantity: z.number().int().min(1).max(999) }).strict()).min(1).max(20),
  services: z.array(z.object({ serviceId: selectionId, quantity: z.number().int().min(1).max(999),
    scheduledStartAt: selectionDate.optional(), scheduledEndAt: selectionDate.optional(), serviceLocationId: selectionId.optional()
  }).strict()).max(20).optional()
}).strict().superRefine((value, context) => {
  if (Date.parse(value.endAt) <= Date.parse(value.startAt) || new Set(value.lines.map(line => line.itemGroupId)).size !== value.lines.length
    || (value.bookingIdentity.bookingIdentity === 'enterprise_employee') !== Boolean(value.bookingIdentity.corporateCustomerId)
    || (value.bookingIdentity.bookingIdentity === 'personal' && value.bookingIdentity.enterpriseContractAndPayer)
    || Boolean(value.deliveryAddressId && value.deliveryAddressConfirmation))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Explicit booking conditions required' });
});

export interface AiBookingQuoteFacts {
  quoteId: string;
  quoteVersion: string;
  pricingPlanVersion: string;
  ruleVersion: string;
  priceVersionId: string | null;
  calendarVersion: string | null;
  categoryVersionId: string | null;
  currency: string;
  payableAmount: number;
  depositAmount: number;
  preAuthAmount: number;
  chargeLines: Array<{ type: string; amount: number; sourceId: string | null; sourceVersion: string | null }>;
  expiresAt: string;
  createdAt: string;
}

export interface AiBookingSavedAddressEvidence {
  addressId: string;
  observedRevision: number;
  observedUpdatedAt: string;
  quoteAddressRevision: null;
  snapshotFingerprint: string;
  serviceAreaFingerprint: string;
  source: 'current_client_saved_address';
}

/** Original Core quote snapshot plus current service-area observation. No saved
 * address ID/revision or contact/address content is fabricated or returned. */
export interface AiBookingOneTimeAddressEvidence {
  source: 'original_quote_one_time_address';
  quoteId: string;
  quoteCreatedAt: string;
  quoteExpiresAt: string;
  snapshotFingerprint: string;
  serviceAreaFingerprint: string;
}

export type AiBookingAddressEvidence = AiBookingSavedAddressEvidence | AiBookingOneTimeAddressEvidence;

export interface AiBookingMaterial {
  selection: AiBookingSelection;
  sources: Record<Exclude<keyof AiBookingSelection, 'deliveryAddressId' | 'deliveryAddressConfirmation'>, AiBookingInputSource>
    & { deliveryAddressId?: AiBookingInputSource; deliveryAddressConfirmation?: AiBookingInputSource };
  deliveryAddress?: AiBookingAddressEvidence;
  quote: AiBookingQuoteFacts;
  catalogVersion: string;
  availabilityVersion: string;
  identityVersion: string;
  availability: 'available_at_observation_not_reserved';
}

export interface AiBookingDraft {
  contractVersion: typeof AI_BOOKING_DRAFT_CONTRACT_VERSION;
  bookingDraftId: string;
  audience: 'customer';
  surface: AiCustomerEntrySurface;
  scope: AiCustomerEntryScope;
  state: AiBookingDraftState;
  revision: number;
  selectionRevision: number;
  inputFingerprint: string;
  materialRef: string;
  material: AiBookingMaterial;
  createdAt: string;
  expiresAt: string;
  /** Submitted attests page request acceptance only; business results use the
   * independent original receipt. A submitted Draft never carries an Action. */
  execution: 'not_submitted' | 'submitted_request_not_business_success';
  action: AiEntryActionDraft | null;
}

export interface AiBookingHandoff {
  contractVersion: typeof AI_BOOKING_DRAFT_CONTRACT_VERSION;
  handoffRef: string;
  bookingDraftId: string;
  revision: number;
  audience: 'customer';
  surface: AiCustomerEntrySurface;
  scope: AiCustomerEntryScope;
  expiresAt: string;
  fields: AiBookingSelection;
  actionCode: 'OPEN_BOOKING';
  submission: 'original_booking_page_required';
  inventory: 'not_reserved';
}

/** Original booking page acceptance, not approval or proof of business execution. */
export interface AiBookingSubmissionAcceptance {
  acceptanceRef: string;
  handoffRef: string;
  bookingDraftId: string;
  selectionRevision: number;
  inputFingerprint: string;
  quoteId: string;
  operationKey: string;
  execution: 'not_attested';
}

export const AI_BOOKING_ACCEPTANCE_READ_VERSION = 'ain-booking-acceptance-read-1' as const;
export type AiBookingAcceptanceReadRequest = { handoffRef: string; contactPhone?: string };
export type AiBookingAcceptanceReadResponse = {
  contractVersion: typeof AI_BOOKING_ACCEPTANCE_READ_VERSION;
  handoffRef: string;
  operationKey: string;
  currentUse: 'not_authorized_by_receipt';
  execution: 'not_attested';
  retryable: false;
} & ({ state: 'observed'; acceptance: AiBookingSubmissionAcceptance; nextAction: 'read_original_submission' }
  | { state: 'unknown'; acceptance: null; nextAction: 'read_original_acceptance' });

export interface AiBookingSubmissionDecision {
  acceptanceRef: string;
  decision: 'submit_original_booking';
}

/** Only the original Core receipt may attest observed order creation. */
export type AiBookingSubmissionReceipt = {
  operationKey: string;
  retryable: false;
  payment: 'not_inferred';
  fulfillment: 'not_inferred';
} & ({ state: 'observed'; orderId: string } | { state: 'unknown' | 'not_observed'; orderId: null });

/** Original Draft operation receipt. Its result revision is historical and
 * never becomes a current Action or a business submission attestation. */
export type AiBookingOperationReadResponse =
  | { state: 'unknown'; operationKey: string; retryable: false; nextAction: 'read_booking_operation' }
  | { state: 'observed'; operationKey: string; bookingDraftId: string; kind: 'create' | 'select' | 'handoff' | 'abandon';
      resultRevision: number; handoffRef: string | null; businessSubmission: 'not_attested'; retryable: false };

export const AI_BOOKING_OPERATION_OBSERVATION_VERSION = 'ain-booking-operation-observation-1' as const;
/** Current minimal metadata beside the unchanged original receipt. No material,
 * Action or authorization is returned; elapsed expiry does not rewrite state. */
export interface AiBookingOperationObservationDraft {
  contractVersion: typeof AI_BOOKING_OPERATION_OBSERVATION_VERSION;
  operation: AiBookingOperationReadResponse;
  currentDraft: { state: AiBookingDraftState; revision: number; selectionRevision: number;
    expiresAt: string; expiredAtObservation: boolean } | null;
  observedAt: string;
  currentUse: 'not_authorized_by_receipt';
}
