import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

type Ledger = Prisma.CustomerCorporateCreditLedgerGetPayload<object>;
export const corporatePaymentReversalKey = (id: string) => `payment.reverse:${createHash('sha256').update(id).digest('hex')}`;
export const corporateAllocationReversalKey = (id: string) => `allocation.reverse:${createHash('sha256').update(id).digest('hex')}`;

/** Original aggregate payment and its exact allocation legs, optionally fully
 * reversed. Amounts are validated before being used as order settlement; neither
 * aggregate fact counts as another receipt of money. No writes or authorization. */
export function corporatePaymentReceipt(payment: Ledger, rows: readonly Ledger[]) {
  const legs = rows.filter(row => row.entryType === 'payment_allocation' && row.idempotencyKey === (row.orderId
    ? `payment.allocation:${createHash('sha256').update(`${payment.idempotencyKey}:${row.orderId}`).digest('hex')}`
    : `payment.legacy:${createHash('sha256').update(payment.idempotencyKey).digest('hex')}`));
  if (payment.entryType !== 'payment' || payment.orderId !== null || payment.workspaceId !== null
    || payment.amount.lte(0) || !payment.reservedDelta.eq(0) || !payment.receivableDelta.eq(0)
    || !legs.length || new Set(legs.map(row => row.orderId)).size !== legs.length
    || legs.some(row => row.tenantId !== payment.tenantId || row.customerId !== payment.customerId
      || row.currency !== payment.currency || row.orderId && !row.workspaceId || row.amount.lte(0)
      || !row.reservedDelta.eq(0) || !row.receivableDelta.eq(row.amount.neg()))
    || !legs.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)).eq(payment.amount)) {
    throw new ConflictException('企业原回款与全部核销金额不一致，须财务核对');
  }
  const reversals = rows.filter(row => row.idempotencyKey === corporatePaymentReversalKey(payment.id));
  const reversedLegs = legs.flatMap(leg => rows.filter(row => row.idempotencyKey === corporateAllocationReversalKey(leg.id)));
  if (!reversals.length && !reversedLegs.length) return { payment, legs, reversal: undefined };
  const reversal = reversals[0];
  if (reversals.length !== 1 || reversedLegs.length !== legs.length || reversal.entryType !== 'payment_reversal'
    || reversal.tenantId !== payment.tenantId || reversal.customerId !== payment.customerId
    || reversal.orderId !== null || reversal.workspaceId !== null || reversal.currency !== payment.currency
    || !reversal.amount.eq(payment.amount) || !reversal.reservedDelta.eq(0) || !reversal.receivableDelta.eq(0)
    || legs.some(leg => {
      const matches = reversedLegs.filter(row => row.idempotencyKey === corporateAllocationReversalKey(leg.id));
      const row = matches[0];
      return matches.length !== 1 || row.entryType !== 'allocation_reversal' || row.tenantId !== leg.tenantId
        || row.customerId !== leg.customerId || row.workspaceId !== leg.workspaceId || row.orderId !== leg.orderId
        || row.currency !== leg.currency || !row.amount.eq(leg.amount) || !row.reservedDelta.eq(0)
        || !row.receivableDelta.eq(leg.amount);
    })) throw new ConflictException('企业回款冲销与原回款/核销不一致，须财务核对');
  return { payment, legs, reversal };
}

/** The same verified allocation net feeds funding and corporate commit gates.
 * An orphan leg or an aggregate payment is never proof that one order was paid. */
export function corporateOrderPaid(workspaceId: string, orderId: string, currency: string | undefined, rows: readonly Ledger[]): Prisma.Decimal {
  const receipts = corporatePaymentReceipts(rows);
  const legs = new Map(receipts.flatMap(receipt => receipt.legs.map(leg => [leg.id, { leg, reversed: Boolean(receipt.reversal) }] as const)));
  let paid = new Prisma.Decimal(0);
  for (const row of rows.filter(row => row.orderId === orderId && ["payment", "payment_allocation"].includes(row.entryType))) {
    const source = legs.get(row.id);
    if (row.entryType !== "payment_allocation" || row.workspaceId !== workspaceId || row.currency !== currency || !source) {
      throw new ConflictException("企业逐单核销缺少唯一原回款或空间/币种不一致，须财务核对");
    }
    if (!source.reversed) paid = paid.plus(row.amount);
  }
  return paid.toDecimalPlaces(2);
}

export function corporatePaymentReceipts(rows: readonly Ledger[]) {
  const payments = rows.filter(row => row.entryType === 'payment' && row.orderId === null);
  if (new Set(payments.map(row => row.id)).size !== payments.length
    || new Set(payments.map(row => row.idempotencyKey)).size !== payments.length) {
    throw new ConflictException('企业核销存在重复原回款来源，须财务核对');
  }
  const receipts = payments.map(row => corporatePaymentReceipt(row, rows));
  const allocated = new Set(receipts.flatMap(receipt => receipt.legs.map(leg => leg.id)));
  if (rows.some(row => row.entryType === 'payment_allocation' && !allocated.has(row.id)
    || row.entryType === 'payment' && row.orderId !== null)) {
    throw new ConflictException('企业核销缺少完整原回款来源，须财务核对');
  }
  const known = new Set(receipts.flatMap(receipt => [receipt.reversal?.id,
    ...receipt.legs.map(leg => corporateAllocationReversalKey(leg.id))]));
  if (rows.some(row => row.entryType === 'payment_reversal' && !known.has(row.id)
    || row.entryType === 'allocation_reversal' && !known.has(row.idempotencyKey))) {
    throw new ConflictException('企业冲销缺少完整原回款来源，须财务核对');
  }
  return receipts;
}
