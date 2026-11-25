/** 原租赁金额/比率取整与安全分汇总。EPSILON保留原舍入边界，金额模型和币种仍由所属业务裁定。 */
import { RENTAL_CURRENCY_CODES } from "./contracts";

/** New order amounts must retain a supported original currency. Missing history
 * cannot be repaired from today's workspace settings or by relabelling a price. */
export function hasOriginalRentalCurrency(original: unknown, currency: unknown): boolean {
  return RENTAL_CURRENCY_CODES.some(code => code === original) && currency === original;
}

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Sum original monetary amounts in safe integer cents. Rounding each amount
 * remains the original two-decimal rule; do not accumulate floating errors
 * across a ledger and attempt to repair them with a final rounding. */
export function sumMoney(values: Iterable<number>): number {
  let cents = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new RangeError('Invalid monetary amount');
    const amount = Math.round(roundMoney(value) * 100);
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(cents + amount))
      throw new RangeError('Monetary aggregate exceeds exact cent precision');
    cents += amount;
  }
  return cents / 100;
}

/**
 * 比率取整（4 位小数）。报表里的利用率、转化率不是金额，但同样受 `1.00005` 这类
 * 舍入边界影响；与 `roundMoney` 放在同一模块，避免报表仓储自己再写一份裸 `Math.round`。
 */
export const roundRatio = (value: number) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;
