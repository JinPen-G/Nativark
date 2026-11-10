/** Runtime counterparts of the existing public Booking projections. Current
 * scope, quote freshness, choice and execution still belong to server guards. */
import { z } from 'zod';
import { AI_BOOKING_DRAFT_CONTRACT_VERSION, AI_BOOKING_DRAFT_STATES, AI_BOOKING_INPUT_SOURCES,
  aiBookingSelectionSchema, type AiBookingDraft, type AiBookingHandoff, type AiBookingOperationReadResponse } from './ai-booking-draft';
import { AI_CUSTOMER_ENTRY_SURFACES, aiEntryActionSchema } from './ai-entry-action-draft';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), date = z.string().datetime({ offset: true });
const sourceVersion = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)*$/u);
const source = z.enum(AI_BOOKING_INPUT_SOURCES), amount = z.number().finite().nonnegative();
const scope = z.object({ kind: z.literal('workspace'), tenantId: id, workspaceId: id }).strict();
const material = z.object({ selection: aiBookingSelectionSchema,
  sources: z.object({ quoteId: source, timeZone: source, startAt: source, endAt: source,
    fulfillmentMode: source, fulfillmentLocationId: source, returnLocationId: source, bookingIdentity: source,
    lines: source, services: source, deliveryAddressId: source.optional(), deliveryAddressConfirmation: source.optional() }).strict(),
  deliveryAddress: z.discriminatedUnion('source', [
    z.object({ source: z.literal('current_client_saved_address'), addressId: id, observedRevision: z.number().int().min(1),
      observedUpdatedAt: date, quoteAddressRevision: z.null(), snapshotFingerprint: hash, serviceAreaFingerprint: hash }).strict(),
    z.object({ source: z.literal('original_quote_one_time_address'), quoteId: id, quoteCreatedAt: date, quoteExpiresAt: date,
      snapshotFingerprint: hash, serviceAreaFingerprint: hash }).strict()
  ]).optional(),
  quote: z.object({ quoteId: id, quoteVersion: hash, pricingPlanVersion: id, ruleVersion: id,
    priceVersionId: id.nullable(), calendarVersion: id.nullable(), categoryVersionId: id.nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/u), payableAmount: amount, depositAmount: amount, preAuthAmount: amount,
    chargeLines: z.array(z.object({ type: id, amount: z.number().finite(), sourceId: id.nullable(),
      sourceVersion: sourceVersion.nullable() }).strict()).max(100), expiresAt: date, createdAt: date }).strict(),
  catalogVersion: hash, availabilityVersion: hash, identityVersion: hash,
  availability: z.literal('available_at_observation_not_reserved') }).strict();
export const aiBookingDraftSchema: z.ZodType<AiBookingDraft> = z.object({
  contractVersion: z.literal(AI_BOOKING_DRAFT_CONTRACT_VERSION), bookingDraftId: z.string().uuid(),
  audience: z.literal('customer'), surface: z.enum(AI_CUSTOMER_ENTRY_SURFACES), scope,
  state: z.enum(AI_BOOKING_DRAFT_STATES), revision: z.number().int().min(1), selectionRevision: z.number().int().min(0).max(1),
  inputFingerprint: hash, materialRef: z.string().uuid(), material, createdAt: date, expiresAt: date,
  execution: z.enum(['not_submitted', 'submitted_request_not_business_success']), action: aiEntryActionSchema.nullable()
}).strict().superRefine((value, context) => {
  if (value.state === 'submitted' ? value.selectionRevision !== 1 || value.execution !== 'submitted_request_not_business_success'
    || value.action !== null : value.execution !== 'not_submitted')
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent original Booking state' });
});
export const aiBookingHandoffSchema: z.ZodType<AiBookingHandoff> = z.object({
  contractVersion: z.literal(AI_BOOKING_DRAFT_CONTRACT_VERSION), handoffRef: z.string().uuid(), bookingDraftId: z.string().uuid(),
  revision: z.number().int().min(1), audience: z.literal('customer'), surface: z.enum(AI_CUSTOMER_ENTRY_SURFACES), scope,
  expiresAt: date, fields: aiBookingSelectionSchema, actionCode: z.literal('OPEN_BOOKING'),
  submission: z.literal('original_booking_page_required'), inventory: z.literal('not_reserved')
}).strict();
export const aiBookingCreateResponseSchema = z.object({ draft: aiBookingDraftSchema, operation: id, replayed: z.boolean() }).strict();
export const aiBookingChoiceResponseSchema = z.union([
  z.object({ draft: aiBookingDraftSchema, replayed: z.boolean() }).strict(),
  z.object({ bookingDraftId: z.string().uuid(), state: z.literal('abandoned'), revision: z.number().int().min(1).max(4294967295),
    replayed: z.boolean() }).strict()
]);
export const aiBookingHandoffResponseSchema = z.object({ handoff: aiBookingHandoffSchema, replayed: z.boolean() }).strict();
export const aiBookingOperationReadResponseSchema: z.ZodType<AiBookingOperationReadResponse> = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unknown'), operationKey: id, retryable: z.literal(false), nextAction: z.literal('read_booking_operation') }).strict(),
  z.object({ state: z.literal('observed'), operationKey: id, bookingDraftId: z.string().uuid(), kind: z.enum(['create', 'select', 'handoff', 'abandon']),
    resultRevision: z.number().int().min(1).max(4294967295), handoffRef: z.string().uuid().nullable(),
    businessSubmission: z.literal('not_attested'), retryable: z.literal(false) }).strict()
]);
