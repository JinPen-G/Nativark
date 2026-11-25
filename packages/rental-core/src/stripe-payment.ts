/** Stripe的原金额换算、特殊币种和收据/状态映射，沿Rental精度和原资金依据。 */
export { STRIPE_SIGNATURE_TOLERANCE_SECONDS, isStripeLiveKey, parseStripeSignatureHeader, verifyStripeSignature } from "@rental-os/platform-server/integration-payment";
import { toCents } from "./payment-money";

/** 原支付/退款响应中的核验标记，只能由运行器在原收据校验后写入。 */
export function hasStripeLiveReceipt(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).stripeLiveVerified === true;
}

/**
 * 零小数币种(金额即最小单位,不 ×100)。本平台当前 7 种结算币种都不在其中,
 * 但保留此表,将来支持 JPY/KRW 等时金额换算不出错。
 */
export const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"
]);

/**
 * Stripe 对 HUF/TWD/UGX 有"以最小单位计,但必须是 100 的整数倍"的特殊规则。
 * 本平台 TWD 金额是两位小数,与该规则不一致,贸然 ×100 可能被 Stripe 拒绝或错算。
 * 因此这里**明确不猜**:命中特殊币种直接抛错,由启用前对照官方文档核对后再放开,
 * 宁可 fail-closed 也不静默错算金额。
 */
export const STRIPE_SPECIAL_CASE_CURRENCIES = new Set(["HUF", "TWD", "UGX"]);

/**
 * 金额 → Stripe 最小货币单位。两位小数币种走 toCents(与全局记账同一套舍入);
 * 零小数币种取整;特殊币种(HUF/TWD/UGX)fail-closed 抛错,不静默错算。
 */
export function toStripeMinorUnits(amount: number, currency: string): number {
  const code = String(currency ?? "").toUpperCase();
  if (STRIPE_SPECIAL_CASE_CURRENCIES.has(code)) {
    throw new Error(`币种 ${code} 在 Stripe 有特殊最小单位规则,启用前需对照官方文档单独处理`);
  }
  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(code)) return Math.round(amount);
  return toCents(amount);
}

/** Stripe 最小货币单位 → 金额(元)。与 toStripeMinorUnits 对称,供回调/查单核对金额。 */
export function fromStripeMinorUnits(minor: number, currency: string): number {
  const code = String(currency ?? "").toUpperCase();
  if (STRIPE_SPECIAL_CASE_CURRENCIES.has(code)) {
    throw new Error(`币种 ${code} 在 Stripe 有特殊最小单位规则,启用前需对照官方文档单独处理`);
  }
  const value = Number(minor);
  if (!Number.isFinite(value)) return Number.NaN;
  return STRIPE_ZERO_DECIMAL_CURRENCIES.has(code) ? value : value / 100;
}

/** Stripe Checkout Session 状态 → 平台语义。complete+paid 视为已付;expired 视为已关闭。 */
export function mapStripeCheckoutStatus(session: { status?: string; payment_status?: string }): { paid: boolean; closed: boolean } {
  const status = String(session?.status ?? "");
  const paymentStatus = String(session?.payment_status ?? "");
  return {
    paid: status === "complete" && (paymentStatus === "paid" || paymentStatus === "no_payment_required"),
    closed: status === "expired"
  };
}
