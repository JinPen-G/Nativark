import { roundMoney } from "../rental-core/rental-money";

/**
 * 元 → 分的唯一转换点。微信支付的金额字段以分计，此前四处各写一份
 * `Math.round(x * 100)`，与 `roundMoney` 的 EPSILON 修正不一致：
 * `Math.round(1.005 * 100)` 得 100，而 `roundMoney(1.005)` 得 1.01。
 * 先按元取整再乘 100，保证分值与订单侧记账金额来自同一套舍入。
 */
export function toCents(amount: number) {
  return Math.round(roundMoney(amount) * 100);
}

export { roundMoney };
