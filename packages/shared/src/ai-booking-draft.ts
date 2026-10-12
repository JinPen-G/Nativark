import type { RentalFulfillmentMode } from './core';
import type { AiCustomerEntryScope, AiCustomerEntrySurface, AiEntryActionDraft } from './ai-entry-action-draft';

export const AI_BOOKING_DRAFT_CONTRACT_VERSION = 'ain-booking-draft-1' as const;
export const AI_BOOKING_DRAFT_STATES = ['draft_created', 'user_selected', 'handed_to_booking_page', 'submitted', 'stale', 'expired', 'abandoned'] as const;
export type AiBookingDraftState = (typeof AI_BOOKING_DRAFT_STATES)[number];
export const AI_BOOKING_INPUT_SOURCES = ['user_explicit', 'server_default', 'core_normalized', 'authorized_fact', 'model_candidate'] as const;
export type AiBookingInputSource = (typeof AI_BOOKING_INPUT_SOURCES)[number];

export interface AiBookingSelection {
  quoteId: string;
  timeZone: string;
  startAt: string;
  endAt: string;
  fulfillmentMode: RentalFulfillmentMode;
  fulfillmentLocationId: string;
  returnLocationId?: string;
  deliveryAddressId?: string;
  bookingIdentity: { bookingIdentity: 'personal' | 'enterprise_employee'; corporateCustomerId?: string; enterpriseContractAndPayer: boolean };
  lines: Array<{ itemGroupId: string; quantity: number }>;
  services?: Array<{ serviceId: string; quantity: number; scheduledStartAt?: string; scheduledEndAt?: string; serviceLocationId?: string }>;
}

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

export interface AiBookingAddressEvidence {
  addressId: string;
  observedRevision: number;
  observedUpdatedAt: string;
  quoteAddressRevision: null;
  snapshotFingerprint: string;
  serviceAreaFingerprint: string;
  source: 'current_client_saved_address';
}

export interface AiBookingMaterial {
  selection: AiBookingSelection;
  sources: Record<Exclude<keyof AiBookingSelection, 'deliveryAddressId'>, AiBookingInputSource> & { deliveryAddressId?: AiBookingInputSource };
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
  execution: 'not_submitted';
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
