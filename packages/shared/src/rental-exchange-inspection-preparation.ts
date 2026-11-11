/** Persistent pre-execution inspection preparation; no customer consent,
 * enterprise spending authorization, inventory reservation or exchange execution. */
import type { RentalInspectionTemplate, RentalOrderChangePreview, RentalOrderExchangeExecutionBasis,
  RentalOrderExchangeDisposition, RentalOrderExchangePriceBasis } from "./core";
export interface RentalExchangeInspectionIntent {
  orderLineId: string;
  allocationId: string;
  replacementItemGroupId: string;
  replacementAssetId?: string;
  replacementPricingGroupId?: string;
  priceBasis: RentalOrderExchangePriceBasis;
  originalDisposition: RentalOrderExchangeDisposition;
}
export interface RentalExchangeInspectionRequirementsRequest {
  expectedOrderUpdatedAt: string;
  exchange: RentalExchangeInspectionIntent;
}
export interface RentalExchangeInspectionTemplateRequirement {
  side: "original_return" | "replacement_pickup";
  template: RentalInspectionTemplate;
}
export interface RentalExchangeInspectionRequirements extends RentalExchangeInspectionRequirementsRequest {
  orderId: string;
  workspaceId: string;
  requirementsHash: string;
  templates: RentalExchangeInspectionTemplateRequirement[];
  executionBasis: RentalOrderExchangeExecutionBasis;
  media: "unavailable" | "dedicated_source_only" | "dedicated_source_verified";
  reservation: "not_reserved";
}
export interface RentalExchangeInspectionResult {
  side: RentalExchangeInspectionTemplateRequirement["side"];
  templateId: string;
  templateVersion: string;
  results: Record<string, string | number | boolean>;
  /** Photo values are file IDs. The server accepts only these original sources;
   * a file ID or a completed upload flag by itself is insufficient. */
  photoSources?: RentalExchangeInspectionPhotoReference[];
}
export interface RentalExchangeInspectionPhotoReference {
  fieldCode: string;
  sourceId: string;
  operationKey: string;
  fileAssetId: string;
}
export interface RentalExchangeInspectionAcceptedMedia extends RentalExchangeInspectionPhotoReference {
  side: RentalExchangeInspectionTemplateRequirement["side"];
  templateId: string;
  templateVersion: string;
  contentHash: string;
  completionHash: string;
}
export interface PrepareRentalExchangeInspectionRequest extends RentalExchangeInspectionRequirementsRequest {
  operationKey: string;
  expectedRevision: 0;
  reason: string;
  requirementsHash: string;
  inspections: RentalExchangeInspectionResult[];
  exceptions?: Array<{ code: string; description: string; allocationId: string }>;
}
export interface RentalExchangeInspectionPreparation extends RentalExchangeInspectionRequirements {
  id: string;
  actorUserId: string;
  operationKey: string;
  requestHash: string;
  revision: 1;
  state: "prepared";
  reason: string;
  createdAt: string;
  inspections: RentalExchangeInspectionResult[];
  exceptions: NonNullable<PrepareRentalExchangeInspectionRequest["exceptions"]>;
  customerConsent: "not_connected";
  execution: "not_connected";
  /** Immutable evidence accepted with this preparation, before any consent or
   * fulfillment. Absent on legacy preparations that accepted no photo source. */
  acceptedMedia?: RentalExchangeInspectionAcceptedMedia[];
}
export type RentalExchangeInspectionPreparationOriginal =
  | { state: "not_recorded"; retryable: false }
  | { state: "observed"; preparation: RentalExchangeInspectionPreparation; retryable: false };

/** A dedicated source alone is not an accepted preparation or customer consent.
 * Its initial declaration stays immutable; acceptedMedia records its actual use. */
export const RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE = "exchange-inspection-evidence";
export interface RentalExchangeInspectionMediaRequirements extends Omit<RentalExchangeInspectionRequirements, "media"> {
  media: "dedicated_source_only";
}
export interface CreateRentalExchangeInspectionMediaRequest extends RentalExchangeInspectionRequirementsRequest {
  operationKey: string;
  requirementsHash: string;
  side: RentalExchangeInspectionTemplateRequirement["side"];
  templateId: string;
  templateVersion: string;
  fieldCode: string;
  fileName: string;
  mimeType: "image/jpeg" | "image/png";
  sizeBytes: number;
}
export interface RentalExchangeInspectionMediaSource extends CreateRentalExchangeInspectionMediaRequest {
  id: string;
  orderId: string;
  workspaceId: string;
  actorUserId: string;
  requestHash: string;
  sessionId: string;
  fileAssetId: string;
  createdAt: string;
  expiresAt: string;
  /** A claimed completion remains unknown until its original evidence commits.
   * Expiry, cancellation or failure never authorizes another upload or byte read. */
  state: "pending_upload" | "completion_unknown" | "completed";
  completion?: { contentHash: string; sizeBytes: number; mimeType: "image/jpeg" | "image/png"; width: number; height: number; completedAt: string };
  preparationUse: "not_connected";
  retryable: false;
}
export type RentalExchangeInspectionMediaOriginal =
  | { state: "not_recorded"; retryable: false }
  | { state: "observed"; source: RentalExchangeInspectionMediaSource; retryable: false };
export interface RentalExchangeInspectionMediaTicket {
  source: RentalExchangeInspectionMediaSource;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
}
export type CreateRentalExchangeInspectionMediaResult = RentalExchangeInspectionMediaOriginal | RentalExchangeInspectionMediaTicket;

/** Safe material for the original using customer. No full pricing/configuration
 * body, operator reason, storage key, provider ticket or enterprise grant. */
export interface RentalExchangeInspectionCustomerMaterial {
  orderId: string;
  workspaceId: string;
  customerId: string;
  preparationId: string;
  preparationHash: string;
  expectedOrderUpdatedAt: string;
  exchange: RentalExchangeInspectionIntent;
  templates: Array<{ side: RentalExchangeInspectionTemplateRequirement["side"]; templateId: string; templateVersion: string; name: string;
    fields: Array<{ code: string; label: string; type: "boolean" | "number" | "text" | "select" | "photo"; required: boolean; unit?: string; options?: string[] }> }>;
  inspections: Array<Omit<RentalExchangeInspectionResult, "photoSources">>;
  exceptions: Array<{ code: string; description: string; allocationId: string }>;
  photos: Array<{ side: RentalExchangeInspectionTemplateRequirement["side"]; templateId: string; fieldCode: string; fileAssetId: string; contentHash: string }>;
  materialHash: string;
}
export interface ConfirmRentalExchangeInspectionRequest {
  operationKey: string;
  expectedRevision: 0;
  preparationId: string;
  preparationHash: string;
  materialHash: string;
  expectedOrderUpdatedAt: string;
  confirm: true;
}
export interface RentalExchangeInspectionConsent {
  id: string;
  orderId: string;
  workspaceId: string;
  customerId: string;
  preparationId: string;
  preparationHash: string;
  materialHash: string;
  expectedOrderUpdatedAt: string;
  operationKey: string;
  requestHash: string;
  confirmedAt: string;
  revision: 1;
  state: "confirmed";
  scope: "specific_exchange_inspection_and_handover";
  retryable: false;
}
export type RentalExchangeInspectionConsentOriginal =
  | { state: "not_recorded"; retryable: false }
  | { state: "observed"; consent: RentalExchangeInspectionConsent; retryable: false };

/** The merchant explicitly executes this exact approved change. Expense and
 * inspection keys remain independent; none of these references self-authorize. */
export interface ExecuteApprovedRentalExchangeRequest {
  operationKey: string;
  approvalId: string;
  expectedApprovalRevision: number;
  expectedOrderUpdatedAt: string;
  preparationId: string;
  preparationHash: string;
  consentId: string;
  consentOperationKey: string;
  reason: string;
  confirm: true;
}
export interface RentalApprovedExchangeReceipt {
  orderId: string;
  workspaceId: string;
  changeId: string;
  approvalId: string;
  preparationId: string;
  preparationHash: string;
  consentId: string;
  consentOperationKey: string;
  consentHash: string;
  actorUserId: string;
  operationKey: string;
  coreIdempotencyKey: string;
  requestHash: string;
  changeHash: string;
  appliedAt: string;
  state: "applied";
  retryable: false;
}
export type RentalApprovedExchangeOriginal =
  | { state: "not_recorded"; retryable: false }
  | { state: "observed"; receipt: RentalApprovedExchangeReceipt; retryable: false };

/** Comparison only: never feed this projection into pricing or fulfillment.
 * The current cut point and generated query text may move while authoritative
 * amounts/units, calendar days/multipliers, source versions and rules stay equal.
 * Original previousSegments, source periods and split bases remain untouched. */
export function rentalExchangeExecutionBasisComparable(basis: RentalOrderExchangeExecutionBasis) {
  const point = basis.effectiveFrom;
  const calendar = (rows: RentalOrderExchangeExecutionBasis["calendarSnapshot"]) => rows.map(row => ({ ...row, priceAt: undefined }));
  const pricing = (snapshot: RentalOrderExchangeExecutionBasis["pricingSnapshot"]) => snapshot && ({ ...snapshot,
    fullChargeLines: snapshot.fullChargeLines?.map(row => ({ ...row, detail: undefined })),
    chargeLines: snapshot.chargeLines?.map(row => ({ ...row, detail: undefined })) });
  const segment = (row: NonNullable<RentalOrderExchangeExecutionBasis["linePricing"]>["segments"][number]) => ({ ...row,
    startAt: row.startAt === point ? undefined : row.startAt, endAt: row.endAt === point ? undefined : row.endAt,
    calendarSnapshot: calendar(row.calendarSnapshot) });
  return { ...basis, effectiveFrom: undefined, calendarSnapshot: calendar(basis.calendarSnapshot), pricingSnapshot: pricing(basis.pricingSnapshot),
    linePricing: basis.linePricing && { ...basis.linePricing, segments: basis.linePricing.segments.map(segment),
      overdueBasis: basis.linePricing.overdueBasis && segment(basis.linePricing.overdueBasis) } };
}

/** Same comparison contract for enterprise requests and final Core admission.
 * It grants no price guarantee, consent, spending permission or execution. */
export function rentalExchangePreviewComparable(preview: RentalOrderChangePreview) {
  const basis = preview.exchange?.executionBasis;
  const snapshot = preview.pricingSnapshot;
  return { ...preview, pricingSnapshot: snapshot && { ...snapshot,
    fullChargeLines: snapshot.fullChargeLines?.map(row => ({ ...row, detail: undefined })),
    chargeLines: snapshot.chargeLines?.map(row => ({ ...row, detail: undefined })) },
    exchange: preview.exchange && { ...preview.exchange, executionBasis: basis && rentalExchangeExecutionBasisComparable(basis) } };
}
