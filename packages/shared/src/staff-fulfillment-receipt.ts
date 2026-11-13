/** Original staff fulfillment receipts only. A key locates a recorded Core
 * operation; current order/location access remains mandatory. An unknown
 * observation never permits another submission or replacement operation key. */
import { z } from 'zod';
import { AI_STAFF_INSPECTION_HTTP_DRAFT } from './ai-entry-http-draft';
import { leafClosed as object, leafEnum as choice, leafText as text,
  leafRef as ref, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const STAFF_FULFILLMENT_RECEIPT_VERSION = 'staff-fulfillment-receipt-1' as const;
export const STAFF_FULFILLMENT_RECEIPT_HTTP = Object.freeze({
  basePath: AI_STAFF_INSPECTION_HTTP_DRAFT.basePath, operation: 'fulfillment-receipt-read', method: 'POST',
} as const);
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
// The original Core checks raw UTF-16 length before trimming. Preserve keys
// accepted by that entry, including slashes, instead of inventing a new format.
const key = z.string().min(1).max(191).transform(value => value.trim()).refine(value => value.length > 0);
const common = { orderId: id, operationKey: key, stage: z.enum(['pickup', 'return']) };
export const staffFulfillmentReceiptRequest = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('inspection'), templateId: id }).strict(),
  z.object({ ...common, kind: z.literal('handover') }).strict(),
  z.object({ ...common, kind: z.literal('partial_return'), stage: z.literal('return') }).strict(),
]);
export type StaffFulfillmentReceiptRequest = z.infer<typeof staffFulfillmentReceiptRequest>;
export type StaffFulfillmentReceiptQuery = StaffFulfillmentReceiptRequest extends infer T
  ? T extends StaffFulfillmentReceiptRequest ? Omit<T, 'orderId'> : never : never;
const semantics = { version: z.literal(STAFF_FULFILLMENT_RECEIPT_VERSION), original: staffFulfillmentReceiptRequest,
  execution: z.literal('read_only_no_submission'), automaticRetry: z.literal(false) };
export const staffFulfillmentReceiptObservation = z.discriminatedUnion('state', [
  z.object({ ...semantics, state: z.literal('committed'),
    receipt: z.object({ orderId: id, inspectionId: id.optional() }).strict() }).strict(),
  z.object({ ...semantics, state: z.literal('unknown'), receipt: z.null() }).strict(),
]).superRefine((value, context) => {
  if (value.state === 'committed' && (value.receipt.orderId !== value.original.orderId
    || (value.original.kind === 'inspection') !== (value.receipt.inspectionId !== undefined)))
    context.addIssue({ code: 'custom', message: 'Original fulfillment receipt binding differs' });
});
export type StaffFulfillmentReceiptObservation = z.infer<typeof staffFulfillmentReceiptObservation>;

const identifier: AiLeafSchemaDraft = { ...text(191), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const operationKey: AiLeafSchemaDraft = { ...text(191), pattern: '\\S' };
const inspectionOriginal = object({ orderId: identifier, operationKey, stage: choice('pickup', 'return'), kind: choice('inspection'), templateId: identifier });
const handoverOriginal = object({ orderId: identifier, operationKey, stage: choice('pickup', 'return'), kind: choice('handover') });
const partialReturnOriginal = object({ orderId: identifier, operationKey, stage: choice('return'), kind: choice('partial_return') });
const original: AiLeafSchemaDraft = { oneOf: [inspectionOriginal, handoverOriginal, partialReturnOriginal] };
const response = { version: choice(STAFF_FULFILLMENT_RECEIPT_VERSION), original: ref('StaffFulfillmentReceiptRequest'),
  execution: choice('read_only_no_submission'), automaticRetry: { type: 'boolean', const: false } as AiLeafSchemaDraft };
export const STAFF_FULFILLMENT_RECEIPT_SCHEMAS = Object.freeze({
  StaffFulfillmentReceiptRequest: original,
  StaffFulfillmentReceiptObservation: { oneOf: [
    object({ ...response, original: inspectionOriginal, state: choice('committed'),
      receipt: object({ orderId: identifier, inspectionId: identifier }) }),
    object({ ...response, original: { oneOf: [handoverOriginal, partialReturnOriginal] }, state: choice('committed'),
      receipt: object({ orderId: identifier }) }),
    object({ ...response, state: choice('unknown'), receipt: { type: 'null' } }),
  ] } as AiLeafSchemaDraft,
});
export const STAFF_FULFILLMENT_RECEIPT_CONTRACT = Object.freeze({
  request: 'StaffFulfillmentReceiptRequest', response: 'StaffFulfillmentReceiptObservation', write: false,
} as const);
