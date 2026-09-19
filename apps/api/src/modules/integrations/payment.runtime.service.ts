import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CLIENT_API_VERSION,
  CLIENT_WECHAT_IDENTITY_REQUIRED,
  type ClientMiniProgramPaymentIntentRequest,
  type ClientPaymentIntentRequest,
  type ClientPaymentIntentResponse,
  type ClientWechatJsapiParameters,
  type PaymentReconciliationSummary
} from "@rental-os/shared";
import {
  createHash,
  createDecipheriv,
  createSign,
  createVerify,
  randomBytes,
  randomUUID,
  X509Certificate
} from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { assertOutboundUrl } from "../../common/outbound-url";
import { TenantIntegrationService, type TenantIntegrationRuntimeConfig } from "./tenant-integration.service";
import { RentalFundingService } from "../rental-core/rental-funding.service";
import { rentalPaymentBalance } from "../rental-core/rental-funding-events";
import { roundMoney, toCents } from "./payment-money";

type JsonRecord = Record<string, unknown>;

interface PaymentCallbackInput {
  body?: unknown;
  rawBody?: Buffer;
  headers?: Record<string, unknown>;
}

interface PaymentIntentRow {
  id: string;
  tenantId: string;
  workspaceId: string;
  orderId: string;
  instrument: string;
  provider: string;
  method: string;
  amount: Prisma.Decimal;
  currency: string;
  merchantOrderNo: string;
  status: string;
  checkoutUrl: string | null;
  externalTransactionId: string | null;
  failureReason: string | null;
  expiresAt: Date;
  paidAt: Date | null;
}

type PaymentRefundRow = Prisma.RentalPaymentRefundGetPayload<object>;

interface ProviderRefundResult {
  status: "succeeded" | "accepted" | "failed";
  externalRefundId?: string;
  externalStatus?: string;
  responseJson?: JsonRecord;
  confirmedTotal?: number;
}

/** 金额取整统一走 rental-money.ts 的 roundMoney（README §4.3）；本文件不再自带实现。 */
const money = roundMoney;

/** 支付单本地过期时长；同一个值同时传给第三方（time_expire），让两边过期一致。 */
const PAYMENT_INTENT_TTL_MS = 15 * 60 * 1000;

/** 退款在第三方查不到超过这个时长，说明申请从未落到平台，可以安全判失败并释放额度。 */
const REFUND_NOT_FOUND_TERMINAL_MS = 24 * 60 * 60 * 1000;

/** 回调候选配置缓存时长：回调是公开入口，不能每次请求都全表扫描并解密所有租户密钥。 */
const CALLBACK_CONFIG_CACHE_MS = 30_000;

function valueOf(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function certificateSerial(value: unknown) {
  return valueOf(value).trim().toUpperCase();
}

function requiredText(value: unknown, name: string) {
  const result = valueOf(value).trim();
  if (!result) throw new ServiceUnavailableException(`支付平台缺少配置：${name}`);
  return result;
}

function pem(value: unknown) {
  return requiredText(value, "证书或私钥").replace(/\\n/gu, "\n");
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function nonce() {
  return randomBytes(16).toString("hex");
}

function timestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

function alipayTimestamp() {
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

function signRsa(privateKey: string, content: string) {
  const signer = createSign("RSA-SHA256");
  signer.update(content);
  signer.end();
  return signer.sign(pem(privateKey), "base64");
}

function verifyRsa(publicKey: string, content: string, signature: string) {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(content);
  verifier.end();
  return verifier.verify(pem(publicKey), signature, "base64");
}

function stableFormContent(values: Record<string, unknown>, exclude: string[] = []) {
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

class PaymentProviderHttpError extends Error {
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

function isProviderCallUnknown(error: unknown) {
  if (error instanceof PaymentProviderUnknownError) return true;
  if (error instanceof PaymentProviderDefinitiveError) return false;
  if (!(error instanceof PaymentProviderHttpError)) return false;
  return [408, 425, 429].includes(error.status) || error.status >= 500;
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

async function fetchJson(url: string, init: RequestInit, timeoutMs = 10_000): Promise<JsonRecord> {
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
    let body: JsonRecord;
    try {
      body = JSON.parse(raw) as JsonRecord;
    } catch {
      body = { raw: raw.slice(0, 500) };
    }
    if (!response.ok) throw new PaymentProviderHttpError(response.status, `HTTP ${response.status}: ${valueOf(body.message || body.msg || body.raw)}`, valueOf(body.code).toUpperCase());
    return body;
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class PaymentRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: TenantIntegrationService,
    private readonly funding: RentalFundingService
  ) {}

  private readonly callbackConfigCache = new Map<string, { expiresAt: number; value: Promise<Array<TenantIntegrationRuntimeConfig & { tenantId: string }>> }>();

  /**
   * 回调候选配置按平台缓存 30 秒。回调是无鉴权公开入口，每次都全表扫描并解密所有租户
   * 密钥会被伪造请求放大成 DB + 解密压力。30 秒内新启用/新通过测试的配置收不到回调，
   * 由查单补偿兜底；停用的配置最多多被验签 30 秒，验签通过也只会推进它自己的支付单。
   */
  private callbackConfigs(provider: "alipay" | "wechat_pay") {
    const now = Date.now();
    const cached = this.callbackConfigCache.get(provider);
    if (cached && cached.expiresAt > now) return cached.value;
    const value = this.integrations.runtimeConfigsForCallback(provider).catch((error: unknown) => {
      this.callbackConfigCache.delete(provider);
      throw error;
    });
    this.callbackConfigCache.set(provider, { expiresAt: now + CALLBACK_CONFIG_CACHE_MS, value });
    return value;
  }

  /** 测试与配置保存后可显式清空缓存。 */
  clearCallbackConfigCache() {
    this.callbackConfigCache.clear();
  }

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
      return "已验证微信支付连接与平台证书（仅查询随机交易号，未创建或扣款）。";
    }
    throw new ServiceUnavailableException("未实现的支付平台适配器");
  }

  /**
   * 微信回调验签依赖三样本地材料：平台证书能解析、其序列号与配置的
   * platformCertificateSerial 一致（否则回调按 Wechatpay-Serial 永远匹配不到）、
   * apiV3Key 恰好 32 字节（AES-256-GCM 解密要求）。任何一项错误都让回调静默失败。
   */
  assertWechatCallbackMaterial(config: TenantIntegrationRuntimeConfig) {
    const key = Buffer.from(requiredText(config.credentials.apiV3Key, "API v3 密钥"), "utf8");
    if (key.length !== 32) throw new ServiceUnavailableException(`API v3 密钥必须是 32 字节，当前 ${key.length} 字节`);
    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(pem(config.credentials.wechatPlatformCertificate));
    } catch {
      throw new ServiceUnavailableException("微信支付平台证书无法解析，请粘贴完整的 PEM 证书（不是公钥或商户证书）");
    }
    const configuredSerial = certificateSerial(config.settings.platformCertificateSerial);
    const actualSerial = certificateSerial(certificate.serialNumber);
    if (configuredSerial !== actualSerial) {
      throw new ServiceUnavailableException(`平台证书序列号不一致：配置为 ${configuredSerial}，证书实际为 ${actualSerial}`);
    }
    if (Date.parse(certificate.validTo) < Date.now()) throw new ServiceUnavailableException("微信支付平台证书已过期，请更新平台证书");
  }

  /**
   * MP-07：小程序 JSAPI 支付。openid 只能来自服务端可信绑定（ClientWechatIdentity），
   * 由调用方（ClientApiService）按会话解析后传入；缺少时用稳定错误码 409 引导先绑定微信，
   * 绝不从请求体、手机号或 Native code_url 推导。JSAPI 参数由商户私钥即时签名，
   * 支付单只保存 prepay_id（可重新签名），不保存一次性签名。
   */
  async createMiniProgramPaymentIntent(
    tenantId: string,
    workspaceId: string,
    orderId: string,
    input: ClientMiniProgramPaymentIntentRequest,
    identity?: { openId: string; appId: string }
  ): Promise<ClientPaymentIntentResponse> {
    if (input.instrument !== "rental") throw new BadRequestException("小程序支付仅支持租金及费用");
    const key = input.idempotencyKey?.trim();
    if (!key || key.length > 191) throw new BadRequestException("支付必须带有效幂等键");
    if (!identity) {
      throw new HttpException({ statusCode: HttpStatus.CONFLICT, code: CLIENT_WECHAT_IDENTITY_REQUIRED, message: "小程序支付需要先绑定微信身份：请用微信手机号登录，或在“我的”中绑定微信" }, HttpStatus.CONFLICT);
    }
    return this.createPaymentIntent(tenantId, workspaceId, orderId, { instrument: "rental", method: "wechat_pay", idempotencyKey: key }, { tradeType: "JSAPI", openId: identity.openId, appId: identity.appId });
  }

  async createPaymentIntent(
    tenantId: string,
    workspaceId: string,
    orderId: string,
    input: ClientPaymentIntentRequest,
    jsapi?: { tradeType: "JSAPI"; openId: string; appId: string }
  ): Promise<ClientPaymentIntentResponse> {
    if (input.instrument !== "rental") {
      throw new BadRequestException("支付宝和微信支付首期只支持租金及费用；押金、预授权仍须走对应资金能力");
    }
    if (input.method !== "alipay" && input.method !== "wechat_pay") {
      throw new BadRequestException("暂不支持该支付方式");
    }
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 191) throw new BadRequestException("支付必须带有效幂等键");

    const existing = await this.prisma.rentalPaymentIntent.findUnique({
      where: { tenantId_workspaceId_orderId_instrument_idempotencyHash: { tenantId, workspaceId, orderId, instrument: input.instrument, idempotencyHash: sha256(idempotencyKey) } }
    });
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey) throw new ConflictException("支付幂等键摘要冲突，请更换幂等键");
      if (existing.method !== input.method) throw new ConflictException("支付幂等键已用于其他支付方式，请更换幂等键");
      return this.toResponse(existing, jsapi ? await this.jsapiParameters(tenantId, existing, jsapi.openId) : undefined);
    }

    // 新建支付必须遵循租户当前明确选择的默认平台；查单、退款和关闭则
    // 继续按原支付单保存的平台恢复，不能因默认平台切换而丢失历史事实。
    const config = await this.integrations.runtimeConfig("payment", tenantId, input.method, { requireDefault: true });
    if (!config) throw new ServiceUnavailableException(`尚未启用${input.method === "alipay" ? "支付宝" : "微信支付"}`);
    if (jsapi && requiredText(config.settings.appId, "应用 ID") !== jsapi.appId) {
      // 支付配置里的应用 ID 与小程序 AppID 不一致：openid 属于另一个应用，微信会拒绝，且不能拿别的应用的 openid 下单。
      throw new ServiceUnavailableException("微信支付配置的应用 ID 与小程序 AppID 不一致，请商户在第三方服务中核对");
    }
    let prepared: { intent: Prisma.RentalPaymentIntentGetPayload<object>; orderNo: string; amount: number; replayed: boolean };
    let expiredIntent: Prisma.RentalPaymentIntentGetPayload<object> | undefined;
    try {
      prepared = await this.prisma.$transaction(async (tx) => {
        // 同一订单的待支付单必须串行创建。仅靠“先查后写”会让两个不同幂等键
        // 同时通过检查，最终产生两笔真实支付单。
        const rows = await tx.$queryRaw<Array<{ id: string; orderNo: string; finalPayableAmount: Prisma.Decimal; currency: string }>>(Prisma.sql`
          SELECT id, orderNo, finalPayableAmount, currency
            FROM rental_orders
           WHERE id = ${orderId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
           FOR UPDATE
        `);
        const order = rows[0];
        if (!order) throw new NotFoundException("订单不存在或不属于当前经营空间");

        // runtimeConfig 在事务外读取；这里锁同一份配置并重新确认仍启用，
        // 与停用配置的检查形成互斥，避免停用提交后仍落下一笔 pending 支付单。
        await this.integrations.assertEnabledInTransaction(tx, tenantId, "payment", config.provider, { requireDefault: true });

        const existingInside = await tx.rentalPaymentIntent.findUnique({
          where: { tenantId_workspaceId_orderId_instrument_idempotencyHash: { tenantId, workspaceId, orderId, instrument: input.instrument, idempotencyHash: sha256(idempotencyKey) } }
        });
        if (existingInside) {
          if (existingInside.idempotencyKey !== idempotencyKey) throw new ConflictException("支付幂等键摘要冲突，请更换幂等键");
          if (existingInside.method !== input.method) throw new ConflictException("支付幂等键已用于其他支付方式，请更换幂等键");
          return { intent: existingInside, orderNo: order.orderNo, amount: Number(existingInside.amount), replayed: true };
        }

        const funding = await this.funding.listEvents(tenantId, workspaceId, orderId, tx);
        const amount = money(funding.rental.balance + funding.rental.pendingExtensionAmount);
        if (amount <= 0.005) throw new ConflictException("当前订单没有待支付的租金或费用");
        if (String(order.currency).toUpperCase() !== "CNY") throw new BadRequestException("支付宝和微信支付首期只支持人民币订单");
        const pending = await tx.rentalPaymentIntent.findFirst({
          where: { tenantId, workspaceId, orderId, instrument: input.instrument, status: { in: ["pending", "verified_pending_funding"] } },
          orderBy: { createdAt: "desc" }
        });
        if (pending) {
          // 过期的 pending 支付单不该继续挡住新支付：客户扫码后放弃、15 分钟后再来，
          // 应该直接拿到新单。平台侧已带 time_expire，本地只需在同一事务里关闭旧单；
          // verified_pending_funding 说明钱已到、资金事件未落，绝不能当过期处理。
          if (pending.status !== "pending" || pending.expiresAt.getTime() > Date.now()) {
            throw new ConflictException("该订单已有待完成的支付，请先完成或关闭原支付");
          }
          await tx.rentalPaymentIntent.updateMany({
            where: { id: pending.id, status: "pending" },
            data: { status: "closed", failureReason: "expired" }
          });
          expiredIntent = pending;
        }

        const merchantOrderNo = `RO${Date.now().toString(36).toUpperCase()}${randomUUID().replace(/-/gu, "").slice(0, 12).toUpperCase()}`;
        const expiresAt = new Date(Date.now() + PAYMENT_INTENT_TTL_MS);
        const intent = await tx.rentalPaymentIntent.create({
          data: {
            tenantId,
            workspaceId,
            orderId,
            instrument: input.instrument,
            provider: config.provider,
            method: input.method,
            amount: new Prisma.Decimal(amount),
            currency: order.currency,
            merchantOrderNo,
            idempotencyKey,
            idempotencyHash: sha256(idempotencyKey),
            status: "pending",
            expiresAt
          }
        });
        return { intent, orderNo: order.orderNo, amount, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("支付单正在被其他请求创建，请稍后重试");
      }
      throw error;
    }
    if (prepared.replayed) return this.toResponse(prepared.intent, jsapi ? await this.jsapiParameters(tenantId, prepared.intent, jsapi.openId, config) : undefined);
    if (expiredIntent) {
      // 平台侧关单是尽力而为：本地已经关闭并让出位置，平台那边 time_expire 也会自行关闭。
      await this.closeProviderIntentBestEffort(tenantId, config, expiredIntent);
    }
    const intent = prepared.intent;
    const orderNo = prepared.orderNo;
    const amount = prepared.amount;

    try {
      const result = input.method === "alipay"
        ? await this.createAlipayIntent(config, intent, orderNo)
        : jsapi
          ? await this.createWechatJsapiIntent(config, intent, orderNo, jsapi.openId)
          : await this.createWechatIntent(config, intent, orderNo);
      const updated = await this.prisma.rentalPaymentIntent.update({
        where: { id: intent.id },
        data: { checkoutUrl: result.checkoutUrl, responseJson: result.responseJson as Prisma.InputJsonValue, failureReason: null }
      });
      await this.log(tenantId, config, "create_payment_intent", "success", {
        orderId,
        intentId: intent.id,
        merchantOrderNo: intent.merchantOrderNo,
        amount,
        tradeType: jsapi ? "JSAPI" : input.method === "alipay" ? "PAGE" : "NATIVE"
      }, { responseCode: result.responseCode });
      return this.toResponse(updated, jsapi ? await this.jsapiParameters(tenantId, updated, jsapi.openId, config) : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "支付平台调用失败";
      const unknown = isProviderCallUnknown(error);
      const failureReason = unknown ? "支付请求结果未知，请查询支付状态后再重试" : message.slice(0, 500);
      await this.prisma.rentalPaymentIntent.update({ where: { id: intent.id }, data: { status: unknown ? "pending" : "failed", failureReason } });
      await this.log(tenantId, config, "create_payment_intent", unknown ? "pending" : "failed", { orderId, intentId: intent.id, merchantOrderNo: intent.merchantOrderNo, amount }, undefined, failureReason);
      if (unknown && !(error instanceof PaymentProviderUnknownError)) throw new PaymentProviderUnknownError();
      throw error instanceof ServiceUnavailableException || error instanceof BadRequestException ? error : new ServiceUnavailableException(`支付平台调用失败：${message.slice(0, 180)}`);
    }
  }

  async listPaymentIntents(tenantId: string, workspaceId: string, orderId: string) {
    const rows = await this.prisma.rentalPaymentIntent.findMany({
      where: { tenantId, workspaceId, orderId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => this.toResponse(row));
  }

  async listPaymentRefunds(tenantId: string, workspaceId: string, orderId: string, intentId: string) {
    await this.requirePaymentIntent(tenantId, workspaceId, orderId, intentId);
    const rows = await this.prisma.rentalPaymentRefund.findMany({
      where: { tenantId, workspaceId, orderId, paymentIntentId: intentId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => this.toRefundResponse(row));
  }

  /**
   * 创建真实退款申请。退款单先落库并以幂等键占住额度，再调用第三方；
   * 网络未知结果不会直接标记失败，必须复用同一退款单查询，避免重复退款。
   */
  async createPaymentRefund(
    tenantId: string,
    workspaceId: string,
    orderId: string,
    intentId: string,
    input: { amount: number; reason: string; idempotencyKey: string },
    operator?: string
  ) {
    const reason = input.reason?.trim();
    const idempotencyKey = input.idempotencyKey?.trim();
    const amount = money(Number(input.amount));
    if (!reason) throw new BadRequestException("退款原因不能为空");
    if (!idempotencyKey || idempotencyKey.length > 191) throw new BadRequestException("退款必须带有效幂等键");
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException("退款金额必须为正数");

    // 先按完整作用域确认支付单，再查幂等记录。否则攻击者只要拿到另一个租户的
    // intentId，就可能在幂等回放分支读到别的租户退款单摘要。
    const intent = await this.requirePaymentIntent(tenantId, workspaceId, orderId, intentId);
    const existing = await this.prisma.rentalPaymentRefund.findFirst({
      where: { tenantId, workspaceId, orderId, paymentIntentId: intentId, idempotencyHash: sha256(idempotencyKey) }
    });
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey) throw new ConflictException("退款幂等键摘要冲突，请更换幂等键");
      if (money(Number(existing.amount)) !== amount || existing.reason !== reason) {
        throw new ConflictException("相同退款幂等键已用于不同金额或原因");
      }
      return this.toRefundResponse(existing);
    }

    if (intent.status !== "paid" || !intent.externalTransactionId) throw new ConflictException("只有已入账且有第三方交易号的支付单才能退款");
    const config = await this.integrations.runtimeConfig("payment", tenantId, intent.method as "alipay" | "wechat_pay");
    if (!config) throw new ServiceUnavailableException("原支付平台未启用，无法发起退款");

    const prepared = await this.prisma.$transaction(async (tx) => {
      // 退款额度属于订单级事实，而不是支付单级事实；同一订单有多个支付单时，
      // 必须锁订单行，避免两笔退款并发各自读到同一笔待退余额。
      await tx.$queryRaw(Prisma.sql`
        SELECT id
          FROM rental_orders
         WHERE id = ${orderId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
         FOR UPDATE
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT id
          FROM rental_payment_intents
         WHERE id = ${intentId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND orderId = ${orderId}
         FOR UPDATE
      `);
      const locked = await tx.rentalPaymentIntent.findFirst({
        where: { id: intentId, tenantId, workspaceId, orderId }
      });
      if (!locked) throw new NotFoundException("支付单不存在");
      if (locked.status !== "paid" || !locked.externalTransactionId) throw new ConflictException("支付单尚未完成真实入账");
      // 与 createPaymentIntent 相同：锁配置行并重新确认仍启用，让“停用平台”的检查
      // 与本次退款单落库互斥。否则停用检查通过后这里仍能插入一笔 pending 退款，
      // 形成一个已停用平台上永远无法查询/恢复的孤儿。退款是对既有事实的处理，
      // 不要求平台仍是默认出口。
      await this.integrations.assertEnabledInTransaction(tx, tenantId, "payment", locked.provider as "alipay" | "wechat_pay");

      // 外层幂等查询与本事务之间存在竞态；唯一键只负责兜底，不能把并发重试变成 500。
      const duplicate = await tx.rentalPaymentRefund.findFirst({
        where: { tenantId, workspaceId, orderId, paymentIntentId: intentId, idempotencyHash: sha256(idempotencyKey) }
      });
      if (duplicate) {
        if (money(Number(duplicate.amount)) !== amount || duplicate.reason !== reason) {
          throw new ConflictException("相同退款幂等键已用于不同金额或原因");
        }
        return { replay: true as const, refund: duplicate, intent: locked, confirmedTotal: 0 };
      }

      const funding = await this.funding.listEvents(tenantId, workspaceId, orderId, tx);
      const pendingRefunds = await tx.rentalPaymentRefund.findMany({
        where: { tenantId, workspaceId, orderId, status: { in: ["pending", "accepted", "funding_pending"] } },
        select: { amount: true, status: true, paymentIntentId: true }
      });
      const alreadyRequested = money(pendingRefunds.reduce((sum, row) => sum + Number(row.amount), 0));
      const remainingApproved = money(Math.max(0, -funding.rental.balance) - alreadyRequested);
      const intentAlreadyRequested = money(pendingRefunds
        .filter((row) => row.paymentIntentId === intentId)
        .reduce((sum, row) => sum + Number(row.amount), 0));
      const remainingIntent = money(Math.max(0, Number(locked.amount) - intentAlreadyRequested));
      const maxRefundable = money(Math.max(0, Math.min(remainingApproved, remainingIntent)));
      if (amount > maxRefundable + 0.005) {
        throw new ConflictException(`退款金额超过当前可退余额，最多可退 ¥${maxRefundable.toFixed(2)}`);
      }

      const merchantRefundNo = `RR${Date.now().toString(36).toUpperCase()}${randomUUID().replace(/-/gu, "").slice(0, 14).toUpperCase()}`;
      const refund = await tx.rentalPaymentRefund.create({
        data: {
          tenantId,
          workspaceId,
          orderId,
          paymentIntentId: intentId,
          provider: locked.provider,
          method: locked.method,
          amount: new Prisma.Decimal(amount),
          currency: locked.currency,
          merchantRefundNo,
          idempotencyKey,
          idempotencyHash: sha256(idempotencyKey),
          status: "pending",
          reason,
          requestedBy: operator ?? null
        }
      });
      return {
        replay: false as const,
        refund,
        intent: locked,
        confirmedTotal: money((await tx.rentalPaymentRefund.findMany({
          where: { tenantId, workspaceId, orderId, paymentIntentId: intentId, status: { in: ["succeeded", "funding_pending"] } },
          select: { amount: true }
        })).reduce((sum, row) => sum + Number(row.amount), 0))
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (prepared.replay) return this.toRefundResponse(prepared.refund);

    let result: { status: string; response: unknown; failureReason?: string };
    try {
      const outcome = await this.submitProviderRefund(config, prepared.intent, prepared.refund, prepared.confirmedTotal);
      result = await this.applyProviderRefundOutcome(tenantId, workspaceId, orderId, prepared.refund.id, outcome, operator);
    } catch (error) {
      result = await this.markRefundProviderCallPending(
        tenantId,
        workspaceId,
        orderId,
        prepared.refund.id,
        error
      );
    }
    await this.log(tenantId, config, "create_payment_refund", result.status === "failed" ? "failed" : "success", {
      orderId,
      intentId,
      refundId: prepared.refund.id,
      merchantRefundNo: prepared.refund.merchantRefundNo,
      amount
    }, result.response as JsonRecord, result.status === "failed" ? result.failureReason : undefined);
    return result.response;
  }

  async refreshPaymentRefund(tenantId: string, workspaceId: string, orderId: string, intentId: string, refundId: string) {
    const refund = await this.prisma.rentalPaymentRefund.findFirst({
      where: { id: refundId, tenantId, workspaceId, orderId, paymentIntentId: intentId }
    });
    if (!refund) throw new NotFoundException("退款单不存在");
    if (refund.status === "succeeded" && refund.fundedAt) return this.toRefundResponse(refund);
    if (refund.status === "failed" || refund.status === "closed") return this.toRefundResponse(refund);
    const intent = await this.requirePaymentIntent(tenantId, workspaceId, orderId, intentId);
    const config = await this.integrations.runtimeConfig("payment", tenantId, intent.method as "alipay" | "wechat_pay", { requireLiveTest: false });
    if (!config) throw new ServiceUnavailableException("原支付平台未启用，无法查询退款");
    const confirmedTotal = await this.confirmedRefundTotal(tenantId, workspaceId, intentId, refund.id);
    let result: { status: string; response: unknown; failureReason?: string };
    try {
      const outcome = await this.queryProviderRefund(config, intent, refund, confirmedTotal);
      result = await this.applyProviderRefundOutcome(tenantId, workspaceId, orderId, refund.id, outcome);
    } catch (error) {
      result = await this.markRefundProviderCallPending(
        tenantId,
        workspaceId,
        orderId,
        refund.id,
        error
      );
    }
    await this.log(tenantId, config, "query_payment_refund", result.status === "failed" ? "failed" : "success", {
      orderId,
      intentId,
      refundId: refund.id,
      merchantRefundNo: refund.merchantRefundNo
    }, result.response as JsonRecord, result.status === "failed" ? result.failureReason : undefined);
    return result.response;
  }

  async getPaymentIntent(tenantId: string, workspaceId: string, orderId: string, intentId: string, jsapiOpenId?: string) {
    const row = await this.prisma.rentalPaymentIntent.findFirst({ where: { id: intentId, tenantId, workspaceId, orderId } });
    if (!row) throw new NotFoundException("支付单不存在");
    return this.toResponse(row, jsapiOpenId ? await this.jsapiParameters(tenantId, row, jsapiOpenId) : undefined);
  }

  /**
   * 为仍待支付的 JSAPI 支付单重新签名（prepay_id 两小时有效）。签名只在响应中出现，不落库；
   * 支付单不是 JSAPI、已过期或 openid 与创建时不一致时不返回参数，客户端据此不弹收银台。
   */
  private async jsapiParameters(tenantId: string, row: PaymentIntentRow & { responseJson?: unknown }, openId: string, config?: TenantIntegrationRuntimeConfig): Promise<ClientWechatJsapiParameters | undefined> {
    if (row.status !== "pending" || row.method !== "wechat_pay" || row.expiresAt.getTime() <= Date.now()) return undefined;
    const response = (row.responseJson ?? {}) as JsonRecord;
    const prepayId = valueOf(response.prepayId);
    if (!prepayId || valueOf(response.tradeType) !== "JSAPI" || valueOf(response.openId) !== openId) return undefined;
    const runtime = config ?? await this.integrations.runtimeConfig("payment", tenantId, "wechat_pay", { requireLiveTest: false });
    if (!runtime) return undefined;
    const appId = requiredText(runtime.settings.appId, "应用 ID");
    const timeStamp = timestamp();
    const nonceStr = nonce();
    const pkg = `prepay_id=${prepayId}`;
    const paySign = signRsa(valueOf(runtime.credentials.merchantPrivateKey), `${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`);
    return { timeStamp, nonceStr, package: pkg, signType: "RSA", paySign };
  }

  /**
   * 对账只处理仍可能改变外部状态的记录，且每一笔独立隔离失败。
   *
   * 这里故意复用单笔 refresh，而不是在批量入口复制支付入账/退款入账逻辑：
   * 回调、客户主动查询和运营批量对账必须共享同一套金额校验、幂等和资金事件门禁。
   * “查询失败”只写入本次结果，不把未知状态改成失败，也不影响后续记录。
   */
  async reconcileCurrentWorkspace(
    tenantId: string,
    workspaceId: string,
    limit = 50
  ): Promise<PaymentReconciliationSummary> {
    const take = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 50, 100));
    const [intents, refunds] = await Promise.all([
      this.prisma.rentalPaymentIntent.findMany({
        where: { tenantId, workspaceId, status: { in: ["pending", "verified_pending_funding", "funding_failed"] } },
        orderBy: { updatedAt: "asc" },
        take
      }),
      this.prisma.rentalPaymentRefund.findMany({
        where: { tenantId, workspaceId, status: { in: ["pending", "accepted", "funding_pending"] } },
        orderBy: { updatedAt: "asc" },
        take
      })
    ]);
    const candidates = [
      ...intents.map((row) => ({ kind: "payment_intent" as const, id: row.id, orderId: row.orderId, previousStatus: row.status, updatedAt: row.updatedAt.getTime() })),
      ...refunds.map((row) => ({ kind: "refund" as const, id: row.id, orderId: row.orderId, previousStatus: row.status, intentId: row.paymentIntentId, updatedAt: row.updatedAt.getTime() }))
    ].sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id)).slice(0, take);
    const results: PaymentReconciliationSummary["results"] = [];

    for (const candidate of candidates) {
      try {
        const current = candidate.kind === "payment_intent"
          ? await this.refreshPaymentIntent(tenantId, workspaceId, candidate.orderId, candidate.id)
          : await this.refreshPaymentRefund(tenantId, workspaceId, candidate.orderId, candidate.intentId, candidate.id);
        const status = typeof current === "object" && current !== null && "status" in current
          ? String((current as { status: unknown }).status)
          : "unknown";
        results.push({
          kind: candidate.kind,
          id: candidate.id,
          orderId: candidate.orderId,
          previousStatus: candidate.previousStatus,
          status
        });
      } catch (error) {
        results.push({
          kind: candidate.kind,
          id: candidate.id,
          orderId: candidate.orderId,
          previousStatus: candidate.previousStatus,
          status: "reconcile_error",
          error: (error instanceof Error ? error.message : String(error)).slice(0, 240)
        });
      }
    }

    return {
      scanned: candidates.length,
      processed: results.length,
      paid: results.filter((row) => row.kind === "payment_intent" && row.status === "paid").length,
      closed: results.filter((row) => row.kind === "payment_intent" && row.status === "closed").length,
      refunded: results.filter((row) => row.kind === "refund" && row.status === "succeeded").length,
      pending: results.filter((row) => ["pending", "accepted", "funding_pending"].includes(row.status)).length,
      // funding_failed 表示第三方已确认支付、但内部资金事件未完成，
      // 不能被当成普通 pending：它需要运营恢复资金入账，必须在失败待恢复数中显式暴露。
      failed: results.filter((row) => ["failed", "funding_failed", "reconcile_error"].includes(row.status)).length,
      results
    };
  }

  /**
   * 查询补偿不是收款依据的替代品，而是回调丢失时的主动恢复入口。
   * 只有提供方查询结果明确为成功，才会复用同一套金额校验和资金事件入账。
   */
  async refreshPaymentIntent(tenantId: string, workspaceId: string, orderId: string, intentId: string, jsapiOpenId?: string) {
    const intent = await this.prisma.rentalPaymentIntent.findFirst({ where: { id: intentId, tenantId, workspaceId, orderId } });
    if (!intent) throw new NotFoundException("支付单不存在");
    if (["paid", "closed"].includes(intent.status)) return this.toResponse(intent);
    const config = await this.integrations.runtimeConfig("payment", tenantId, intent.method as "alipay" | "wechat_pay", { requireLiveTest: false });
    if (!config) throw new ServiceUnavailableException("支付平台已停用，无法查询支付状态");
    const result = intent.method === "alipay"
      ? await this.queryAlipayIntent(config, intent.merchantOrderNo)
      : await this.queryWechatIntent(config, intent.merchantOrderNo);
    if (result.paid) {
      this.assertPaidAmount(result.amount, Number(intent.amount));
      await this.settleVerifiedPayment({
        tenantId,
        provider: intent.provider as "alipay" | "wechat_pay",
        eventId: `query:${intent.merchantOrderNo}:${result.externalTransactionId || "paid"}`,
        externalTransactionId: result.externalTransactionId,
        intentId: intent.id,
        amount: result.amount,
        payloadHash: sha256(JSON.stringify({ source: "query", merchantOrderNo: intent.merchantOrderNo, state: result.state }))
      });
    } else if (result.closed) {
      // 查询与异步回调可能并发；关闭结果不能覆盖已经入账的支付。
      await this.prisma.rentalPaymentIntent.updateMany({
        where: { id: intent.id, tenantId, status: { in: ["pending", "verified_pending_funding"] } },
        data: { status: "closed", failureReason: "第三方支付单已关闭" }
      });
    }
    await this.log(tenantId, config, "query_payment_intent", "success", { intentId, merchantOrderNo: intent.merchantOrderNo }, { state: result.state });
    return this.getPaymentIntent(tenantId, workspaceId, orderId, intentId, jsapiOpenId);
  }

  async closePaymentIntent(tenantId: string, workspaceId: string, orderId: string, intentId: string) {
    const intent = await this.prisma.rentalPaymentIntent.findFirst({ where: { id: intentId, tenantId, workspaceId, orderId } });
    if (!intent) throw new NotFoundException("支付单不存在");
    if (intent.status === "paid") throw new ConflictException("支付已入账，不能关闭支付单");
    if (intent.status === "closed") return this.toResponse(intent);
    // 关单不会移动资金，只是终止一笔未付款的待支付单，与查单、退款查询同属“处理既有事实”。
    // 保存配置会把 lastTestStatus 重置为 not_tested；如果这里仍要求 passed+live，
    // 商户改一次配置之后所有客户都关不掉旧支付单，只能等 15 分钟过期。
    const config = await this.integrations.runtimeConfig("payment", tenantId, intent.method as "alipay" | "wechat_pay", { requireLiveTest: false });
    if (!config) throw new ServiceUnavailableException("支付平台已停用，无法关闭支付单");
    if (intent.method === "alipay") await this.closeAlipayIntent(config, intent.merchantOrderNo);
    else await this.closeWechatIntent(config, intent.merchantOrderNo);
    // 关闭请求和支付回调之间存在竞态；只允许从未入账状态转为 closed，
    // 不能把回调已经推进的 paid 状态覆盖掉。
    await this.prisma.rentalPaymentIntent.updateMany({
      where: { id: intent.id, tenantId, status: { in: ["pending", "verified_pending_funding"] } },
      data: { status: "closed", failureReason: "客户主动关闭支付" }
    });
    const updated = await this.prisma.rentalPaymentIntent.findFirst({ where: { id: intent.id, tenantId, workspaceId, orderId } });
    if (!updated) throw new NotFoundException("支付单不存在");
    await this.log(tenantId, config, "close_payment_intent", "success", { intentId, merchantOrderNo: intent.merchantOrderNo });
    return this.toResponse(updated);
  }

  /**
   * 平台侧关单的尽力而为版本：本地状态已经先行推进，这里失败只记日志。
   * 支付宝 40004（交易不存在）与微信 404 都视为“无需关闭”，由 closeXxxIntent/fetchJson 内部处理。
   */
  private async closeProviderIntentBestEffort(tenantId: string, config: TenantIntegrationRuntimeConfig, intent: PaymentIntentRow) {
    try {
      if (intent.method === "alipay") await this.closeAlipayIntent(config, intent.merchantOrderNo);
      else await this.closeWechatIntent(config, intent.merchantOrderNo);
      await this.log(tenantId, config, "close_payment_intent", "success", { intentId: intent.id, merchantOrderNo: intent.merchantOrderNo, reason: "expired" });
    } catch (error) {
      await this.log(tenantId, config, "close_payment_intent", "failed", { intentId: intent.id, merchantOrderNo: intent.merchantOrderNo, reason: "expired" }, undefined, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 过期待支付单的收口任务（由调度器按空间调用）。
   *
   * 本地 expiresAt 与平台 time_expire 是同一个值，但两边时钟和回调都不可靠：
   * 客户可能在最后一秒付款、平台回调可能丢失。所以每一笔都**先查平台**——
   * 平台说已付，就走与回调/查单完全相同的 settleVerifiedPayment 入账，绝不因为
   * 本地过期就把已收的钱标成关闭；平台说未付或查不到，才关闭（平台侧尽力关单）。
   * 单笔失败只记录，不影响其余支付单。
   */
  async expireStalePaymentIntents(tenantId: string, workspaceId: string, take = 50) {
    const limit = Math.max(1, Math.min(Number.isFinite(take) ? Math.floor(take) : 50, 200));
    const stale = await this.prisma.rentalPaymentIntent.findMany({
      where: { tenantId, workspaceId, status: "pending", expiresAt: { lt: new Date() } },
      orderBy: { expiresAt: "asc" },
      take: limit
    });
    const summary = { scanned: stale.length, closed: 0, paid: 0, errors: [] as Array<{ intentId: string; error: string }> };
    for (const intent of stale) {
      try {
        const config = await this.integrations.runtimeConfig("payment", tenantId, intent.method as "alipay" | "wechat_pay", { requireLiveTest: false });
        if (!config) throw new ServiceUnavailableException("支付平台已停用，无法确认过期支付单");
        const result = intent.method === "alipay"
          ? await this.queryAlipayIntent(config, intent.merchantOrderNo)
          : await this.queryWechatIntent(config, intent.merchantOrderNo);
        if (result.paid) {
          this.assertPaidAmount(result.amount, Number(intent.amount));
          await this.settleVerifiedPayment({
            tenantId,
            provider: intent.provider as "alipay" | "wechat_pay",
            eventId: `query:${intent.merchantOrderNo}:${result.externalTransactionId || "paid"}`,
            externalTransactionId: result.externalTransactionId,
            intentId: intent.id,
            amount: result.amount,
            payloadHash: sha256(JSON.stringify({ source: "expire", merchantOrderNo: intent.merchantOrderNo, state: result.state }))
          });
          summary.paid += 1;
          continue;
        }
        if (!result.closed) await this.closeProviderIntentBestEffort(tenantId, config, intent);
        const updated = await this.prisma.rentalPaymentIntent.updateMany({
          where: { id: intent.id, tenantId, status: "pending" },
          data: { status: "closed", failureReason: "expired" }
        });
        if (updated.count === 1) summary.closed += 1;
      } catch (error) {
        summary.errors.push({ intentId: intent.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 240) });
      }
    }
    return summary;
  }

  async handleAlipayCallback(body: unknown) {
    const values = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const appId = valueOf(values.app_id);
    const candidates = (await this.callbackConfigs("alipay"))
      .filter((item) => valueOf(item.settings.appId) === appId);
    if (candidates.length === 0) throw new UnauthorizedException("支付宝回调商户不存在");
    const signature = valueOf(values.sign);
    const signedContent = stableFormContent(values, ["sign", "sign_type"]);
    let verified = false;
    for (const config of candidates) {
      try {
        if (!signature || !verifyRsa(valueOf(config.credentials.alipayPublicKey), signedContent, signature)) continue;
      } catch {
        continue;
      }
      verified = true;
      const merchantOrderNo = valueOf(values.out_trade_no);
      const intent = await this.prisma.rentalPaymentIntent.findFirst({ where: { tenantId: config.tenantId, provider: "alipay", merchantOrderNo } });
      // 同一 app_id 被多个租户错误复用时，不能因为配置排序把回调绑定给第一个租户。
      if (!intent) continue;
      const tradeStatus = valueOf(values.trade_status);
      const paidAmount = Number(valueOf(values.total_amount || values.receipt_amount));
      if (tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED") {
        this.assertPaidAmount(paidAmount, Number(intent.amount));
        await this.settleVerifiedPayment({
          tenantId: config.tenantId,
          provider: "alipay",
          eventId: valueOf(values.notify_id) || `${valueOf(values.trade_no)}:${valueOf(values.gmt_payment)}`,
          externalTransactionId: valueOf(values.trade_no),
          intentId: intent.id,
          amount: paidAmount,
          payloadHash: sha256(JSON.stringify(values))
        });
      } else if (["TRADE_CLOSED", "TRADE_PENDING"].includes(tradeStatus)) {
        await this.prisma.rentalPaymentIntent.updateMany({ where: { id: intent.id, status: "pending" }, data: { status: tradeStatus === "TRADE_CLOSED" ? "closed" : "pending", failureReason: tradeStatus === "TRADE_CLOSED" ? "支付宝交易已关闭" : null } });
      }
      return "success";
    }
    if (!verified) throw new UnauthorizedException("支付宝回调验签失败");
    throw new NotFoundException("支付宝回调对应的支付单不存在");
  }

  async handleWechatCallback(input: PaymentCallbackInput) {
    const headers = input.headers ?? {};
    const timestampHeader = valueOf(headers["wechatpay-timestamp"] || headers["Wechatpay-Timestamp"]);
    const nonceHeader = valueOf(headers["wechatpay-nonce"] || headers["Wechatpay-Nonce"]);
    const signature = valueOf(headers["wechatpay-signature"] || headers["Wechatpay-Signature"]);
    const serial = certificateSerial(headers["wechatpay-serial"] || headers["Wechatpay-Serial"]);
    if (!Buffer.isBuffer(input.rawBody)) {
      throw new UnauthorizedException("微信支付回调缺少原始请求体");
    }
    const rawBody = input.rawBody;
    // 时间戳偏差是最便宜的检查，放在加载/解密任何租户配置之前，让重放和垃圾请求不触碰数据库。
    const signedAt = Number(timestampHeader);
    if (!Number.isFinite(signedAt) || Math.abs(Date.now() / 1000 - signedAt) > 300) throw new UnauthorizedException("微信支付回调已过期");
    const candidates = (await this.callbackConfigs("wechat_pay"))
      .filter((item) => certificateSerial(item.settings.platformCertificateSerial) === serial);
    if (candidates.length === 0) throw new UnauthorizedException("微信支付回调平台证书序列号未配置或不匹配");
    const message = `${timestampHeader}\n${nonceHeader}\n${rawBody.toString("utf8")}\n`;
    let envelope: JsonRecord;
    try {
      const parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not-object");
      envelope = parsed as JsonRecord;
    } catch {
      throw new BadRequestException("微信支付回调格式无效");
    }
    const resource = (envelope.resource ?? {}) as JsonRecord;
    let verified = false;
    let identityMatched = false;
    for (const config of candidates) {
      let signatureVerified = false;
      try {
        signatureVerified = Boolean(timestampHeader && nonceHeader && signature && verifyRsa(valueOf(config.credentials.wechatPlatformCertificate), message, signature));
      } catch {
        signatureVerified = false;
      }
      if (!signatureVerified) continue;
      verified = true;
      let decrypted: JsonRecord;
      try {
        decrypted = this.decryptWechatResource(config, resource);
      } catch {
        // 同一个证书序列号在错误配置间重复时，继续尝试真正能解密的租户配置；
        // 数据库错误则不会被这个分支吞掉。
        continue;
      }
      const configuredMchId = requiredText(config.settings.mchid, "商户号");
      const configuredAppId = requiredText(config.settings.appId, "应用 ID");
      if (valueOf(decrypted.mchid) !== configuredMchId || valueOf(decrypted.appid) !== configuredAppId) continue;
      identityMatched = true;
      const merchantOrderNo = valueOf(decrypted.out_trade_no);
      const intent = await this.prisma.rentalPaymentIntent.findFirst({ where: { tenantId: config.tenantId, provider: "wechat_pay", merchantOrderNo } });
      if (!intent) continue;
      if (valueOf(decrypted.trade_state) === "SUCCESS") {
        const total = Number(((decrypted.amount as JsonRecord | undefined)?.total ?? 0)) / 100;
        this.assertPaidAmount(total, Number(intent.amount));
        await this.settleVerifiedPayment({
          tenantId: config.tenantId,
          provider: "wechat_pay",
          eventId: valueOf(envelope.id),
          externalTransactionId: valueOf(decrypted.transaction_id),
          intentId: intent.id,
          amount: total,
          payloadHash: sha256(rawBody),
          decryptedSummary: { tradeState: valueOf(decrypted.trade_state), transactionId: valueOf(decrypted.transaction_id) }
        });
      }
      return { code: "SUCCESS", message: "成功" };
    }
    if (!verified) throw new UnauthorizedException("微信支付回调验签失败");
    if (!identityMatched) throw new UnauthorizedException("微信支付回调商户身份不匹配");
    throw new NotFoundException("微信支付回调对应的支付单不存在");
  }

  /**
   * 微信退款结果通知：先验平台签名和商户号，再解密并按商户退款单号绑定租户退款单。
   * 只有 REFUND.SUCCESS 且当前退款单金额足够覆盖本地退款单金额才会写租金资金事件；
   * 受理、关闭、异常和金额不一致都不能伪装成成功。
   */
  async handleWechatRefundCallback(input: PaymentCallbackInput) {
    const headers = input.headers ?? {};
    const timestampHeader = valueOf(headers["wechatpay-timestamp"] || headers["Wechatpay-Timestamp"]);
    const nonceHeader = valueOf(headers["wechatpay-nonce"] || headers["Wechatpay-Nonce"]);
    const signature = valueOf(headers["wechatpay-signature"] || headers["Wechatpay-Signature"]);
    const serial = certificateSerial(headers["wechatpay-serial"] || headers["Wechatpay-Serial"]);
    if (!Buffer.isBuffer(input.rawBody)) {
      throw new UnauthorizedException("微信退款回调缺少原始请求体");
    }
    const rawBody = input.rawBody;
    // 时间戳偏差是最便宜的检查，放在加载/解密任何租户配置之前，让重放和垃圾请求不触碰数据库。
    const signedAt = Number(timestampHeader);
    if (!Number.isFinite(signedAt) || Math.abs(Date.now() / 1000 - signedAt) > 300) throw new UnauthorizedException("微信退款回调已过期");
    const candidates = (await this.callbackConfigs("wechat_pay"))
      .filter((item) => certificateSerial(item.settings.platformCertificateSerial) === serial);
    if (candidates.length === 0) throw new UnauthorizedException("微信退款回调平台证书序列号未配置或不匹配");
    const message = `${timestampHeader}\n${nonceHeader}\n${rawBody.toString("utf8")}\n`;
    let envelope: JsonRecord;
    try {
      const parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not-object");
      envelope = parsed as JsonRecord;
    } catch {
      throw new BadRequestException("微信退款回调格式无效");
    }
    const eventId = valueOf(envelope.id);
    const eventType = valueOf(envelope.event_type).toUpperCase();
    if (!eventId || !eventType) throw new BadRequestException("微信退款回调缺少事件编号或事件类型");
    const resource = (envelope.resource ?? {}) as JsonRecord;
    let verified = false;
    let identityMatched = false;
    for (const config of candidates) {
      let signatureVerified = false;
      try {
        signatureVerified = Boolean(timestampHeader && nonceHeader && signature && verifyRsa(valueOf(config.credentials.wechatPlatformCertificate), message, signature));
      } catch {
        signatureVerified = false;
      }
      if (!signatureVerified) continue;
      verified = true;
      let decrypted: JsonRecord;
      try {
        decrypted = this.decryptWechatResource(config, resource);
      } catch {
        continue;
      }
      if (valueOf(decrypted.mchid) !== requiredText(config.settings.mchid, "商户号")) continue;
      identityMatched = true;
      const merchantRefundNo = valueOf(decrypted.out_refund_no);
      const refund = await this.prisma.rentalPaymentRefund.findFirst({
        where: { tenantId: config.tenantId, provider: "wechat_pay", merchantRefundNo }
      });
      if (!refund) continue;
      const refundStatus = valueOf(decrypted.refund_status).toUpperCase();
      const amount = Number(((decrypted.amount as JsonRecord | undefined)?.refund ?? Number.NaN)) / 100;
      const payloadHash = sha256(rawBody);
      if (eventType === "REFUND.SUCCESS" && refundStatus === "SUCCESS") {
        if (!Number.isFinite(amount)) throw new ConflictException("微信退款回调缺少退款金额，保留待核对");
        if (amount + 0.005 < Number(refund.amount)) {
          throw new ConflictException("微信退款回调当前退款金额不足，保留待核对");
        }
        await this.applyRefundWebhookOutcome({
          tenantId: refund.tenantId,
          workspaceId: refund.workspaceId,
          orderId: refund.orderId,
          refund,
          provider: "wechat_pay",
          eventId,
          payloadHash,
          outcome: {
            status: "succeeded",
            externalRefundId: valueOf(decrypted.refund_id),
            externalStatus: refundStatus,
            responseJson: { eventType, refundStatus, refundId: valueOf(decrypted.refund_id), outRefundNo: merchantRefundNo, refundedAmount: amount }
          }
        });
      } else if (eventType === "REFUND.CLOSED" || refundStatus === "CLOSED") {
        await this.applyRefundWebhookOutcome({
          tenantId: refund.tenantId,
          workspaceId: refund.workspaceId,
          orderId: refund.orderId,
          refund,
          provider: "wechat_pay",
          eventId,
          payloadHash,
          outcome: { status: "failed", externalRefundId: valueOf(decrypted.refund_id), externalStatus: refundStatus || eventType, responseJson: { eventType, refundStatus, outRefundNo: merchantRefundNo } }
        });
      } else {
        // REFUND.ABNORMAL 或未知事件只保留在查询/人工处理中，不能推进成功资金事件。
        await this.applyRefundWebhookOutcome({
          tenantId: refund.tenantId,
          workspaceId: refund.workspaceId,
          orderId: refund.orderId,
          refund,
          provider: "wechat_pay",
          eventId,
          payloadHash,
          outcome: { status: "accepted", externalRefundId: valueOf(decrypted.refund_id), externalStatus: refundStatus || eventType, responseJson: { eventType, refundStatus, outRefundNo: merchantRefundNo } }
        });
      }
      return { code: "SUCCESS", message: "成功" };
    }
    if (!verified) throw new UnauthorizedException("微信退款回调验签失败");
    if (!identityMatched) throw new UnauthorizedException("微信退款回调商户身份不匹配或退款单不存在");
    throw new NotFoundException("微信退款回调对应的退款单不存在");
  }

  /**
   * 支付宝退款没有统一等价于微信 REFUND.SUCCESS 的通用推送链，仍以退款查询为主。
   * 兼容明确带退款成功状态和累计退款金额的签名通知；字段不完整时直接拒绝入账，
   * 让主动查单/对账恢复，不把“收到通知”当成“资金已退”。
   */
  async handleAlipayRefundCallback(body: unknown) {
    const values = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const appId = valueOf(values.app_id);
    const candidates = (await this.callbackConfigs("alipay"))
      .filter((item) => valueOf(item.settings.appId) === appId);
    if (candidates.length === 0) throw new UnauthorizedException("支付宝退款回调商户不存在");
    const signature = valueOf(values.sign);
    const signedContent = stableFormContent(values, ["sign", "sign_type"]);
    let verified = false;
    for (const config of candidates) {
      try {
        if (!signature || !verifyRsa(valueOf(config.credentials.alipayPublicKey), signedContent, signature)) continue;
      } catch {
        continue;
      }
      verified = true;
      const merchantRefundNo = valueOf(values.out_request_no || values.out_refund_no);
      const refund = await this.prisma.rentalPaymentRefund.findFirst({ where: { tenantId: config.tenantId, provider: "alipay", merchantRefundNo } });
      if (!refund) continue;
      const status = valueOf(values.refund_status || values.refund_result).toUpperCase();
      const refundFee = Number(valueOf(values.refund_fee || values.refund_amount));
      if (status !== "REFUND_SUCCESS" && valueOf(values.fund_change).toUpperCase() !== "Y") {
        throw new ConflictException("支付宝退款通知未明确确认成功，已保留待查询");
      }
      if (!Number.isFinite(refundFee)) throw new ConflictException("支付宝退款通知缺少累计退款金额，已保留待查询");
      const confirmedTotal = await this.confirmedRefundTotal(refund.tenantId, refund.workspaceId, refund.paymentIntentId, refund.id);
      if (refundFee + 0.005 < money(confirmedTotal + Number(refund.amount))) throw new ConflictException("支付宝退款通知金额不足，已保留待查询");
      await this.applyRefundWebhookOutcome({
        tenantId: refund.tenantId,
        workspaceId: refund.workspaceId,
        orderId: refund.orderId,
        refund,
        provider: "alipay",
        eventId: valueOf(values.notify_id) || `${valueOf(values.trade_no)}:${merchantRefundNo}:${refundFee}`,
        payloadHash: sha256(JSON.stringify(values)),
        outcome: {
          status: "succeeded",
          externalRefundId: valueOf(values.trade_no),
          externalStatus: status || "REFUND_SUCCESS",
          confirmedTotal: refundFee,
          responseJson: { status: status || "REFUND_SUCCESS", outRefundNo: merchantRefundNo, refundFee }
        }
      });
      return "success";
    }
    if (!verified) throw new UnauthorizedException("支付宝退款回调验签失败");
    throw new NotFoundException("支付宝退款回调对应的退款单不存在");
  }

  private async requirePaymentIntent(tenantId: string, workspaceId: string, orderId: string, intentId: string) {
    const row = await this.prisma.rentalPaymentIntent.findFirst({ where: { id: intentId, tenantId, workspaceId, orderId } });
    if (!row) throw new NotFoundException("支付单不存在");
    return row;
  }

  private async confirmedRefundTotal(tenantId: string, workspaceId: string, intentId: string, excludeRefundId?: string) {
    const rows = await this.prisma.rentalPaymentRefund.findMany({
      where: {
        tenantId,
        workspaceId,
        paymentIntentId: intentId,
        ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}),
        status: { in: ["succeeded", "funding_pending"] }
      },
      select: { amount: true }
    });
    return money(rows.reduce((sum, row) => sum + Number(row.amount), 0));
  }

  private async submitProviderRefund(
    config: TenantIntegrationRuntimeConfig,
    intent: PaymentIntentRow,
    refund: PaymentRefundRow,
    confirmedTotal: number
  ): Promise<ProviderRefundResult> {
    return intent.method === "alipay"
      ? this.createAlipayRefund(config, intent, refund, confirmedTotal)
      : this.createWechatRefund(config, intent, refund);
  }

  private async queryProviderRefund(
    config: TenantIntegrationRuntimeConfig,
    intent: PaymentIntentRow,
    refund: PaymentRefundRow,
    confirmedTotal: number
  ): Promise<ProviderRefundResult> {
    return intent.method === "alipay"
      ? this.queryAlipayRefund(config, intent, refund, confirmedTotal)
      : this.queryWechatRefund(config, refund);
  }

  private async createAlipayRefund(
    config: TenantIntegrationRuntimeConfig,
    intent: PaymentIntentRow,
    refund: PaymentRefundRow,
    confirmedTotal: number
  ): Promise<ProviderRefundResult> {
    const params: Record<string, string> = {
      app_id: requiredText(config.settings.appId, "应用 ID"),
      method: "alipay.trade.refund",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: alipayTimestamp(),
      version: "1.0",
      biz_content: JSON.stringify({
        out_trade_no: intent.merchantOrderNo,
        trade_no: intent.externalTransactionId,
        refund_amount: Number(refund.amount).toFixed(2),
        out_request_no: refund.merchantRefundNo,
        refund_reason: refund.reason
      })
    };
    const response = await fetchJson(requiredText(config.settings.gatewayUrl, "网关地址"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({ ...params, sign: signRsa(valueOf(config.credentials.appPrivateKey), stableFormContent(params)) }).toString()
    });
    const result = (response.alipay_trade_refund_response ?? {}) as JsonRecord;
    if (valueOf(result.code) !== "10000") throw alipayFailure(result, "支付宝退款申请失败");
    const refundFee = Number(valueOf(result.refund_fee));
    const expectedTotal = money(confirmedTotal + Number(refund.amount));
    const succeeded = valueOf(result.fund_change) === "Y" && Number.isFinite(refundFee) && refundFee + 0.005 >= expectedTotal;
    return {
      status: succeeded ? "succeeded" : "accepted",
      externalRefundId: valueOf(result.trade_no || intent.externalTransactionId),
      externalStatus: valueOf(result.fund_change || "ACCEPTED"),
      confirmedTotal: Number.isFinite(refundFee) ? refundFee : undefined,
      responseJson: { code: valueOf(result.code), fundChange: valueOf(result.fund_change), refundFee: Number.isFinite(refundFee) ? refundFee : undefined }
    };
  }

  private async queryAlipayRefund(
    config: TenantIntegrationRuntimeConfig,
    intent: PaymentIntentRow,
    refund: PaymentRefundRow,
    confirmedTotal: number
  ): Promise<ProviderRefundResult> {
    const params: Record<string, string> = {
      app_id: requiredText(config.settings.appId, "应用 ID"),
      method: "alipay.trade.fastpay.refund.query",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: alipayTimestamp(),
      version: "1.0",
      biz_content: JSON.stringify({ out_trade_no: intent.merchantOrderNo, trade_no: intent.externalTransactionId, out_request_no: refund.merchantRefundNo })
    };
    const response = await fetchJson(requiredText(config.settings.gatewayUrl, "网关地址"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({ ...params, sign: signRsa(valueOf(config.credentials.appPrivateKey), stableFormContent(params)) }).toString()
    });
    const result = (response.alipay_trade_fastpay_refund_query_response ?? {}) as JsonRecord;
    if (valueOf(result.code) !== "10000") throw alipayFailure(result, "支付宝退款查询失败");
    // 查询成功但没有退款状态/金额 = 平台没有这笔退款申请。刚提交的申请可能还没同步，
    // 但超过 24 小时仍查不到，说明申请从未到达平台，可以安全判失败并释放额度。
    if (!valueOf(result.refund_status) && !valueOf(result.refund_amount) && !valueOf(result.refund_fee)) {
      if (Date.now() - refund.createdAt.getTime() > REFUND_NOT_FOUND_TERMINAL_MS) {
        throw new PaymentProviderDefinitiveError("REFUND_NOT_FOUND", "支付宝超过 24 小时仍查不到该退款申请，判定退款未受理");
      }
      return { status: "accepted", externalStatus: "NOT_FOUND", responseJson: { code: valueOf(result.code), refundStatus: "NOT_FOUND" } };
    }
    const refundFee = Number(valueOf(result.refund_amount || result.refund_fee));
    const succeeded = valueOf(result.refund_status) === "REFUND_SUCCESS"
      && Number.isFinite(refundFee)
      && refundFee + 0.005 >= money(confirmedTotal + Number(refund.amount));
    return {
      status: succeeded ? "succeeded" : "accepted",
      externalRefundId: valueOf(result.trade_no || intent.externalTransactionId),
      externalStatus: valueOf(result.refund_status || "PROCESSING"),
      confirmedTotal: Number.isFinite(refundFee) ? refundFee : undefined,
      responseJson: { code: valueOf(result.code), refundStatus: valueOf(result.refund_status || "PROCESSING"), refundFee: Number.isFinite(refundFee) ? refundFee : undefined }
    };
  }

  private async createWechatRefund(
    config: TenantIntegrationRuntimeConfig,
    intent: PaymentIntentRow,
    refund: PaymentRefundRow
  ): Promise<ProviderRefundResult> {
    const requestBody: JsonRecord = {
      ...(intent.externalTransactionId ? { transaction_id: intent.externalTransactionId } : { out_trade_no: intent.merchantOrderNo }),
      out_refund_no: refund.merchantRefundNo,
      reason: refund.reason,
      amount: {
        refund: toCents(Number(refund.amount)),
        total: toCents(Number(intent.amount)),
        currency: intent.currency
      },
      ...(String(config.settings.refundNotifyUrl ?? "").trim() ? { notify_url: String(config.settings.refundNotifyUrl).trim() } : {})
    };
    const response = await this.wechatRequest(config, "POST", "/v3/refund/domestic/refunds", JSON.stringify(requestBody));
    const state = valueOf(response.status || "PROCESSING").toUpperCase();
    const refundedAmount = Number(((response.amount as JsonRecord | undefined)?.refund ?? Number.NaN)) / 100;
    const amountMatches = state !== "SUCCESS" || (Number.isFinite(refundedAmount) && refundedAmount + 0.005 >= Number(refund.amount));
    return {
      status: state === "SUCCESS" && amountMatches ? "succeeded" : ["CLOSED"].includes(state) ? "failed" : "accepted",
      externalRefundId: valueOf(response.refund_id),
      externalStatus: state === "SUCCESS" && !amountMatches ? "SUCCESS_AMOUNT_MISMATCH" : state,
      responseJson: {
        refundId: valueOf(response.refund_id),
        status: state,
        outRefundNo: valueOf(response.out_refund_no || refund.merchantRefundNo),
        refundedAmount: Number.isFinite(refundedAmount) ? refundedAmount : undefined
      }
    };
  }

  private async queryWechatRefund(config: TenantIntegrationRuntimeConfig, refund: PaymentRefundRow): Promise<ProviderRefundResult> {
    let response: JsonRecord;
    try {
      response = await this.wechatRequest(config, "GET", `/v3/refund/domestic/refunds/${encodeURIComponent(refund.merchantRefundNo)}`, "");
    } catch (error) {
      // 微信 404 RESOURCE_NOT_EXISTS：平台没有这笔退款。申请刚提交时可能短暂查不到，
      // 超过 24 小时仍不存在则判定从未受理；24 小时内保持 pending 等下一次查询。
      if (error instanceof PaymentProviderHttpError && error.status === 404) {
        if (Date.now() - refund.createdAt.getTime() > REFUND_NOT_FOUND_TERMINAL_MS) {
          throw new PaymentProviderDefinitiveError("REFUND_NOT_FOUND", "微信支付超过 24 小时仍查不到该退款申请，判定退款未受理");
        }
        throw new PaymentProviderUnknownError("微信支付暂未查到该退款申请，请稍后再查询");
      }
      throw error;
    }
    const state = valueOf(response.status || "PROCESSING").toUpperCase();
    const refundedAmount = Number(((response.amount as JsonRecord | undefined)?.refund ?? Number.NaN)) / 100;
    const amountMatches = state !== "SUCCESS" || (Number.isFinite(refundedAmount) && refundedAmount + 0.005 >= Number(refund.amount));
    return {
      status: state === "SUCCESS" && amountMatches ? "succeeded" : state === "CLOSED" ? "failed" : "accepted",
      externalRefundId: valueOf(response.refund_id),
      externalStatus: state === "SUCCESS" && !amountMatches ? "SUCCESS_AMOUNT_MISMATCH" : state,
      responseJson: {
        refundId: valueOf(response.refund_id),
        status: state,
        outRefundNo: valueOf(response.out_refund_no || refund.merchantRefundNo),
        refundedAmount: Number.isFinite(refundedAmount) ? refundedAmount : undefined
      }
    };
  }

  private async applyProviderRefundOutcome(
    tenantId: string,
    workspaceId: string,
    orderId: string,
    refundId: string,
    outcome: ProviderRefundResult,
    operator?: string
  ) {
    if (outcome.status === "succeeded") {
      try {
        const updated = await this.prisma.$transaction(async (tx) => {
          const row = await tx.rentalPaymentRefund.findFirst({ where: { id: refundId, tenantId, workspaceId, orderId } });
          if (!row) throw new NotFoundException("退款单不存在");
          if (row.externalRefundId && outcome.externalRefundId && row.externalRefundId !== outcome.externalRefundId) {
            throw new ConflictException("退款单已绑定其他第三方退款编号，不能接受新的退款结果");
          }
          if (row.fundedAt) return row;
          await tx.rentalPaymentRefund.update({
            where: { id: row.id },
            data: {
              status: "succeeded",
              externalRefundId: outcome.externalRefundId ?? row.externalRefundId,
              externalStatus: outcome.externalStatus ?? "SUCCESS",
              responseJson: outcome.responseJson as Prisma.InputJsonValue,
              succeededAt: row.succeededAt ?? new Date(),
              failureReason: null
            }
          });
          await this.funding.recordEvent(tenantId, workspaceId, orderId, {
            instrument: "rental",
            action: "refund",
            amount: Number(row.amount),
            idempotencyKey: `payment-refund:${row.id}`,
            reason: `真实支付退款：${row.reason}`,
            provider: row.provider as "alipay" | "wechat_pay"
          }, operator ?? "provider", tx);
          return tx.rentalPaymentRefund.update({ where: { id: row.id }, data: { fundedAt: new Date(), failureReason: null } });
        });
        return { status: updated.status, response: this.toRefundResponse(updated) };
      } catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
        const failureReason = error instanceof Error ? error.message : "第三方退款成功，但内部资金入账待恢复";
        await this.prisma.rentalPaymentRefund.updateMany({
          where: { id: refundId, tenantId, workspaceId, orderId },
          data: {
            status: "funding_pending",
            externalRefundId: outcome.externalRefundId,
            externalStatus: outcome.externalStatus ?? "SUCCESS",
            responseJson: outcome.responseJson as Prisma.InputJsonValue,
            succeededAt: new Date(),
            failureReason: failureReason.slice(0, 500)
          }
        });
        const scoped = await this.prisma.rentalPaymentRefund.findFirst({ where: { id: refundId, tenantId, workspaceId, orderId } });
        if (!scoped) throw new NotFoundException("退款单不存在");
        return { status: scoped.status, response: this.toRefundResponse(scoped), failureReason };
      }
    }

    const current = await this.prisma.rentalPaymentRefund.findFirst({ where: { id: refundId, tenantId, workspaceId, orderId } });
    if (!current) throw new NotFoundException("退款单不存在");
    if (current.externalRefundId && outcome.externalRefundId && current.externalRefundId !== outcome.externalRefundId) {
      throw new ConflictException("退款单已绑定其他第三方退款编号，不能接受新的退款结果");
    }
    // 第三方一旦已确认成功，内部资金事件即使暂时失败，也不能被一次暂时性查询
    // 结果降级成 accepted/failed；否则会丢失“已发生外部退款”的事实并允许重复退款。
    if (current.fundedAt || current.status === "succeeded" || current.status === "funding_pending") {
      return { status: current.status, response: this.toRefundResponse(current) };
    }
    const updated = await this.prisma.rentalPaymentRefund.update({
      where: { id: current.id },
      data: {
        status: outcome.status === "accepted" ? "accepted" : "failed",
        externalRefundId: outcome.externalRefundId,
        externalStatus: outcome.externalStatus,
        responseJson: outcome.responseJson as Prisma.InputJsonValue,
        acceptedAt: outcome.status === "accepted" ? new Date() : undefined,
        failureReason: outcome.status === "failed" ? "第三方明确拒绝退款" : null
      }
    });
    return { status: updated.status, response: this.toRefundResponse(updated), failureReason: updated.failureReason ?? undefined };
  }

  private async applyRefundWebhookOutcome(input: {
    tenantId: string;
    workspaceId: string;
    orderId: string;
    refund: PaymentRefundRow;
    provider: "alipay" | "wechat_pay";
    eventId: string;
    payloadHash: string;
    outcome: ProviderRefundResult;
  }) {
    const eventProvider = `${input.provider}_refund`;
    const existing = await this.prisma.paymentWebhookEvent.findUnique({ where: { provider_eventId: { provider: eventProvider, eventId: input.eventId } } });
    if (existing) {
      if (existing.tenantId !== input.tenantId || existing.payloadHash !== input.payloadHash || (existing.paymentIntentId && existing.paymentIntentId !== input.refund.paymentIntentId)) {
        throw new ConflictException("退款回调事件已绑定到其他租户或退款单");
      }
      if (existing.status === "processed" || existing.status === "processing") return;
      const claimed = await this.prisma.paymentWebhookEvent.updateMany({ where: { id: existing.id, status: "failed" }, data: { status: "processing", errorMessage: null } });
      if (claimed.count !== 1) return;
    } else {
      try {
        await this.prisma.paymentWebhookEvent.create({
          data: { tenantId: input.tenantId, provider: eventProvider, eventId: input.eventId, paymentIntentId: input.refund.paymentIntentId, payloadHash: input.payloadHash, status: "processing" }
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
        // 另一并发回调可能已经抢到事件。重新读取并复核事件归属；如果它已经
        // 失败则由当前请求接管重试，只有 processing/processed 才直接返回。
        const concurrent = await this.prisma.paymentWebhookEvent.findUnique({ where: { provider_eventId: { provider: eventProvider, eventId: input.eventId } } });
        if (!concurrent) throw error;
        if (concurrent.tenantId !== input.tenantId || concurrent.payloadHash !== input.payloadHash || (concurrent.paymentIntentId && concurrent.paymentIntentId !== input.refund.paymentIntentId)) {
          throw new ConflictException("退款回调事件已绑定到其他租户或退款单");
        }
        if (concurrent.status === "processed" || concurrent.status === "processing") return;
        const claimed = await this.prisma.paymentWebhookEvent.updateMany({ where: { id: concurrent.id, status: "failed" }, data: { status: "processing", errorMessage: null } });
        if (claimed.count !== 1) return;
      }
    }
    try {
      await this.applyProviderRefundOutcome(input.tenantId, input.workspaceId, input.orderId, input.refund.id, input.outcome, "provider-webhook");
      await this.prisma.paymentWebhookEvent.updateMany({ where: { provider: eventProvider, eventId: input.eventId, status: "processing" }, data: { status: "processed", processedAt: new Date(), paymentIntentId: input.refund.paymentIntentId, errorMessage: null } });
    } catch (error) {
      await this.prisma.paymentWebhookEvent.updateMany({ where: { provider: eventProvider, eventId: input.eventId, status: "processing" }, data: { status: "failed", errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 500) } });
      throw error;
    }
  }

  private async markRefundProviderCallPending(tenantId: string, workspaceId: string, orderId: string, refundId: string, error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error ?? "第三方退款结果未知");
    const disposition = refundFailureDisposition(error);
    const current = await this.prisma.rentalPaymentRefund.findFirst({ where: { id: refundId, tenantId, workspaceId, orderId } });
    if (!current) throw new NotFoundException("退款单不存在");
    const responseJson = {
      ...((current.responseJson && typeof current.responseJson === "object" && !Array.isArray(current.responseJson) ? current.responseJson : {}) as JsonRecord),
      ...(disposition.providerCode ? { providerCode: disposition.providerCode, providerMessage: errorMessage.slice(0, 500) } : {})
    };
    await this.prisma.rentalPaymentRefund.updateMany({
      where: { id: refundId, tenantId, workspaceId, orderId, status: { in: ["pending", "accepted"] } },
      data: {
        status: disposition.definitive ? "failed" : "pending",
        externalStatus: disposition.definitive ? (disposition.providerCode ?? "REJECTED").slice(0, 40) : current.externalStatus,
        failureReason: errorMessage.slice(0, 500),
        ...(disposition.providerCode ? { responseJson: responseJson as Prisma.InputJsonValue } : {})
      }
    });
    const updated = await this.prisma.rentalPaymentRefund.findFirst({ where: { id: refundId, tenantId, workspaceId, orderId } });
    if (!updated) throw new NotFoundException("退款单不存在");
    return { status: updated.status, response: this.toRefundResponse(updated), failureReason: errorMessage };
  }

  private toRefundResponse(row: PaymentRefundRow) {
    return {
      refundId: row.id,
      paymentIntentId: row.paymentIntentId,
      orderId: row.orderId,
      provider: row.provider,
      method: row.method,
      amount: Number(row.amount),
      currency: row.currency,
      merchantRefundNo: row.merchantRefundNo,
      status: row.status,
      externalRefundId: row.externalRefundId ?? undefined,
      externalStatus: row.externalStatus ?? undefined,
      reason: row.reason,
      failureReason: row.failureReason ?? undefined,
      acceptedAt: row.acceptedAt?.toISOString(),
      succeededAt: row.succeededAt?.toISOString(),
      fundedAt: row.fundedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private async createAlipayIntent(config: TenantIntegrationRuntimeConfig, intent: PaymentIntentRow, orderNo: string) {
    const params: Record<string, string> = {
      app_id: requiredText(config.settings.appId, "应用 ID"),
      method: "alipay.trade.precreate",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: alipayTimestamp(),
      version: "1.0",
      notify_url: requiredText(config.settings.notifyUrl, "异步通知地址"),
      biz_content: JSON.stringify({
        out_trade_no: intent.merchantOrderNo,
        total_amount: Number(intent.amount).toFixed(2),
        subject: `Rental OS ${orderNo}`,
        // 平台侧与本地同一个过期时间：过期后支付宝自动关单，本地不再需要为“客户晚扫码”兜底。
        time_expire: alipayExpireTime(intent.expiresAt)
      })
    };
    const content = stableFormContent(params);
    const body = new URLSearchParams({ ...params, sign: signRsa(valueOf(config.credentials.appPrivateKey), content) }).toString();
    const response = await fetchJson(requiredText(config.settings.gatewayUrl, "网关地址"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body });
    const result = (response.alipay_trade_precreate_response ?? {}) as JsonRecord;
    if (valueOf(result.code) !== "10000") throw alipayFailure(result, "支付宝下单失败");
    const checkoutUrl = valueOf(result.qr_code);
    if (!checkoutUrl) throw new PaymentProviderUnknownError("支付宝未返回可用二维码地址，请查询支付状态后再重试");
    return { checkoutUrl, responseCode: valueOf(result.code), responseJson: { code: valueOf(result.code), qrCode: checkoutUrl } };
  }

  private async queryAlipayIntent(config: TenantIntegrationRuntimeConfig, merchantOrderNo: string) {
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

  private async closeAlipayIntent(config: TenantIntegrationRuntimeConfig, merchantOrderNo: string) {
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
    if (valueOf(result.code) !== "10000" && valueOf(result.code) !== "40004") throw new Error(valueOf(result.sub_msg || result.msg || "支付宝关闭支付单失败"));
  }

  private async queryWechatIntent(config: TenantIntegrationRuntimeConfig, merchantOrderNo: string) {
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

  private async closeWechatIntent(config: TenantIntegrationRuntimeConfig, merchantOrderNo: string) {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderNo)}/close`;
    await this.wechatRequest(config, "POST", path, JSON.stringify({ mchid: requiredText(config.settings.mchid, "商户号") }));
  }

  private async createWechatIntent(config: TenantIntegrationRuntimeConfig, intent: PaymentIntentRow, orderNo: string) {
    const path = "/v3/pay/transactions/native";
    const requestBody = JSON.stringify({
      appid: requiredText(config.settings.appId, "应用 ID"),
      mchid: requiredText(config.settings.mchid, "商户号"),
      description: `Rental OS ${orderNo}`,
      out_trade_no: intent.merchantOrderNo,
      notify_url: requiredText(config.settings.notifyUrl, "支付通知地址"),
      amount: { total: toCents(Number(intent.amount)), currency: "CNY" },
      time_expire: wechatExpireTime(intent.expiresAt)
    });
    const response = await this.wechatRequest(config, "POST", path, requestBody);
    const checkoutUrl = valueOf(response.code_url);
    if (!checkoutUrl) throw new PaymentProviderUnknownError("微信支付未返回可用二维码地址，请查询支付状态后再重试");
    return { checkoutUrl, responseCode: "SUCCESS", responseJson: { codeUrl: checkoutUrl } };
  }

  /** JSAPI 下单：与 Native 同一验签链，只是 trade_type 不同且必须带付款人 openid；返回 prepay_id（不含签名）。 */
  private async createWechatJsapiIntent(config: TenantIntegrationRuntimeConfig, intent: PaymentIntentRow, orderNo: string, openId: string) {
    const path = "/v3/pay/transactions/jsapi";
    const requestBody = JSON.stringify({
      appid: requiredText(config.settings.appId, "应用 ID"),
      mchid: requiredText(config.settings.mchid, "商户号"),
      description: `Rental OS ${orderNo}`,
      out_trade_no: intent.merchantOrderNo,
      notify_url: requiredText(config.settings.notifyUrl, "支付通知地址"),
      amount: { total: toCents(Number(intent.amount)), currency: "CNY" },
      time_expire: wechatExpireTime(intent.expiresAt),
      payer: { openid: openId }
    });
    const response = await this.wechatRequest(config, "POST", path, requestBody);
    const prepayId = valueOf(response.prepay_id);
    if (!prepayId) throw new PaymentProviderUnknownError("微信支付未返回预支付单，请查询支付状态后再重试");
    // JSAPI 没有 checkoutUrl；responseJson 只保存 prepay_id、交易类型与付款人 openid（用于重新签名前核对）。
    return { checkoutUrl: null as string | null, responseCode: "SUCCESS", responseJson: { prepayId, tradeType: "JSAPI", openId } };
  }

  private async wechatRequest(config: TenantIntegrationRuntimeConfig, method: "GET" | "POST", path: string, body: string) {
    const base = valueOf(config.settings.gatewayUrl || "https://api.mch.weixin.qq.com").replace(/\/$/u, "");
    const requestTimestamp = timestamp();
    const requestNonce = nonce();
    const signature = signRsa(valueOf(config.credentials.merchantPrivateKey), `${method}\n${path}\n${requestTimestamp}\n${requestNonce}\n${body}\n`);
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${requiredText(config.settings.mchid, "商户号")}",nonce_str="${requestNonce}",timestamp="${requestTimestamp}",serial_no="${requiredText(config.credentials.merchantSerialNo, "商户证书序列号")}",signature="${signature}"`;
    return fetchJson(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authorization },
      body: method === "GET" ? undefined : body
    });
  }

  private decryptWechatResource(config: TenantIntegrationRuntimeConfig, resource: JsonRecord) {
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

  private async settleVerifiedPayment(input: {
    tenantId: string;
    provider: "alipay" | "wechat_pay";
    eventId: string;
    externalTransactionId: string;
    intentId: string;
    amount: number;
    payloadHash: string;
    decryptedSummary?: JsonRecord;
  }) {
    if (!input.eventId || !input.externalTransactionId) throw new BadRequestException("支付回调缺少事件或第三方交易编号");
    try {
      await this.prisma.$transaction(async (tx) => {
        const duplicate = await tx.paymentWebhookEvent.findUnique({ where: { provider_eventId: { provider: input.provider, eventId: input.eventId } } });
        if (duplicate && (duplicate.tenantId !== input.tenantId || duplicate.payloadHash !== input.payloadHash || (duplicate.paymentIntentId && duplicate.paymentIntentId !== input.intentId))) {
          throw new ConflictException("支付回调事件已绑定到其他支付单");
        }
        const intent = await tx.rentalPaymentIntent.findFirst({ where: { id: input.intentId, tenantId: input.tenantId } });
        if (!intent) throw new NotFoundException("支付单不存在");
        if (intent.provider !== input.provider || intent.method !== input.provider) throw new ConflictException("支付单提供方与回调不匹配");
        if (intent.externalTransactionId && intent.externalTransactionId !== input.externalTransactionId) {
          throw new ConflictException("支付单已绑定其他第三方交易编号，不能接受新的成功交易");
        }
        if (duplicate?.status === "processed") {
          if (intent.status !== "paid") throw new ConflictException("支付回调已处理但支付单尚未完成入账，请进入待核对处理");
          if (!intent.externalTransactionId) {
            await tx.rentalPaymentIntent.update({ where: { id: intent.id }, data: { externalTransactionId: input.externalTransactionId } });
          }
          return;
        }
        // 处理中事件由先取得事件的请求负责完成；当前请求不能再次写入资金事件。
        // 查询恢复会使用新的事件键重新尝试，避免一个卡住的事件阻塞支付单恢复。
        if (duplicate?.status === "processing") return;
        if (intent.status === "paid") {
          if (duplicate) await tx.paymentWebhookEvent.update({ where: { id: duplicate.id }, data: { status: "processed", processedAt: new Date(), paymentIntentId: intent.id } });
          else await tx.paymentWebhookEvent.create({ data: { tenantId: input.tenantId, provider: input.provider, eventId: input.eventId, paymentIntentId: intent.id, payloadHash: input.payloadHash, status: "processed", processedAt: new Date() } });
          if (!intent.externalTransactionId) await tx.rentalPaymentIntent.update({ where: { id: intent.id }, data: { externalTransactionId: input.externalTransactionId } });
          return;
        }
        let webhook = duplicate;
        if (!webhook) {
          try {
            webhook = await tx.paymentWebhookEvent.create({
              data: { tenantId: input.tenantId, provider: input.provider, eventId: input.eventId, paymentIntentId: intent.id, payloadHash: input.payloadHash, status: "processing" }
            });
          } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
            const concurrent = await tx.paymentWebhookEvent.findUnique({ where: { provider_eventId: { provider: input.provider, eventId: input.eventId } } });
            if (!concurrent) throw error;
            if (concurrent.tenantId !== input.tenantId || concurrent.payloadHash !== input.payloadHash || (concurrent.paymentIntentId && concurrent.paymentIntentId !== input.intentId)) {
              throw new ConflictException("支付回调事件已绑定到其他支付单");
            }
            if (concurrent.status === "processed" || concurrent.status === "processing") return;
            webhook = concurrent;
          }
        }
        await this.funding.recordEvent(input.tenantId, intent.workspaceId, intent.orderId, {
          instrument: "rental",
          action: "initiate",
          amount: input.amount,
          idempotencyKey: `payment:${intent.id}`,
          reason: `${input.provider === "alipay" ? "支付宝" : "微信支付"}异步回调入账`,
          provider: input.provider
        }, `provider:${input.provider}`, tx);
        await tx.rentalPaymentIntent.update({
          where: { id: intent.id },
          data: { status: "paid", externalTransactionId: input.externalTransactionId || null, paidAt: new Date(), failureReason: null }
        });
        await tx.paymentWebhookEvent.update({
          where: { id: webhook.id },
          data: { status: "processed", processedAt: new Date(), payloadHash: input.payloadHash, paymentIntentId: intent.id }
        });
      });
    } catch (error) {
      await this.prisma.rentalPaymentIntent.updateMany({ where: { id: input.intentId, tenantId: input.tenantId, status: { not: "paid" } }, data: { status: "funding_failed", failureReason: (error instanceof Error ? error.message : "资金入账失败").slice(0, 500) } });
      throw error;
    }
  }

  private assertPaidAmount(actual: number, expected: number) {
    if (!Number.isFinite(actual) || Math.abs(money(actual) - money(expected)) > 0.005) throw new ConflictException("支付回调金额与支付单不一致");
  }

  private toResponse(row: PaymentIntentRow, jsapi?: ClientWechatJsapiParameters): ClientPaymentIntentResponse {
    return {
      ...(jsapi ? { jsapi } : {}),
      apiVersion: CLIENT_API_VERSION,
      intentId: row.id,
      provider: row.provider as ClientPaymentIntentResponse["provider"],
      method: row.method as ClientPaymentIntentResponse["method"],
      instrument: row.instrument as ClientPaymentIntentResponse["instrument"],
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status === "verified_pending_funding" ? "pending" : row.status as ClientPaymentIntentResponse["status"],
      checkoutUrl: row.checkoutUrl ?? undefined,
      expiresAt: row.expiresAt.toISOString(),
      paidAt: row.paidAt?.toISOString(),
      message: row.status === "failed"
        ? "支付平台下单失败，请重新发起"
        : row.status === "funding_failed"
          ? "支付已验签但入账失败，请联系运营处理"
          : row.status === "pending" && row.failureReason
            ? "支付请求结果未知，请先查询支付状态"
            : undefined
    };
  }

  private async log(
    tenantId: string,
    config: TenantIntegrationRuntimeConfig,
    operation: string,
    status: string,
    requestJson: JsonRecord,
    responseJson?: JsonRecord,
    errorMessage?: string
  ) {
    await this.prisma.externalAdapterLog.create({
      data: {
        tenantId,
        provider: config.provider,
        capability: config.capability,
        operation,
        status,
        requestJson: requestJson as Prisma.InputJsonValue,
        responseJson: responseJson as Prisma.InputJsonValue,
        errorMessage: errorMessage?.slice(0, 500)
      }
    });
  }
}
