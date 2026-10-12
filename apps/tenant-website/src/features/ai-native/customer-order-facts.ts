import type { ClientOrderView } from '@rental-os/shared';

/** A display whitelist of the current original customer order, never an AI answer. */
export function customerOrderFacts(order: ClientOrderView, expectedId: string) {
  if (!order || order.id !== expectedId) return null;
  const text = (value: unknown, max: number) => typeof value === 'string'
    ? Array.from(value).slice(0, max).join('').replace(/[\u202A-\u202E\u2066-\u2069]/g, '') : '未知';
  const currency = typeof order.currency === 'string' && /^[A-Z]{3}$/u.test(order.currency) ? order.currency : '币种未知';
  const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
    && (!Number.isInteger(value) || Number.isSafeInteger(value)) ? `${value} ${currency}` : '未知';
  return {
    receivable: amount(order.finalPayableAmount), deposit: amount(order.depositAmount), preAuth: amount(order.preAuthAmount),
    paid: '未知：未读取付款收据', refundStatus: '未加载退款受理/执行结果，不推断已退款',
    status: text(order.status, 80), sourceId: text(order.id, 191),
    updatedAt: typeof order.updatedAt === 'string' && Number.isFinite(Date.parse(order.updatedAt)) ? text(order.updatedAt, 64) : '未知',
    note: '押金和预授权是原订单要求，不表示已收取或冻结。历史报价/规则/检查依据未加载。',
  };
}
