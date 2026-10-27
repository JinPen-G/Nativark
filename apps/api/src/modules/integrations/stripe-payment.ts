import { createHmac, timingSafeEqual } from "node:crypto";
import { toCents } from "./payment-money";

/**
 * Stripe 收单适配器的纯工具:回调验签、金额换算、状态映射。
 *
 * 单独成文件且不依赖 Nest,是为了让这些"最容易出错、也最安全攸关"的部分脱离运行时
 * 被专项单测覆盖(与 payment-money.ts 同定位)。B 阶段接入 PaymentRuntimeService 时复用。
 */

/** Stripe 回调时间容差:默认 5 分钟,与官方库一致。绝不用 0(等于关闭时效检查)。 */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

/** 当前收单链只接实款；支持完整或 restricted live key，不把格式识别当连接认证。 */
export function isStripeLiveKey(value: unknown): boolean {
  return typeof value === "string" && /^(?:sk|rk)_live_[A-Za-z0-9]+$/u.test(value);
}

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

interface ParsedStripeSignature {
  timestamp: number | null;
  v1: string[];
}

/** 解析 `Stripe-Signature: t=...,v1=...,v0=...`;只取 t 与 v1,忽略 v0 等其它 scheme(防降级)。 */
export function parseStripeSignatureHeader(header: string): ParsedStripeSignature {
  const result: ParsedStripeSignature = { timestamp: null, v1: [] };
  for (const part of String(header ?? "").split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") {
      const parsed = Number(value);
      result.timestamp = Number.isFinite(parsed) ? parsed : null;
    } else if (key === "v1" && value) {
      result.v1.push(value);
    }
  }
  return result;
}

/**
 * 校验 Stripe 回调签名:signed_payload = `${t}.${rawBody}`,以 endpoint 签名密钥做
 * HMAC-SHA256(hex),与头里的 v1(轮换期可能多个)定长比较,并校验时间容差。
 * rawBody 必须是**原始请求体**,任何改动都会导致验签失败。
 */
export function verifyStripeSignature(input: {
  payload: string | Buffer;
  header: string;
  secret: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): boolean {
  const secret = String(input.secret ?? "");
  if (!secret) return false;
  const { timestamp, v1 } = parseStripeSignatureHeader(input.header);
  if (timestamp === null || v1.length === 0) return false;
  const tolerance = input.toleranceSeconds ?? STRIPE_SIGNATURE_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (tolerance > 0 && Math.abs(nowSeconds - timestamp) > tolerance) return false;
  const body = Buffer.isBuffer(input.payload) ? input.payload.toString("utf8") : String(input.payload);
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"), "hex");
  return v1.some((candidate) => {
    let candidateBuffer: Buffer;
    try {
      candidateBuffer = Buffer.from(candidate, "hex");
    } catch {
      return false;
    }
    return candidateBuffer.length === expected.length && timingSafeEqual(candidateBuffer, expected);
  });
}

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