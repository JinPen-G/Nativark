/** One short-lived original Booking reference across independently logged-in
 * customer surfaces. A valid locator or receipt is never an execution grant;
 * the target host must recheck current identity, policy and original material. */
import { z } from 'zod';
import { AI_CUSTOMER_ENTRY_SURFACES } from './ai-entry-action-draft';

export const AI_CLIENT_BOOKING_TRANSFER_VERSION = 'ain-booking-transfer-1' as const;
const operationKey = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const reference = z.string().uuid(), date = z.string().datetime({ offset: true });
export const aiClientBookingTransferIssueRequestSchema = z.object({ handoffRef: reference, operationKey,
  targetSurface: z.enum(AI_CUSTOMER_ENTRY_SURFACES) }).strict();
export const aiClientBookingTransferRequestSchema = z.object({ transferRef: reference, operationKey }).strict();
const receipt = { contractVersion: z.literal(AI_CLIENT_BOOKING_TRANSFER_VERSION), operationKey,
  currentUse: z.literal('not_authorized_by_receipt'), execution: z.literal('not_attempted'), retryable: z.literal(false) };
export const aiClientBookingTransferIssueResponseSchema = z.discriminatedUnion('state', [
  z.object({ ...receipt, state: z.literal('issued'), handoffRef: reference, targetSurface: z.enum(AI_CUSTOMER_ENTRY_SURFACES),
    transferRef: reference, expiresAt: date, nextAction: z.literal('target_reauthenticate_and_consume') }).strict(),
  z.object({ ...receipt, state: z.literal('unknown'), handoffRef: reference, targetSurface: z.enum(AI_CUSTOMER_ENTRY_SURFACES),
    transferRef: z.null(), expiresAt: z.null(), nextAction: z.literal('read_original_transfer_issue') }).strict()
]);
export const aiClientBookingTransferReceiptSchema = z.discriminatedUnion('state', [
  z.object({ ...receipt, state: z.literal('consumed'), transferRef: reference, handoffRef: reference,
    bookingDraftId: reference, expiresAt: date, nextAction: z.literal('revalidate_original_handoff') }).strict(),
  z.object({ ...receipt, state: z.literal('unknown'), transferRef: reference, handoffRef: z.null(),
    bookingDraftId: z.null(), expiresAt: z.null(), nextAction: z.literal('read_original_transfer_receipt') }).strict()
]);
export type AiClientBookingTransferIssueRequest = z.infer<typeof aiClientBookingTransferIssueRequestSchema>;
export type AiClientBookingTransferRequest = z.infer<typeof aiClientBookingTransferRequestSchema>;
export type AiClientBookingTransferIssueResponse = z.infer<typeof aiClientBookingTransferIssueResponseSchema>;
export type AiClientBookingTransferReceipt = z.infer<typeof aiClientBookingTransferReceiptSchema>;

const id = { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const uuid = { type: 'string', format: 'uuid' }, time = { type: 'string', format: 'date-time' };
const literal = (value: string | boolean) => ({ const: value });
const closed = (properties: Record<string, unknown>) => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const surface = { enum: AI_CUSTOMER_ENTRY_SURFACES };
const common = { contractVersion: literal(AI_CLIENT_BOOKING_TRANSFER_VERSION), operationKey: id,
  currentUse: literal('not_authorized_by_receipt'), execution: literal('not_attempted'), retryable: literal(false) };
export const AI_CLIENT_BOOKING_TRANSFER_SCHEMAS = {
  AiClientBookingTransferIssueRequest: closed({ handoffRef: uuid, operationKey: id, targetSurface: surface }),
  AiClientBookingTransferRequest: closed({ transferRef: uuid, operationKey: id }),
  AiClientBookingTransferIssueResponse: { oneOf: [
    closed({ ...common, state: literal('issued'), handoffRef: uuid, targetSurface: surface, transferRef: uuid,
      expiresAt: time, nextAction: literal('target_reauthenticate_and_consume') }),
    closed({ ...common, state: literal('unknown'), handoffRef: uuid, targetSurface: surface, transferRef: { type: 'null' },
      expiresAt: { type: 'null' }, nextAction: literal('read_original_transfer_issue') })
  ] },
  AiClientBookingTransferReceipt: { oneOf: [
    closed({ ...common, state: literal('consumed'), transferRef: uuid, handoffRef: uuid, bookingDraftId: uuid,
      expiresAt: time, nextAction: literal('revalidate_original_handoff') }),
    closed({ ...common, state: literal('unknown'), transferRef: uuid, handoffRef: { type: 'null' }, bookingDraftId: { type: 'null' },
      expiresAt: { type: 'null' }, nextAction: literal('read_original_transfer_receipt') })
  ] }
} as const;
