import { formatRentalMoney } from '@rental-os/shared';

/** 缺金额或币种时返回空值，已知金额沿用公共业务精度工具展示。 */
export function knownMoney(amount: unknown, currency: unknown): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)
    || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
  return formatRentalMoney(amount, currency);
}
