/** 公共支付运输保留原签名、响应验证、受控请求和连接探针。
 * Rental调用方持有金额、原订单/退款引用、事务与收据。运输结果按原错误类别返回。 */
import { ServiceUnavailableException } from "@nestjs/common";
import { createHash, createDecipheriv, createPublicKey, createSign, createVerify, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { assertOutboundUrl } from "../../common/outbound-url";
import type { TenantIntegrationRuntimeConfig } from "./tenant-integration.service";
import { isStripeLiveKey } from "./stripe-signature";

export type JsonRecord = Record<string, unknown>;

export interface PaymentCallbackInput {
  body?: unknown;
  rawBody?: Buffer;
  headers?: Record<string, unknown>;
}

export interface ProviderPaymentResult {
  state: string;
  paid: boolean;
  closed: boolean;
  amount: number;
  externalTransactionId: string;
  stripeReceipt?: { livemode: true; sessionId: string };
}

export function valueOf(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

export function certificateSerial(value: unknown) {
  return valueOf(value).trim().toUpperCase();
}

export function requiredText(value: unknown, name: string) {
  const result = valueOf(value).trim();
  if (!result) throw new ServiceUnavailableException(`支付平台缺少配置：${name}`);
  return result;
}

export function pem(value: unknown) {
  return requiredText(value, "证书或私钥").replace(/\\n/gu, "\n");
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function nonce() {
  return randomBytes(16).toString("hex");
}

export function timestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

export function alipayTimestamp() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/**
 * 支付宝 time_expire 要求 `yyyy-MM-dd HH:mm:ss` 且按北京时间解释，
 * 不带时区；这里显式按 Asia/Shanghai 格式化，不依赖进程时区。
 */
export function alipayExpireTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/** 微信 time_expire 要求 RFC3339 且带时区偏移；固定输出 +08:00，不用 `Z`（微信文档示例格式）。 */
export function wechatExpireTime(date: Date) {
  return `${alipayExpireTime(date).replace(" ", "T")}+08:00`;
}

export function signRsa(privateKey: string, content: string) {
  const signer = createSign("RSA-SHA256");
  signer.update(content);
  signer.end();
  return signer.sign(pem(privateKey), "base64");
}

export function verifyRsa(publicKey: string, content: string, signature: string) {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(content);
  verifier.end();
  return verifier.verify(pem(publicKey), signature, "base64");
}

export function stableFormContent(values: Record<string, unknown>, exclude: string[] = []) {
  const excluded = new Set(exclude);
  return Object.keys(values)
    .filter((key) => !excluded.has(key) && valueOf(values[key]) !== "")
    .sort()
    .map((key) => `${key}=${valueOf(values[key])}`)
    .join("&");
}

/**
 * 请求已经离开本系统，但没有得到可确认的支付平台结果。
 * 这类错误绝不能把支付单置为 failed：平台可能已经受理，后续只能靠查询或回调确认。
 */
export class PaymentProviderUnknownError extends ServiceUnavailableException {
  readonly providerResultUnknown = true;

  constructor(message = "支付平台未返回可确认结果，请查询支付状态后再重试") {
    super(message);
    this.name = "PaymentProviderUnknownError";
  }
}

export class PaymentProviderHttpError extends Error {
  constructor(readonly status: number, message: string, readonly code = "") {
    super(message);
    this.name = "PaymentProviderHttpError";
  }
}

/**
 * 第三方**明确且不可逆**地拒绝了这次请求：重试同一请求不会得到不同结果。
 * 只有这一类错误可以把退款单置为 failed 并释放退款额度。
 *
 * 与 PaymentProviderUnknownError 相对：后者是“不知道平台做了什么”，
 * 前者是“平台明确说了不做”。业务级拒绝（如支付宝 ACQ.TRADE_HAS_CLOSE）
 * 之前只是 plain Error，被 markRefundProviderCallPending 归为 pending，
 * 于是永远占着额度、永远阻止停用平台。
 */
export class PaymentProviderDefinitiveError extends Error {
  readonly providerResultDefinitive = true;

  constructor(readonly providerCode: string, message: string) {
    super(message);
    this.name = "PaymentProviderDefinitiveError";
  }
}

/**
 * 支付宝 40004 是业务处理失败，但 sub_code 决定是否可重试：
 * 余额不足、系统繁忙这类必须留 pending，等余额到账/查询确认；
 * 交易已关闭、交易不存在、金额超限则再试一万次也一样，直接判定。
 * 40006 是权限不足（ISV 权限/接口未签约），同样不会因重试而改变。
 */
const ALIPAY_RETRYABLE_SUB_CODES = new Set([
  "ACQ.SELLER_BALANCE_NOT_ENOUGH",
  "ACQ.SYSTEM_ERROR",
  "ACQ.REFUND_CHARGE_ERROR",
  "ACQ.NOT_ENOUGH_BALANCE"
]);

export function alipayFailure(result: JsonRecord, fallback: string): Error {
  const code = valueOf(result.code);
  const subCode = valueOf(result.sub_code).toUpperCase();
  const message = valueOf(result.sub_msg || result.msg || fallback);
  const definitive = code === "40006" || (code === "40004" && !ALIPAY_RETRYABLE_SUB_CODES.has(subCode));
  return definitive
    ? new PaymentProviderDefinitiveError(subCode || code, `${subCode || code}: ${message}`)
    : new Error(`${subCode || code || "ALIPAY"}: ${message}`);
}

export function isProviderCallUnknown(error: unknown) {
  if (error instanceof PaymentProviderUnknownError) return true;
  if (error instanceof PaymentProviderDefinitiveError) return false;
  if (!(error instanceof PaymentProviderHttpError)) return true;
  return ![400, 401, 403, 404].includes(error.status);
}

/**
 * 退款调用异常 → 退款单去向。
 * - definitive：平台明确拒绝 → failed（释放额度）。
 * - 微信 HTTP 400/401/403/404：参数、鉴权或资源不存在，重试同一请求无意义 → failed；
 *   例外是 403 NOT_ENOUGH（余额不足），充值后可重发 → pending。
 * - 微信 HTTP 409（审计 L6）：FREQUENCY_LIMITED / 系统繁忙，**这笔退款可能已受理**，
 *   必须留 pending 等查询确认，不能判失败——否则额度被释放后会重复退款。
 * - 其余（网络、5xx、未知）→ pending。
 */
export function refundFailureDisposition(error: unknown): { definitive: boolean; providerCode?: string } {
  if (error instanceof PaymentProviderDefinitiveError) return { definitive: true, providerCode: error.providerCode };
  if (error instanceof PaymentProviderHttpError) {
    // NOT_ENOUGH：商户可用余额不足，充值后同一笔退款可以再发起，不是不可逆拒绝。
    if (error.code === "NOT_ENOUGH") return { definitive: false };
    return [400, 401, 403, 404].includes(error.status) ? { definitive: true, providerCode: error.code || `HTTP_${error.status}` } : { definitive: false };
  }
  const message = error instanceof Error ? error.message : "";
  const status = message.match(/HTTP (400|401|403|404)\b/u)?.[1];
  return status ? { definitive: true, providerCode: `HTTP_${status}` } : { definitive: false };
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
  validateResponse?: (response: Response, rawBody: string) => void
): Promise<JsonRecord> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // 租户可配置网关，但支付请求不应被跟随跳转到另一个主机。
    const safeUrl = await assertOutboundUrl(url, "支付平台请求地址", { allowQuery: true });
    let response: Response;
    try {
      response = await fetch(safeUrl, { ...init, redirect: "error", signal: controller.signal });
    } catch {
      throw new PaymentProviderUnknownError();
    }
    let raw: string;
    try {
      raw = await response.text();
    } catch {
      throw new PaymentProviderUnknownError();
    }
    validateResponse?.(response, raw);
    let body: JsonRecord;
    try {
      body = JSON.parse(raw) as JsonRecord;
    } catch {
      body = { raw: raw.slice(0, 500) };
    }
    if (!response.ok) {
      // Stripe 的错误体是嵌套的 {error:{code,message}};支付宝/微信是平铺的。两者兼容:有 error 对象就取它,否则取顶层。
      const errorBody = (body.error && typeof body.error === "object" && !Array.isArray(body.error) ? body.error : body) as JsonRecord;
      throw new PaymentProviderHttpError(response.status, `HTTP ${response.status}: ${valueOf(errorBody.message || errorBody.msg || body.raw)}`, valueOf(errorBody.code).toUpperCase());
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export class PaymentProviderTransport {


  /**
   * 只查询一个随机不存在的交易号验证商户签名与网关连通性。
   * 此方法不会创建支付单、扣款、关单或触发退款。
   */
  async testConnection(config: TenantIntegrationRuntimeConfig): Promise<string> {
    const merchantOrderNo = `ROTEST${randomUUID().replace(/-/gu, "").slice(0, 20)}`;
    if (config.provider === "alipay") {
      await this.queryAlipayIntent(config, merchantOrderNo);
      return "已验证支付宝连接（仅查询随机交易号，未创建或扣款）。";
    }
    if (config.provider === "wechat_pay") {
      // 先做纯本地校验：这些配置错误在真实回调到来前不会暴露，而回调验签失败时
      // 已经没有人能看到错误。校验不发任何请求，只解析证书与密钥长度。
      this.assertWechatCallbackMaterial(config);
      await this.queryWechatIntent(config, merchantOrderNo);
      return "已验证微信支付连接、响应验签材料与平台连通性（仅查询随机交易号，未创建或扣款）。";
    }
    if (config.provider === "stripe") {
      // 只读余额,校验 Secret Key 与网关连通性;不创建 Checkout、不扣款、不退款。
      // 同时本地确认 Webhook 签名密钥已填,否则回调将静默验签失败、无人可见。
      requiredText(config.credentials.webhookSecret, "Webhook 签名密钥");
      const balance = await this.stripeRequest(config, "GET", "/v1/balance");
      if (balance.livemode !== true) throw new ServiceUnavailableException("Stripe 未证明真实资金模式，不能将测试账户认证为真实收单");
      return "已验证 Stripe 真实模式连接（仅读取账户余额，未创建或扣款）。";
    }
    throw new ServiceUnavailableException("未实现的支付平台适配器");
  }


  /** 微信证书模式和公钥模式均按精确的 Wechatpay-Serial 选择材料；不跨模式降级。 */
  assertWechatCallbackMaterial(config: TenantIntegrationRuntimeConfig) {
    const key = Buffer.from(requiredText(config.credentials.apiV3Key, "API v3 密钥"), "utf8");
    if (key.length !== 32) throw new ServiceUnavailableException(`API v3 密钥必须是 32 字节，当前 ${key.length} 字节`);
    const certificateSerialValue = valueOf(config.settings.platformCertificateSerial).trim();
    const certificatePem = valueOf(config.credentials.wechatPlatformCertificate).trim();
    const publicKeyId = valueOf(config.settings.platformPublicKeyId).trim();
    const publicKeyPem = valueOf(config.credentials.wechatPlatformPublicKey).trim();
    if (Boolean(certificateSerialValue) !== Boolean(certificatePem)) throw new ServiceUnavailableException("平台证书序列号与平台证书必须成对配置");
    if (Boolean(publicKeyId) !== Boolean(publicKeyPem)) throw new ServiceUnavailableException("微信支付公钥 ID 与公钥必须成对配置");
    if (!certificatePem && !publicKeyPem) throw new ServiceUnavailableException("请配置一组微信平台证书或微信支付公钥验签材料");

    if (certificatePem) {
      let certificate: X509Certificate;
      try {
        certificate = new X509Certificate(pem(certificatePem));
      } catch {
        throw new ServiceUnavailableException("微信支付平台证书无法解析，请粘贴完整的 PEM 证书（不是公钥或商户证书）");
      }
      const configuredSerial = certificateSerial(certificateSerialValue);
      const actualSerial = certificateSerial(certificate.serialNumber);
      if (configuredSerial !== actualSerial) throw new ServiceUnavailableException(`平台证书序列号不一致：配置为 ${configuredSerial}，证书实际为 ${actualSerial}`);
      if (Date.parse(certificate.validFrom) > Date.now()) throw new ServiceUnavailableException("微信支付平台证书尚未生效");
      if (Date.parse(certificate.validTo) < Date.now()) throw new ServiceUnavailableException("微信支付平台证书已过期，请更新平台证书");
    }
    if (publicKeyPem) {
      if (!/^PUB_KEY_ID_[0-9]+$/u.test(publicKeyId)) throw new ServiceUnavailableException("微信支付公钥 ID 格式无效，应为 PUB_KEY_ID_ 加数字");
      try {
        const publicKey = createPublicKey(pem(publicKeyPem));
        if (publicKey.asymmetricKeyType !== "rsa" || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error("not-rsa-2048");
      } catch {
        throw new ServiceUnavailableException("微信支付公钥无法解析或不是至少 2048 位的 RSA 公钥");
      }
    }
  }


  protected wechatSigningKey(config: TenantIntegrationRuntimeConfig, serial: string): string | undefined {
    const normalized = certificateSerial(serial);
    if (/^PUB_KEY_ID_[0-9]+$/u.test(normalized)) {
      return certificateSerial(config.settings.platformPublicKeyId) === normalized
        ? valueOf(config.credentials.wechatPlatformPublicKey)
        : undefined;
    }
    return certificateSerial(config.settings.platformCertificateSerial) === normalized
      ? valueOf(config.credentials.wechatPlatformCertificate)
      : undefined;
  }


  protected verifyWechatSignedMessage(config: TenantIntegrationRuntimeConfig, serial: string, timestampHeader: string, nonceHeader: string, signature: string, body: string) {
    const key = this.wechatSigningKey(config, serial);
    if (!key || !timestampHeader || !nonceHeader || !signature) return false;
    return verifyRsa(key, `${timestampHeader}\n${nonceHeader}\n${body}\n`, signature);
  }


  protected verifyWechatApiResponse(config: TenantIntegrationRuntimeConfig, response: Response, rawBody: string) {
    const timestampHeader = response.headers.get("Wechatpay-Timestamp") ?? "";
    const nonceHeader = response.headers.get("Wechatpay-Nonce") ?? "";
    const signature = response.headers.get("Wechatpay-Signature") ?? "";
    const serial = response.headers.get("Wechatpay-Serial") ?? "";
    const timestampSeconds = Number(timestampHeader);
    if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
      throw new PaymentProviderUnknownError("微信支付响应时间戳无效");
    }
    try {
      if (!this.verifyWechatSignedMessage(config, serial, timestampHeader, nonceHeader, signature, rawBody)) {
        throw new Error("signature-invalid");
      }
    } catch {
      throw new PaymentProviderUnknownError("微信支付响应验签失败");
    }
  }


  protected async queryAlipayIntent(config: TenantIntegrationRuntimeConfig, merchantOrderNo: string): Promise<ProviderPaymentResult> {
    const params: Record<string, string> = {
      app_id: requiredText(config.settings.appId, "应用 ID"),
      method: "alipay.trade.query",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: alipayTimestamp(),
      version: "1.0",
      biz_content: JSON.stringify({ out_trade_no: merchantOrderNo })
    };
    const response = await fetchJson(requiredText(config.settings.gatewayUrl, "网关地址"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({ ...params, sign: signRsa(valueOf(config.credentials.appPrivateKey), stableFormContent(params)) }).toString()
    });
    const result = (response.alipay_trade_query_response ?? {}) as JsonRecord;
    if (valueOf(result.code) === "40004") return { state: "NOTPAY", paid: false, closed: false, amount: 0, externalTransactionId: "" };
    if (valueOf(result.code) !== "10000") throw new Error(valueOf(result.sub_msg || result.msg || "支付宝查询失败"));
    const state = valueOf(result.trade_status);
    return {
      state,
      paid: ["TRADE_SUCCESS", "TRADE_FINISHED"].includes(state),
      closed: state === "TRADE_CLOSED",
      amount: Number(valueOf(result.total_amount || result.receipt_amount)),
      externalTransactionId: valueOf(result.trade_no)
    };
  }


  protected async closeAlipayIntent(config: TenantIntegrationRuntimeConfig, merchantOrderNo: string) {
    const params: Record<string, string> = {
      app_id: requiredText(config.settings.appId, "应用 ID"),
      method: "alipay.trade.close",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: alipayTimestamp(),
      version: "1.0",
      biz_content: JSON.stringify({ out_trade_no: merchantOrderNo })
    };
    const response = await fetchJson(requiredText(config.settings.gatewayUrl, "网关地址"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({ ...params, sign: signRsa(valueOf(config.credentials.appPrivateKey), stableFormContent(params)) }).toString()
    });
    const result = (response.alipay_trade_close_response ?? {}) as JsonRecord;
    if (valueOf(result.code) !== "10000") throw new PaymentProviderUnknownError("支付宝尚未确认原支付单关闭，请继续查询原交易");
  }


  protected async queryWechatIntent(config: TenantIntegrationRuntimeConfig, merchantOrderNo: string): Promise<ProviderPaymentResult> {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderNo)}?mchid=${encodeURIComponent(requiredText(config.settings.mchid, "商户号"))}`;
    try {
      const response = await this.wechatRequest(config, "GET", path, "");
      const state = valueOf(response.trade_state);
      return {
        state,
        paid: state === "SUCCESS",
        closed: ["CLOSED", "REVOKED", "PAYERROR"].includes(state),
        amount: Number(((response.amount as JsonRecord | undefined)?.total ?? 0)) / 100,
        externalTransactionId: valueOf(response.transaction_id)
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("HTTP 404")) return { state: "NOTPAY", paid: false, closed: false, amount: 0, externalTransactionId: "" };
      throw error;
    }
  }


  protected async closeWechatIntent(config: TenantIntegrationRuntimeConfig, merchantOrderNo: string) {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderNo)}/close`;
    await this.wechatRequest(config, "POST", path, JSON.stringify({ mchid: requiredText(config.settings.mchid, "商户号") }));
  }


  protected async wechatRequest(config: TenantIntegrationRuntimeConfig, method: "GET" | "POST", path: string, body: string) {
    const base = valueOf(config.settings.gatewayUrl || "https://api.mch.weixin.qq.com").replace(/\/$/u, "");
    const requestTimestamp = timestamp();
    const requestNonce = nonce();
    const signature = signRsa(valueOf(config.credentials.merchantPrivateKey), `${method}\n${path}\n${requestTimestamp}\n${requestNonce}\n${body}\n`);
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${requiredText(config.settings.mchid, "商户号")}",nonce_str="${requestNonce}",timestamp="${requestTimestamp}",serial_no="${requiredText(config.credentials.merchantSerialNo, "商户证书序列号")}",signature="${signature}"`;
    return fetchJson(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authorization },
      body: method === "GET" ? undefined : body
    }, 10_000, (response, rawBody) => this.verifyWechatApiResponse(config, response, rawBody));
  }


  protected decryptWechatResource(config: TenantIntegrationRuntimeConfig, resource: JsonRecord) {
    const key = Buffer.from(requiredText(config.credentials.apiV3Key, "API v3 密钥"), "utf8");
    if (key.length !== 32) throw new ServiceUnavailableException("API v3 密钥必须是 32 字节");
    const iv = Buffer.from(requiredText(resource.nonce, "回调 nonce"), "utf8");
    const ciphertext = Buffer.from(requiredText(resource.ciphertext, "回调密文"), "base64");
    const tag = Buffer.from(requiredText(resource.tag, "回调认证标签"), "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    const associatedData = valueOf(resource.associated_data);
    if (associatedData) decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext) as JsonRecord;
  }


  // ===== Stripe(Checkout Session)适配器 =====
  /** Stripe REST 调用:Bearer + 表单编码;可带 Idempotency-Key 让重试不产生重复对象。 */
  protected async stripeRequest(
    config: TenantIntegrationRuntimeConfig,
    method: "GET" | "POST",
    path: string,
    form?: Record<string, string>,
    idempotencyKey?: string
  ): Promise<JsonRecord> {
    const secret = requiredText(config.credentials.secretKey, "Stripe 密钥");
    if (!isStripeLiveKey(secret)) throw new ServiceUnavailableException("当前 Stripe 收单链只接受 live 密钥，测试或未识别模式不能进入实际资金流程");
    const headers: Record<string, string> = { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const body = method === "POST" && form ? new URLSearchParams(form).toString() : undefined;
    return fetchJson(`https://api.stripe.com${path}`, { method, headers, body });
  }
}

export * from "./stripe-signature";
export * from "./payment-webhook-rate-limit";
