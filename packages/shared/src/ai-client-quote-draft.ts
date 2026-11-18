import { z } from 'zod';
import type { ClientCreateQuoteRequest } from './client';
import { RENTAL_PRICING_UNIT_CODES } from './core';
import { aiBookingSourceVersionSchema } from './ai-booking-draft';

export const AI_CLIENT_QUOTE_PREPARATION_VERSION = 'ain-client-quote-preparation-1' as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().datetime({ offset: true });
/** Input is the existing client quote DTO. The original server DTO/Core remain
 * authoritative for fields, business enums and eligibility, not another DSL. */
export type AiClientQuotePreparationRequest = { operationKey: string; input: ClientCreateQuoteRequest };
export const aiClientQuotePreparationRequestSchema = z.object({ operationKey: id.max(128), input: z.unknown() }).strict();
export const aiClientQuoteSelectionRefSchema = z.object({ operationKey: id.max(128), selectionHash: digest }).strict();
export type AiClientQuoteSelectionRef = z.infer<typeof aiClientQuoteSelectionRefSchema>;
export const aiClientQuoteReadRequestSchema = z.union([aiClientQuoteSelectionRefSchema, aiClientQuotePreparationRequestSchema]);
export const aiClientPersonalQuoteSelectionSchema = z.object({
  bookingIdentity: z.object({ bookingIdentity: z.literal('personal'), enterpriseContractAndPayer: z.literal(false).optional() }).strict().optional(),
  fulfillmentMode: id, fulfillmentLocationId: id, returnLocationId: id.optional(), startAt: date, endAt: date,
  pricingPlanId: id.optional(), discountPlanId: id.optional(), customerCouponId: id.optional(), deliveryAddressId: id.optional(),
  lines: z.array(z.object({ itemGroupId: id, pricingGroupId: id.optional(), quantity: z.number().finite().positive(),
    pricingUnit: z.enum(RENTAL_PRICING_UNIT_CODES).optional(), usageQuantity: z.number().finite().nonnegative().optional(), note: z.literal('').optional() }).strict()).min(1).max(100),
  services: z.array(z.object({ serviceId: id, quantity: z.number().finite().positive(), scheduledStartAt: date.optional(),
    scheduledEndAt: date.optional(), serviceLocationId: id.optional() }).strict()).max(100).optional(),
}).strict();
export const aiClientQuoteConfirmationRequestSchema = z.object({ materialRef: z.string().uuid(), expectedMaterialHash: digest }).strict();
/** A projection of the SAME stored preparation, never today's defaults or a
 * client claim of consent. Confirmation still binds the original material hash. */
export const aiClientQuoteParameterReviewSchema = z.object({
  configurationHash: digest,
  lines: z.array(z.object({ lineIndex: z.number().int().min(0).max(99), itemGroupId: id, pricingGroupId: id.optional(),
    quantity: z.number().finite().positive(), pricingUnit: z.enum(RENTAL_PRICING_UNIT_CODES),
    source: z.enum(['user_explicit', 'server_default']),
    basis: z.enum(['user_input', 'business_settings_default', 'pricing_group_default'])
  }).strict()).min(1).max(100)
}).strict().superRefine((value, context) => {
  if (value.lines.some((line, index) => line.lineIndex !== index
    || (line.source === 'user_explicit') !== (line.basis === 'user_input')
    || line.basis === 'pricing_group_default' && !line.pricingGroupId
    || line.basis === 'business_settings_default' && line.pricingGroupId !== undefined))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Original pricing unit basis required' });
});
export const aiClientQuotePreparationResponseSchema = z.object({
  contractVersion: z.literal(AI_CLIENT_QUOTE_PREPARATION_VERSION),
  materialRef: z.string().uuid(), materialHash: digest, inputHash: digest,
  revision: z.literal(1), expiresAt: date,
  preparation: z.literal('normalized_parameters'), eligibility: z.literal('not_attested'),
  quotePersistence: z.literal('not_attempted'), inventoryReservation: z.literal('not_attempted'),
  humanAction: z.literal('explicit_confirmation_required'),
  replayed: z.boolean(), freshness: z.literal('recheck_at_confirmation'),
  parameterReview: aiClientQuoteParameterReviewSchema.optional()
}).strict();
export const aiClientQuotePreparationReadResponseSchema = z.discriminatedUnion('state', [
  z.object({ contractVersion: z.literal(AI_CLIENT_QUOTE_PREPARATION_VERSION), state: z.literal('observed'),
    materialRef: z.string().uuid(), materialHash: digest, inputHash: digest, revision: z.literal(1), expiresAt: date,
    preparation: z.literal('normalized_parameters'), eligibility: z.literal('not_attested'),
    quotePersistence: z.literal('not_attempted'), inventoryReservation: z.literal('not_attempted'),
    humanAction: z.literal('explicit_confirmation_required'), freshness: z.literal('recheck_at_confirmation'),
    retryable: z.literal(false), execution: z.literal('read_only'),
    parameterReview: aiClientQuoteParameterReviewSchema.optional(), originalSelection: aiClientPersonalQuoteSelectionSchema.optional() }).strict(),
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
  /** Optional for already published packets. New observations project only
   * the original Core request; missing legacy units remain null. */
  timeZone: z.string().min(1).max(64).nullable().optional(),
  lineUnits: z.array(z.object({ lineIndex: z.number().int().min(0).max(99), itemGroupId: id.nullable(),
    pricingUnit: z.enum(RENTAL_PRICING_UNIT_CODES).nullable(), quantity: z.number().finite().positive().nullable(),
    usageQuantity: z.number().finite().nonnegative().nullable() }).strict()).max(100).nullable().optional(),
  chargeLines: z.array(z.object({ type: id, amount: z.number().finite(),
    name: z.string().min(1).max(256).nullable().optional(),
    sourceId: id.nullable(), sourceVersion: aiBookingSourceVersionSchema.nullable() }).strict()).max(100).nullable()
}).strict();
export const aiClientQuoteResultReadResponseSchema = z.object({
  contractVersion: z.literal(AI_CLIENT_QUOTE_PREPARATION_VERSION), state: z.enum(['observed', 'unknown']),
  source: z.object({ materialRef: z.string().uuid(), materialHash: digest }).strict(),
  quote: aiClientQuoteFactsSchema.nullable(), quotePersistence: z.enum(['saved', 'unknown']),
  /** This read's server observation time, separate from quote.createdAt. */
  observedAt: date.optional(),
  inventoryReservation: z.literal('not_attempted'), orderExecution: z.literal('not_attempted'),
  confirmation: z.literal('parameters_only_not_order_approval'), retryable: z.literal(false),
  nextAction: z.literal('read_original_quote')
}).strict().superRefine((value, context) => {
  if ((value.state === 'observed') !== (value.quote !== null) || (value.state === 'observed') !== (value.quotePersistence === 'saved'))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent original quote observation' });
});
export type AiClientQuoteFacts = z.infer<typeof aiClientQuoteFactsSchema>;
export type AiClientQuoteParameterReview = z.infer<typeof aiClientQuoteParameterReviewSchema>;
export type AiClientQuoteConfirmationRequest = z.infer<typeof aiClientQuoteConfirmationRequestSchema>;
export type AiClientQuotePreparationResponse = z.infer<typeof aiClientQuotePreparationResponseSchema>;
export type AiClientQuoteResultReadResponse = z.infer<typeof aiClientQuoteResultReadResponseSchema>;
