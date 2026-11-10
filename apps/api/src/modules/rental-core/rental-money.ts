/**
 * 金额取整的**唯一**实现。
 *
 * 这个一行函数此前在六处各写一份（`rental-business.service.ts`、`rental-funding-events.ts`
 * 与四个纯计算模块），另有七处直接裸写 `Math.round(value * 100) / 100` 且漏掉
 * `Number.EPSILON`——恰好全在 `adjustmentAmount` / `finalPayableAmount` 上，
 * 最该稳的地方用了最不稳的写法。新代码一律从这里取。
 *
 * `+ Number.EPSILON` 不是装饰：`1.005` 的二进制表示略小于 1.005，
 * `Math.round(1.005 * 100)` 得 100 而不是 101。加一个最小步长把这类"差一点"推过边界。
 * 它只治舍入边界，**不治浮点本身**——金额链路仍是 `number`，换 Decimal 是另一件事。
 */
import { RENTAL_CURRENCY_CODES } from "@rental-os/shared";

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
