import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { TenantIntegrationProvider } from "@rental-os/shared";
import { assertOutboundUrl } from "../../common/outbound-url";
import { PrismaService } from "../database/prisma.service";
import { TenantIntegrationService, type TenantIntegrationRuntimeConfig } from "./tenant-integration.service";

export interface VerificationSmsResult {
  configured: boolean;
  provider?: TenantIntegrationProvider;
  externalRequestId?: string;
}

export interface NotificationSmsResult extends VerificationSmsResult {}

/**
 * 请求已经离开本服务，但没有拿到服务商的确定响应。
 * 这种情况不能当作“发送失败”自动重试，否则服务商可能已经受理而造成重复短信。
 */
export class NotificationDeliveryUnknownError extends ServiceUnavailableException {
  constructor(message = "短信服务商响应未知，请先查询服务商投递记录") {
    super(message);
    this.name = "NotificationDeliveryUnknownError";
  }
}

type JsonRecord = Record<string, unknown>;

const maskPhone = (value: string) => value.length <= 4 ? "****" : `${value.slice(0, 3)}****${value.slice(-4)}`;

function text(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!result) throw new ServiceUnavailableException(`短信平台缺少配置：${field}`);
  return result;
}

function rfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key: string | Buffer, value: string, encoding: "hex" | "buffer" = "hex") {
  const digest = createHmac("sha256", key).update(value).digest();
  return encoding === "buffer" ? digest : digest.toString("hex");
}

function hmacSha1Base64(key: string, value: string) {
  return createHmac("sha1", key).update(value).digest("base64");
}

async function fetchWithTimeout(url: string, init: RequestInit, productionHosts: readonly string[], timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const safeUrl = await assertOutboundUrl(url, "短信平台请求地址", { allowQuery: true, productionHosts });
    return await fetch(safeUrl, { ...init, redirect: "error", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class TenantIntegrationRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: TenantIntegrationService
  ) {}

  /**
   * 只做平台连通性验证，不发送任何短信。
   * 阿里云调用模板列表查询，腾讯云调用模板列表查询；两者都不会产生计费投递。
   */
  async testConnection(config: TenantIntegrationRuntimeConfig): Promise<string> {
    if (config.provider === "aliyun_sms") {
      const accessKeyId = text(config.credentials.accessKeyId, "AccessKey ID");
      const accessKeySecret = text(config.credentials.accessKeySecret, "AccessKey Secret");
      const params: Record<string, string> = {
        AccessKeyId: accessKeyId,
        Action: "QuerySmsTemplateList",
        Format: "JSON",
        PageIndex: "1",
        PageSize: "1",
        RegionId: text(config.settings.region, "地域"),
        SignatureMethod: "HMAC-SHA1",
        SignatureNonce: randomUUID(),
        SignatureVersion: "1.0",
        Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
        Version: "2017-05-25",
        Signature: ""
      };
      const canonical = Object.keys(params)
        .filter((key) => key !== "Signature")
        .sort()
        .map((key) => `${rfc3986(key)}=${rfc3986(params[key])}`)
        .join("&");
      params.Signature = hmacSha1Base64(`${accessKeySecret}&`, `GET&%2F&${rfc3986(canonical)}`);
      const query = Object.keys(params).sort().map((key) => `${rfc3986(key)}=${rfc3986(params[key])}`).join("&");
      const response = await fetchWithTimeout(`https://dysmsapi.aliyuncs.com/?${query}`, { method: "GET" }, ["dysmsapi.aliyuncs.com"]);
      const body = await this.readJson(response);
      if (!response.ok || body.Code !== "OK") throw new Error("阿里云短信模板查询失败");
      return "已验证阿里云短信连接（仅查询模板，未发送短信）。";
    }

    if (config.provider === "tencent_sms") {
      const secretId = text(config.credentials.secretId, "SecretId");
      const secretKey = text(config.credentials.secretKey, "SecretKey");
      const host = "sms.tencentcloudapi.com";
      const service = "sms";
      const action = "DescribeSmsTemplateList";
      const version = "2021-01-11";
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({ International: 0, Limit: 1, Offset: 0 });
      const contentType = "application/json; charset=utf-8";
      const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
      const signedHeaders = "content-type;host";
      const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(payload)}`;
      const date = new Date(timestamp * 1000).toISOString().slice(0, 10).replace(/-/g, "");
      const credentialScope = `${date}/${service}/tc3_request`;
      const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(canonicalRequest)}`;
      const secretDate = hmacSha256(`TC3${secretKey}`, date, "buffer") as Buffer;
      const secretService = hmacSha256(secretDate, service, "buffer") as Buffer;
      const secretSigning = hmacSha256(secretService, "tc3_request", "buffer") as Buffer;
      const signature = hmacSha256(secretSigning, stringToSign);
      const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
      const response = await fetchWithTimeout(`https://${host}`, {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          Host: host,
          "X-TC-Action": action,
          "X-TC-Version": version,
          "X-TC-Region": text(config.settings.region, "地域"),
          "X-TC-Timestamp": String(timestamp),
          "X-TC-RequestClient": "rental-os",
          Authorization: authorization
        },
        body: payload
      }, [host]);
      const body = await this.readJson(response);
      const responseBody = (body.Response ?? {}) as JsonRecord;
      if (!response.ok || responseBody.Error) throw new Error("腾讯云短信模板查询失败");
      return "已验证腾讯云短信连接（仅查询模板，未发送短信）。";
    }
    throw new ServiceUnavailableException("未实现的短信平台适配器");
  }

  async sendVerificationSms(
    tenantId: string,
    phone: string,
    code: string,
    idempotencyKey: string
  ): Promise<VerificationSmsResult> {
    const config = await this.integrations.runtimeConfig("sms", tenantId);
    if (!config) return { configured: false };
    try {
      const externalRequestId = config.provider === "aliyun_sms"
        ? await this.sendAliyun(config, phone, code, idempotencyKey)
        : config.provider === "tencent_sms"
          ? await this.sendTencent(config, phone, code, idempotencyKey)
          : (() => { throw new ServiceUnavailableException("未实现的短信平台适配器"); })();
      await this.tryLog(tenantId, config, "send_verification_sms", "success", {
        phone: maskPhone(phone),
        requestId: idempotencyKey
      }, { externalRequestId });
      return { configured: true, provider: config.provider, externalRequestId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "短信平台调用失败";
      await this.tryLog(tenantId, config, "send_verification_sms", "failed", {
        phone: maskPhone(phone),
        requestId: idempotencyKey
      }, undefined, message);
      throw error instanceof NotificationDeliveryUnknownError || error instanceof ServiceUnavailableException
        ? error
        : new ServiceUnavailableException(`短信发送失败：${message.slice(0, 180)}`);
    }
  }

  /**
   * 发送业务通知短信。模板编码来自经营空间的通知模板版本，变量值只在本次请求体中
   * 传给服务商，外部适配日志只记录变量名，避免把订单号、客户名等业务内容再复制进日志。
   */
  async sendNotificationSms(
    tenantId: string,
    phone: string,
    templateCode: string,
    variables: Record<string, unknown>,
    variableNames: string[],
    idempotencyKey: string
  ): Promise<NotificationSmsResult> {
    const config = await this.integrations.runtimeConfig("sms", tenantId);
    if (!config) return { configured: false };
    const names = [...new Set(variableNames)].slice(0, 20);
    const values = names.map((name) => {
      const value = variables[name];
      if (typeof value === "object" && value !== null) {
        throw new ServiceUnavailableException(`短信模板变量 ${name} 的值无效`);
      }
      const result = value === undefined || value === null ? "" : String(value);
      if (result.length > 191) throw new ServiceUnavailableException(`短信模板变量 ${name} 超出长度限制`);
      return result;
    });
    const code = text(templateCode, "短信服务商模板编码");
    if (!/^[A-Za-z0-9_.-]{1,191}$/u.test(code)) throw new ServiceUnavailableException("短信服务商模板编码格式无效");
    try {
      const externalRequestId = config.provider === "aliyun_sms"
        ? await this.sendAliyunTemplate(config, phone, code, Object.fromEntries(names.map((name, index) => [name, values[index]])), idempotencyKey)
        : config.provider === "tencent_sms"
          ? await this.sendTencentTemplate(config, phone, code, values, idempotencyKey)
          : (() => { throw new ServiceUnavailableException("未实现的短信平台适配器"); })();
      // 服务商已返回确定成功后，适配器审计日志写入失败不能把本次调用改判为失败，
      // 否则上层重试会造成重复短信。投递事实由业务 outbox 另行落库。
      await this.tryLog(tenantId, config, "send_notification_sms", "success", {
        phone: maskPhone(phone),
        templateCode: code,
        variableKeys: names,
        requestId: idempotencyKey
      }, { externalRequestId });
      return { configured: true, provider: config.provider, externalRequestId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "短信平台调用失败";
      await this.tryLog(tenantId, config, "send_notification_sms", "failed", {
        phone: maskPhone(phone),
        templateCode: code,
        variableKeys: names,
        requestId: idempotencyKey
      }, undefined, message);
      throw error instanceof NotificationDeliveryUnknownError || error instanceof ServiceUnavailableException
        ? error
        : new ServiceUnavailableException(`短信发送失败：${message.slice(0, 180)}`);
    }
  }

  private async sendAliyun(config: TenantIntegrationRuntimeConfig, phone: string, code: string, idempotencyKey: string) {
    return this.sendAliyunTemplate(config, phone, text(config.settings.verificationTemplateCode, "验证码模板编码"), { code }, idempotencyKey);
  }

  private async sendAliyunTemplate(
    config: TenantIntegrationRuntimeConfig,
    phone: string,
    templateCode: string,
    variables: Record<string, string>,
    idempotencyKey: string
  ) {
    const accessKeyId = text(config.credentials.accessKeyId, "AccessKey ID");
    const accessKeySecret = text(config.credentials.accessKeySecret, "AccessKey Secret");
    const params: Record<string, string> = {
      AccessKeyId: accessKeyId,
      Action: "SendSms",
      Format: "JSON",
      PhoneNumbers: phone,
      RegionId: text(config.settings.region, "地域"),
      SignName: text(config.settings.signName, "短信签名"),
      SignatureMethod: "HMAC-SHA1",
      SignatureNonce: randomUUID(),
      SignatureVersion: "1.0",
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify(variables),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
      Version: "2017-05-25",
      Signature: ""
    };
    const canonical = Object.keys(params)
      .filter((key) => key !== "Signature")
      .sort()
      .map((key) => `${rfc3986(key)}=${rfc3986(params[key])}`)
      .join("&");
    const stringToSign = `GET&%2F&${rfc3986(canonical)}`;
    params.Signature = hmacSha1Base64(`${accessKeySecret}&`, stringToSign);
    const query = Object.keys(params).sort().map((key) => `${rfc3986(key)}=${rfc3986(params[key])}`).join("&");
    let response: Response;
    let body: JsonRecord;
    try {
      response = await fetchWithTimeout(`https://dysmsapi.aliyuncs.com/?${query}`, { method: "GET", headers: { "x-acs-signature-nonce": idempotencyKey } }, ["dysmsapi.aliyuncs.com"]);
      body = await this.readJson(response);
    } catch (error) {
      if (error instanceof ServiceUnavailableException && !(error instanceof NotificationDeliveryUnknownError)) throw error;
      throw new NotificationDeliveryUnknownError();
    }
    if (!response.ok || body.Code !== "OK") throw new Error(String(body.Message ?? `HTTP ${response.status}`));
    return String(body.RequestId ?? idempotencyKey);
  }

  private async sendTencent(config: TenantIntegrationRuntimeConfig, phone: string, code: string, idempotencyKey: string) {
    return this.sendTencentTemplate(config, phone, text(config.settings.verificationTemplateId, "验证码模板 ID"), [code], idempotencyKey);
  }

  private async sendTencentTemplate(
    config: TenantIntegrationRuntimeConfig,
    phone: string,
    templateCode: string,
    variableValues: string[],
    idempotencyKey: string
  ) {
    const secretId = text(config.credentials.secretId, "SecretId");
    const secretKey = text(config.credentials.secretKey, "SecretKey");
    const host = "sms.tencentcloudapi.com";
    const service = "sms";
    const action = "SendSms";
    const version = "2021-01-11";
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      SmsSdkAppId: text(config.settings.smsSdkAppId, "SmsSdkAppId"),
      SignName: text(config.settings.signName, "短信签名"),
      TemplateId: templateCode,
      TemplateParamSet: variableValues,
      PhoneNumberSet: [phone]
    });
    const contentType = "application/json; charset=utf-8";
    const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
    const signedHeaders = "content-type;host";
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(payload)}`;
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10).replace(/-/g, "");
    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(canonicalRequest)}`;
    const secretDate = hmacSha256(`TC3${secretKey}`, date, "buffer") as Buffer;
    const secretService = hmacSha256(secretDate, service, "buffer") as Buffer;
    const secretSigning = hmacSha256(secretService, "tc3_request", "buffer") as Buffer;
    const signature = hmacSha256(secretSigning, stringToSign);
    const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    let response: Response;
    let body: JsonRecord;
    try {
      response = await fetchWithTimeout(`https://${host}`, {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          Host: host,
          "X-TC-Action": action,
          "X-TC-Version": version,
          "X-TC-Region": text(config.settings.region, "地域"),
          "X-TC-Timestamp": String(timestamp),
          "X-TC-RequestClient": "rental-os",
          Authorization: authorization,
          "X-Rental-Idempotency-Key": idempotencyKey
        },
        body: payload
      }, [host]);
      body = await this.readJson(response);
    } catch (error) {
      if (error instanceof ServiceUnavailableException && !(error instanceof NotificationDeliveryUnknownError)) throw error;
      throw new NotificationDeliveryUnknownError();
    }
    const responseBody = (body.Response ?? {}) as JsonRecord;
    const error = responseBody.Error as JsonRecord | undefined;
    if (!response.ok || error) throw new Error(String(error?.Message ?? `HTTP ${response.status}`));
    return String(responseBody.RequestId ?? idempotencyKey);
  }

  private async readJson(response: Response): Promise<JsonRecord> {
    const raw = await response.text();
    try {
      return JSON.parse(raw) as JsonRecord;
    } catch {
      return { Message: raw.slice(0, 180) };
    }
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
        requestJson: requestJson as never,
        responseJson: responseJson as never,
        errorMessage: errorMessage?.slice(0, 500)
      }
    });
  }

  /** 审计日志不可用时不能改变已经完成的外部投递结果，也不能把秘密写入日志。 */
  private async tryLog(
    tenantId: string,
    config: TenantIntegrationRuntimeConfig,
    operation: string,
    status: string,
    requestJson: JsonRecord,
    responseJson?: JsonRecord,
    errorMessage?: string
  ) {
    try {
      await this.log(tenantId, config, operation, status, requestJson, responseJson, errorMessage);
    } catch {
      // 业务 outbox 仍会保存投递状态；审计日志故障交给基础设施监控处理。
    }
  }
}
