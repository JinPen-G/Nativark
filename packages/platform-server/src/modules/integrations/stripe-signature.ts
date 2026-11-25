/** Stripe回调的原签名、时间容差与live密钥识别，供实际支付运输和业务收据验证复用。 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe 回调时间容差:默认 5 分钟,与官方库一致。绝不用 0(等于关闭时效检查)。 */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;


/** 当前收单链只接实款；支持完整或 restricted live key，不把格式识别当连接认证。 */
export function isStripeLiveKey(value: unknown): boolean {
  return typeof value === "string" && /^(?:sk|rk)_live_[A-Za-z0-9]+$/u.test(value);
}


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
