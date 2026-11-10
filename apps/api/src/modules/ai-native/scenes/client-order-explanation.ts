import { z } from 'zod';
import type { ClientOrderView } from '@rental-os/shared';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const fields = ['rentalAmount', 'discountAmount', 'couponAmount', 'serviceAmount', 'fulfillmentAmount',
  'depositAmount', 'preAuthAmount', 'payableAmount', 'adjustmentAmount', 'finalPayableAmount'] as const satisfies readonly (keyof ClientOrderView)[];
const text = z.string().min(1).max(191);
const time = z.string().max(40).datetime({ offset: true });
const projection = z.object({ id: text, status: text.optional(), updatedAt: time.optional(), currency: text.optional(),
  fulfillmentMode: text.optional(), startAt: time.optional(), endAt: time.optional(), effectiveEndAt: time.optional() });

/** Only consume the existing client-owned order projection, never Core or
 * operator facts. Missing amounts remain unknown; no payment inference. */
export function prepareClientOrderExplanation(value: unknown, orderId: string, question: 'status' | 'fees', feeItems?: unknown) {
  const order = projection.parse(value);
  if (order.id !== orderId) throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
  const raw = value as ClientOrderView;
  const source = (field: string) => ({ kind: 'client_order_projection' as const, orderId,
    field, version: order.updatedAt ?? null });
  const fact = (field: string, current: unknown) => current === undefined || current === null
    ? { coverage: 'unknown' as const, source: source(field) }
    : { coverage: 'recorded' as const, value: current, source: source(field) };
  const amounts = question === 'fees' ? Object.fromEntries(fields.map(field => {
    const parsed = z.number().finite().safeParse(raw[field]);
    return [field, fact(field, parsed.success ? parsed.data : undefined)];
  })) : undefined;
  const fees = question === 'fees' && feeItems !== undefined
    ? z.object({ apiVersion: text.optional(), orderId: text, items: z.array(z.object({ inspectionId: text, exceptionIndex: z.number().int().nonnegative(),
      stage: z.enum(['pickup', 'return']), code: text, description: z.string().max(2000), amount: z.number().finite().nonnegative(),
      currency: text, responseStatus: z.enum(['pending', 'confirmed', 'disputed']), evidenceCount: z.number().int().nonnegative() })).max(50),
      pendingCount: z.number().int().nonnegative() }).parse(feeItems)
    : undefined;
  if (fees && fees.orderId !== orderId) throw new Error('AI_CLIENT_CONTEXT_UNAVAILABLE');
  return freezeOriginalInput({ orderId, question,
    status: fact('status', order.status), orderVersion: fact('updatedAt', order.updatedAt),
    ...(amounts ? { amounts, currency: fact('currency', order.currency) } : {}),
    fulfillment: { mode: fact('fulfillmentMode', order.fulfillmentMode), startAt: fact('startAt', order.startAt),
      endAt: fact('endAt', order.endAt), effectiveEndAt: fact('effectiveEndAt', order.effectiveEndAt) },
    gaps: { historicalQuote: 'unavailable_client_history_port_missing' as const,
      payments: 'not_loaded_no_received_total_inferred' as const,
      refunds: 'not_loaded_no_refund_outcome_inferred' as const,
      allowedActions: 'unavailable_client_allowed_actions_port_missing' as const },
    ...(fees ? { inspectionFees: { coverage: 'recorded' as const, value: fees, source: source('feeItems') } } :
      { inspectionFees: { coverage: 'unavailable' as const, reason: 'client_fee_items_port_missing' as const, source: source('feeItems') } }),
    amountSemantics: 'recorded_order_amounts_not_payment_or_refund_evidence' as const,
    model: 'not_requested' as const, businessExecution: 'not_attempted' as const });
}

/** Current client-reader aggregation only. The caller supplies the original
 * guarded member reads; this helper grants no authority or atomic snapshot. */
export async function readClientOrderExplanation(readers: { order(): Promise<unknown>; feeItems?(): Promise<unknown> },
  orderId: string, question: 'status' | 'fees') {
  // Retain the same original reader callbacks and capture their returned data
  // before another source waits. They still authorize each read themselves.
  const readOrder = readers.order.bind(readers);
  const readFees = question === 'fees' && readers.feeItems ? readers.feeItems.bind(readers) : undefined;
  const snapshot = structuredClone(await readOrder());
  const basis = prepareClientOrderExplanation(snapshot, orderId, question);
  const fees = readFees ? structuredClone(await readFees()) : undefined;
  const current = prepareClientOrderExplanation(await readOrder(), orderId, question);
  // Compare the actual minimal client projection, not unexposed operator data.
  // Missing updatedAt is not a synthetic revision: changed visible facts still
  // invalidate the packet, and absent amounts never become zero.
  if (requestFingerprint(basis) !== requestFingerprint(current)) throw new Error('AI_CLIENT_MATERIAL_STALE');
  const prepared = prepareClientOrderExplanation(snapshot, orderId, question, fees);
  if (!readFees) return prepared;
  // Fee review/customer responses can change without touching the order's
  // visible fields. Reopen the SAME client projection after the order wait,
  // then close the order after that fee wait. No retry, arithmetic or new grant;
  // these are bounded observations, not an atomic snapshot or an ABA proof.
  const closingFees = structuredClone(await readFees());
  const closing = prepareClientOrderExplanation(await readOrder(), orderId, question, closingFees);
  if (requestFingerprint(prepared) !== requestFingerprint(closing)) throw new Error('AI_CLIENT_MATERIAL_STALE');
  return closing;
}
