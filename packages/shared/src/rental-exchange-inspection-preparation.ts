/** Persistent pre-execution inspection preparation; no customer consent,
 * enterprise spending authorization, inventory reservation or exchange execution. */
import type { RentalInspectionTemplate, RentalOrderExchangeExecutionBasis, RentalOrderExchangeDisposition, RentalOrderExchangePriceBasis } from "./core";
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
  media: "unavailable";
  reservation: "not_reserved";
}
export interface RentalExchangeInspectionResult {
  side: RentalExchangeInspectionTemplateRequirement["side"];
  templateId: string;
  templateVersion: string;
  results: Record<string, string | number | boolean>;
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
}
export type RentalExchangeInspectionPreparationOriginal =
  | { state: "not_recorded"; retryable: false }
  | { state: "observed"; preparation: RentalExchangeInspectionPreparation; retryable: false };

/** A dedicated source is not yet an accepted preparation result or customer consent. */
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
