import type { AiUsageQuantityDraft } from '@rental-os/shared';
import { BudgetError } from './budget.ports';

/** Integer atoms only: money uses micro-units, never Number/float or FX. */
export function quantityAtoms(quantity: AiUsageQuantityDraft): bigint {
  if (!quantity || typeof quantity !== 'object') throw new BudgetError('INVALID');
  if (quantity.unit === 'money') {
    if (quantity.scale !== 6 || !/^[A-Z]{3}$/.test(quantity.currency) || typeof quantity.amount !== 'string' || !/^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/.test(quantity.amount)) throw new BudgetError('INVALID');
    return BigInt(quantity.amount.replace('.', ''));
  }
  if ((quantity.unit !== 'tokens' && quantity.unit !== 'calls') || !Number.isSafeInteger(quantity.value) || quantity.value < 0) throw new BudgetError('INVALID');
  return BigInt(quantity.value);
}
export function sameUnit(left: AiUsageQuantityDraft, right: AiUsageQuantityDraft): boolean {
  quantityAtoms(left); quantityAtoms(right);
  return left.unit === right.unit && (left.unit !== 'money' || (right.unit === 'money' && left.currency === right.currency));
}
export function assertPositiveQuantity(quantity: AiUsageQuantityDraft): void {
  if (quantityAtoms(quantity) <= 0n) throw new BudgetError('EXHAUSTED');
}
