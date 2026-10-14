import { z } from 'zod';
import type { ClientCreateQuoteRequest } from './client';

export const AI_CLIENT_QUOTE_PREPARATION_VERSION = 'ain-client-quote-preparation-1' as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().datetime({ offset: true });
/** Input is the existing client quote DTO. The original server DTO/Core remain
 * authoritative for fields, business enums and eligibility, not another DSL. */
export type AiClientQuotePreparationRequest = { operationKey: string; input: ClientCreateQuoteRequest };
export const aiClientQuotePreparationRequestSchema = z.object({ operationKey: id.max(128), input: z.unknown() }).strict();
export const aiClientQuoteConfirmationRequestSchema = z.object({ materialRef: z.string().uuid(), expectedMaterialHash: digest }).strict();
export const aiClientQuotePreparationResponseSchema = z.object({
  contractVersion: z.literal(AI_CLIENT_QUOTE_PREPARATION_VERSION),
  materialRef: z.string().uuid(), materialHash: digest, inputHash: digest,
  revision: z.literal(1), expiresAt: date,
  preparation: z.literal('normalized_parameters'), eligibility: z.literal('not_attested'),
  quotePersistence: z.literal('not_attempted'), inventoryReservation: z.literal('not_attempted'),
  humanAction: z.literal('explicit_confirmation_required'),
  replayed: z.boolean(), freshness: z.literal('recheck_at_confirmation')
}).strict();
export const aiClientQuotePreparationReadResponseSchema = z.discriminatedUnion('state', [
  z.object({ contractVersion: z.literal(AI_CLIENT_QUOTE_PREPARATION_VERSION), state: z.literal('observed'),
    materialRef: z.string().uuid(), materialHash: digest, inputHash: digest, revision: z.literal(1), expiresAt: date,
    preparation: z.literal('normalized_parameters'), eligibility: z.literal('not_attested'),
    quotePersistence: z.literal('not_attempted'), inventoryReservation: z.literal('not_attempted'),
    humanAction: z.literal('explicit_confirmation_required'), freshness: z.literal('recheck_at_confirmation'),
    retryable: z.literal(false), execution: z.literal('read_only') }).strict(),
  z.object({ contractVersion: z.literal(AI_CLIENT_QUOTE_PREPARATION_VERSION), state: z.literal('unknown'),
    operationKey: id, retryable: z.literal(false), execution: z.literal('read_only') }).strict()
]);
/** Original Core values only. Null means missing, never zero or a reconstructed
 * price. No customer data, internal configuration, lease or dispatch fields. */
export const aiClientQuoteFactsSchema = z.object({
  quoteId: id, currency: z.string().regex(/^[A-Z]{3}$/u).nullable(),
  payableAmount: z.number().finite().nonnegative().nullable(),
  depositAmount: z.number().finite().nonnegative().nullable(),
  preAuthAmount: z.number().finite().nonnegative().nullable(),
  pricingPlanVersion: id.nullable(), ruleVersion: id.nullable(), priceVersionId: id.nullable(),
  calendarVersion: id.nullable(), categoryVersionId: id.nullable(),
  createdAt: date.nullable(), expiresAt: date.nullable(),
  chargeLines: z.array(z.object({ type: id, amount: z.number().finite(),
    sourceId: id.nullable(), sourceVersion: id.nullable() }).strict()).max(100).nullable()
}).strict();
export const aiClientQuoteResultReadResponseSchema = z.object({
  contractVersion: z.literal(AI_CLIENT_QUOTE_PREPARATION_VERSION), state: z.enum(['observed', 'unknown']),
  source: z.object({ materialRef: z.string().uuid(), materialHash: digest }).strict(),
  quote: aiClientQuoteFactsSchema.nullable(), quotePersistence: z.enum(['saved', 'unknown']),
  inventoryReservation: z.literal('not_attempted'), orderExecution: z.literal('not_attempted'),
  confirmation: z.literal('parameters_only_not_order_approval'), retryable: z.literal(false),
  nextAction: z.literal('read_original_quote')
}).strict().superRefine((value, context) => {
  if ((value.state === 'observed') !== (value.quote !== null) || (value.state === 'observed') !== (value.quotePersistence === 'saved'))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent original quote observation' });
});
export type AiClientQuoteFacts = z.infer<typeof aiClientQuoteFactsSchema>;
export type AiClientQuoteConfirmationRequest = z.infer<typeof aiClientQuoteConfirmationRequestSchema>;
export type AiClientQuotePreparationResponse = z.infer<typeof aiClientQuotePreparationResponseSchema>;
export type AiClientQuoteResultReadResponse = z.infer<typeof aiClientQuoteResultReadResponseSchema>;
