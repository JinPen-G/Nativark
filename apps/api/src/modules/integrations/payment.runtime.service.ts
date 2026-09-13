import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CLIENT_API_VERSION,
  type ClientPaymentIntentRequest,
  type ClientPaymentIntentResponse
} from "@rental-os/shared";
import {
  createHash,
  createDecipheriv,
  createSign,
  createVerify,
  randomBytes,
  randomUUID
} from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { TenantIntegrationService, type TenantIntegrationRuntimeConfig } from "./tenant-integration.service";
import { RentalFundingService } from "../rental-core/rental-funding.service";
import { rentalPaymentBalance } from "../rental-core/rental-funding-events";

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
  expiresAt: Date;
  paidAt: Date | null;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function valueOf(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
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

async function fetchJson(url: string, init: RequestInit, timeoutMs = 10_000): Promise<JsonRecord> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let body: JsonRecord;
    try {
      body = JSON.parse(raw) as JsonRecord;
    } catch {
      body = { raw: raw.slice(0, 500) };
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${valueOf(body.message || body.msg || body.raw)}`);
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

  async createPaymentIntent(
    tenantId: string,
    workspaceId: string,
    orderId: string,
    input: ClientPaymentIntentRequest
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
      return this.toResponse(existing);
    }

    const config = await this.integrations.runtimeConfig("payment", tenantId, input.method);
    if (!config) throw new ServiceUnavailableException(`尚未启用${input.method === "alipay" ? "支付宝" : "微信支付"}`);
    const order = await this.prisma.rentalOrder.findFirst({
      where: { id: orderId, tenantId, workspaceId },
      select: { id: true, orderNo: true, finalPayableAmount: true, currency: true }
    });
    if (!order) throw new NotFoundException("订单不存在或不属于当前经营空间");
    const funding = await this.funding.listEvents(tenantId, workspaceId, orderId);
    const amount = money(funding.rental.balance + funding.rental.pendingExtensionAmount);
    if (amount <= 0.005) throw new ConflictException("当前订单没有待支付的租金或费用");
    if (String(order.currency).toUpperCase() !== "CNY") throw new BadRequestException("支付宝和微信支付首期只支持人民币订单");

    const pending = await this.prisma.rentalPaymentIntent.findFirst({
      where: { tenantId, workspaceId, orderId, instrument: input.instrument, status: { in: ["pending", "verified_pending_funding"] } },
      orderBy: { createdAt: "desc" }
    });
    if (pending) throw new ConflictException("该订单已有待完成的支付，请先完成或关闭原支付");

    const merchantOrderNo = `RO${Date.now().toString(36).toUpperCase()}${randomUUID().replace(/-/gu, "").slice(0, 12).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const intent = await this.prisma.rentalPaymentIntent.create({
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

    try {
      const result = input.method === "alipay"
        ? await this.createAlipayIntent(config, intent, order.orderNo)
        : await this.createWechatIntent(config, intent, order.orderNo);
      const updated = await this.prisma.rentalPaymentIntent.update({
        where: { id: intent.id },
        data: { checkoutUrl: result.checkoutUrl, responseJson: result.responseJson as Prisma.InputJsonValue, failureReason: null }
      });
      await this.log(tenantId, config, "create_payment_intent", "success", {
        orderId,
        intentId: intent.id,
        merchantOrderNo,
        amount
      }, { responseCode: result.responseCode });
      return this.toResponse(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "支付平台调用失败";
      await this.prisma.rentalPaymentIntent.update({ where: { id: intent.id }, data: { status: "failed", failureReason: message.slice(0, 500) } });
      await this.log(tenantId, config, "create_payment_intent", "failed", { orderId, intentId: intent.id, merchantOrderNo, amount }, undefined, message);
      throw error instanceof ServiceUnavailableException || error instanceof BadRequestException ? error : new ServiceUnavailableException(`支付平台调用失败：${message.slice(0, 180)}`);
    }
  }

  async getPaymentIntent(tenantId: string, workspaceId: string, orderId: string, intentId: string) {
    const row = await this.prisma.rentalPaymentIntent.findFirst({ where: { id: intentId, tenantId, workspaceId, orderId } });
    if (!row) throw new NotFoundException("支付单不存在");
    return this.toResponse(row);
  }

  async handleAlipayCallback(body: unknown) {
    const values = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const appId = valueOf(values.app_id);
    const candidates = await this.integrations.runtimeConfigsForCallback("alipay");
    const config = candidates.find((item) => valueOf(item.settings.appId) === appId);
    if (!config) throw new UnauthorizedException("支付宝回调商户不存在");
    const signature = valueOf(values.sign);
    if (!signature || !verifyRsa(valueOf(config.credentials.alipayPublicKey), stableFormContent(values, ["sign", "sign_type"]), signature)) {
      throw new UnauthorizedException("支付宝回调验签失败");
    }
    const merchantOrderNo = valueOf(values.out_trade_no);
    const intent = await this.prisma.rentalPaymentIntent.findFirst({ where: { tenantId: config.tenantId, provider: "alipay", merchantOrderNo } });
    if (!intent) throw new NotFoundException("支付宝回调对应的支付单不存在");
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

  async handleWechatCallback(input: PaymentCallbackInput) {
    const headers = input.headers ?? {};
    const timestampHeader = valueOf(headers["wechatpay-timestamp"] || headers["Wechatpay-Timestamp"]);
    const nonceHeader = valueOf(headers["wechatpay-nonce"] || headers["Wechatpay-Nonce"]);
    const signature = valueOf(headers["wechatpay-signature"] || headers["Wechatpay-Signature"]);
    const serial = valueOf(headers["wechatpay-serial"] || headers["Wechatpay-Serial"]);
    const rawBody = input.rawBody ?? Buffer.from(JSON.stringify(input.body ?? {}));
    const candidates = await this.integrations.runtimeConfigsForCallback("wechat_pay");
    const config = candidates.find((item) => valueOf(item.credentials.merchantSerialNo) === serial);
    if (!config) throw new UnauthorizedException("微信支付回调商户证书不存在");
    const signedAt = Number(timestampHeader);
    if (!Number.isFinite(signedAt) || Math.abs(Date.now() / 1000 - signedAt) > 300) throw new UnauthorizedException("微信支付回调已过期");
    const message = `${timestampHeader}\n${nonceHeader}\n${rawBody.toString("utf8")}\n`;
    if (!timestampHeader || !nonceHeader || !signature || !verifyRsa(valueOf(config.credentials.wechatPlatformCertificate), message, signature)) {
      throw new UnauthorizedException("微信支付回调验签失败");
    }
    const envelope = JSON.parse(rawBody.toString("utf8")) as JsonRecord;
    const resource = (envelope.resource ?? {}) as JsonRecord;
    const decrypted = this.decryptWechatResource(config, resource);
    const merchantOrderNo = valueOf(decrypted.out_trade_no);
    const intent = await this.prisma.rentalPaymentIntent.findFirst({ where: { tenantId: config.tenantId, provider: "wechat_pay", merchantOrderNo } });
    if (!intent) throw new NotFoundException("微信支付回调对应的支付单不存在");
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
        subject: `Rental OS ${orderNo}`
      })
    };
    const content = stableFormContent(params);
    const body = new URLSearchParams({ ...params, sign: signRsa(valueOf(config.credentials.appPrivateKey), content) }).toString();
    const response = await fetchJson(requiredText(config.settings.gatewayUrl, "网关地址"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body });
    const result = (response.alipay_trade_precreate_response ?? {}) as JsonRecord;
    if (valueOf(result.code) !== "10000") throw new Error(valueOf(result.sub_msg || result.msg || "支付宝下单失败"));
    const checkoutUrl = valueOf(result.qr_code);
    if (!checkoutUrl) throw new Error("支付宝未返回二维码地址");
    return { checkoutUrl, responseCode: valueOf(result.code), responseJson: { code: valueOf(result.code), qrCode: checkoutUrl } };
  }

  private async createWechatIntent(config: TenantIntegrationRuntimeConfig, intent: PaymentIntentRow, orderNo: string) {
    const base = valueOf(config.settings.gatewayUrl || "https://api.mch.weixin.qq.com").replace(/\/$/u, "");
    const path = "/v3/pay/transactions/native";
    const requestBody = JSON.stringify({
      appid: requiredText(config.settings.appId, "应用 ID"),
      mchid: requiredText(config.settings.mchid, "商户号"),
      description: `Rental OS ${orderNo}`,
      out_trade_no: intent.merchantOrderNo,
      notify_url: requiredText(config.settings.notifyUrl, "支付通知地址"),
      amount: { total: Math.round(Number(intent.amount) * 100), currency: "CNY" }
    });
    const requestTimestamp = timestamp();
    const requestNonce = nonce();
    const signature = signRsa(valueOf(config.credentials.merchantPrivateKey), `POST\n${path}\n${requestTimestamp}\n${requestNonce}\n${requestBody}\n`);
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${requiredText(config.settings.mchid, "商户号")}",nonce_str="${requestNonce}",timestamp="${requestTimestamp}",serial_no="${requiredText(config.credentials.merchantSerialNo, "商户证书序列号")}",signature="${signature}"`;
    const response = await fetchJson(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authorization },
      body: requestBody
    });
    const checkoutUrl = valueOf(response.code_url);
    if (!checkoutUrl) throw new Error("微信支付未返回二维码地址");
    return { checkoutUrl, responseCode: "SUCCESS", responseJson: { codeUrl: checkoutUrl } };
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
    if (!input.eventId) throw new BadRequestException("支付回调缺少事件编号");
    try {
      await this.prisma.$transaction(async (tx) => {
        const duplicate = await tx.paymentWebhookEvent.findUnique({ where: { provider_eventId: { provider: input.provider, eventId: input.eventId } } });
        if (duplicate?.status === "processed") return;
        const intent = await tx.rentalPaymentIntent.findFirst({ where: { id: input.intentId, tenantId: input.tenantId } });
        if (!intent) throw new NotFoundException("支付单不存在");
        if (intent.status === "paid") {
          if (duplicate) await tx.paymentWebhookEvent.update({ where: { id: duplicate.id }, data: { status: "processed", processedAt: new Date(), paymentIntentId: intent.id } });
          else await tx.paymentWebhookEvent.create({ data: { tenantId: input.tenantId, provider: input.provider, eventId: input.eventId, paymentIntentId: intent.id, payloadHash: input.payloadHash, status: "processed", processedAt: new Date() } });
          return;
        }
        const webhook = duplicate ?? await tx.paymentWebhookEvent.create({
          data: { tenantId: input.tenantId, provider: input.provider, eventId: input.eventId, paymentIntentId: intent.id, payloadHash: input.payloadHash, status: "processing" }
        });
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

  private toResponse(row: PaymentIntentRow): ClientPaymentIntentResponse {
    return {
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
      message: row.status === "failed" ? "支付平台下单失败，请重新发起" : row.status === "funding_failed" ? "支付已验签但入账失败，请联系运营处理" : undefined
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
