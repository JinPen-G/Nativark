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
    nextAction: z.literal('revalidate_material_before_action') }).strict(),
  z.object({ ...observation, state: z.literal('unknown'), material: z.null(),
    nextAction: z.literal('read_original_quote_booking_operation') }).strict()
]);
export type AiClientQuoteBookingRequest = z.infer<typeof aiClientQuoteBookingRequestSchema>;
export type AiClientQuoteBookingPreparationResponse = z.infer<typeof aiClientQuoteBookingPreparationResponseSchema>;
export type AiClientQuoteBookingOperationResponse = z.infer<typeof aiClientQuoteBookingOperationResponseSchema>;
