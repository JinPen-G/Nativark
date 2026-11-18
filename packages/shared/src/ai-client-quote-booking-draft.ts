/** Original human quote -> original booking material and Action. These
 * transport observations grant no order approval or inventory reservation. */
import { z } from 'zod';
import { aiBookingSelectionSchema } from './ai-booking-draft';
import { aiEntryActionSchema } from './ai-entry-action-draft';
import { aiClientQuoteConfirmationRequestSchema } from './ai-client-quote-draft';

export const AI_CLIENT_QUOTE_BOOKING_VERSION = 'ain-client-quote-booking-1' as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), date = z.string().datetime({ offset: true });
const source = z.object({ materialRef: z.string().uuid(), materialHash: hash }).strict();
const material = z.object({ materialRef: z.string().uuid(), materialHash: hash, inputHash: hash, expiresAt: date }).strict();
export const aiClientQuoteBookingRequestSchema = z.object({ original: aiClientQuoteConfirmationRequestSchema,
  selection: aiBookingSelectionSchema, operationKey: id }).strict();
const serviceFields = ['scheduledStartAt', 'scheduledEndAt', 'serviceLocationId'] as const;
const legacyShape = z.object({ returnLocation: z.boolean(), serviceFields: z.array(z.array(z.enum(serviceFields)).max(3)).max(20).nullable() }).strict();
export const aiClientBookingReadRefSchema = z.object({ original: aiClientQuoteConfirmationRequestSchema, operationKey: id,
  selectionHash: hash, legacyShape: legacyShape.optional() }).strict();
export const aiClientBookingReadRequestSchema = z.union([aiClientBookingReadRefSchema, aiClientQuoteBookingRequestSchema]);
export type AiClientBookingReadRef = z.infer<typeof aiClientBookingReadRefSchema>;
export function clientBookingLegacyShape(selection: AiClientQuoteBookingRequest['selection']): z.infer<typeof legacyShape> {
  return { returnLocation: selection.returnLocationId !== undefined,
    serviceFields: selection.services?.map(service => serviceFields.filter(field => service[field] !== undefined)) ?? null };
}
export function originalLegacyBookingSelection(stored: AiClientQuoteBookingRequest['selection'], shape: z.infer<typeof legacyShape>) {
  const selection = aiBookingSelectionSchema.parse(stored);
  if (!shape.returnLocation) delete selection.returnLocationId;
  if ((shape.serviceFields?.length ?? 0) !== (selection.services?.length ?? 0)) return null;
  if (shape.serviceFields === null) delete selection.services;
  else {
    const masks = shape.serviceFields;
    selection.services = (selection.services ?? []).map((service, index) => {
      for (const field of serviceFields) if (!masks[index].includes(field)) delete service[field];
      return service;
    });
  }
  return selection;
}
const preparation = { contractVersion: z.literal(AI_CLIENT_QUOTE_BOOKING_VERSION), operationKey: id, source,
  draft: z.literal('not_created'), humanSelection: z.literal('required_before_handoff'),
  pageAcceptance: z.literal('not_attempted'), orderExecution: z.literal('not_attempted'), retryable: z.literal(false) };
export const aiClientQuoteBookingPreparationResponseSchema = z.discriminatedUnion('state', [
  z.object({ ...preparation, state: z.literal('prepared'), material, action: aiEntryActionSchema }).strict(),
  z.object({ ...preparation, state: z.literal('unknown'), material: z.null(), action: z.null(),
    nextAction: z.literal('read_original_quote') }).strict()
]).superRefine((value, context) => {
  if (value.state === 'prepared' && (value.action.actionCode !== 'CREATE_BOOKING_DRAFT'
    || value.action.associations.materialRef !== value.material.materialRef
    || value.action.resource.resourceVersion !== value.material.materialHash
    || value.action.inputFingerprint !== value.material.inputHash
    || Date.parse(value.action.expiresAt) > Date.parse(value.material.expiresAt)))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Original booking material/action mismatch' });
});
const observation = { contractVersion: z.literal(AI_CLIENT_QUOTE_BOOKING_VERSION), operationKey: id, source,
  currentUse: z.literal('not_authorized_by_receipt'), execution: z.literal('not_attested'), retryable: z.literal(false) };
export const aiClientQuoteBookingOperationResponseSchema = z.discriminatedUnion('state', [
  z.object({ ...observation, state: z.literal('observed'), material: material.extend({ revision: z.literal(1),
    createdAt: date, observedAt: date, materialValidity: z.enum(['expired', 'not_revalidated']) }).strict(),
    originalSelection: aiBookingSelectionSchema.optional(), nextAction: z.literal('revalidate_material_before_action') }).strict(),
  z.object({ ...observation, state: z.literal('unknown'), material: z.null(),
    nextAction: z.literal('read_original_quote_booking_operation') }).strict()
]);
export type AiClientQuoteBookingRequest = z.infer<typeof aiClientQuoteBookingRequestSchema>;
export type AiClientQuoteBookingPreparationResponse = z.infer<typeof aiClientQuoteBookingPreparationResponseSchema>;
export type AiClientQuoteBookingOperationResponse = z.infer<typeof aiClientQuoteBookingOperationResponseSchema>;
