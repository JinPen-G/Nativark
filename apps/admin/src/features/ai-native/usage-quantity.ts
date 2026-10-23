/** Original ledger quantities only: no pricing, currency conversion or token/call inference. */
import type { AiUsageQuantityDraft } from '@rental-os/shared';

export function isUsageQuantity(value: unknown): value is AiUsageQuantityDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const q = value as Record<string, unknown>;
  if (q.unit === 'money') return Object.keys(q).length === 4 && q.scale === 6
    && typeof q.currency === 'string' && /^[A-Z]{3}$/u.test(q.currency)
    && typeof q.amount === 'string' && /^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/u.test(q.amount);
  return Object.keys(q).length === 2 && (q.unit === 'tokens' || q.unit === 'calls')
    && typeof q.value === 'number' && Number.isSafeInteger(q.value) && q.value >= 0
    && (q.unit !== 'calls' || q.value <= 4294967295);
}

export function formatUsageQuantity(value: AiUsageQuantityDraft | null): string {
  if (value === null) return '尚未核实';
  if (!isUsageQuantity(value)) return '不可用';
  return value.unit === 'money' ? `${value.amount} ${value.currency}` : `${value.value} ${value.unit}`;
}
