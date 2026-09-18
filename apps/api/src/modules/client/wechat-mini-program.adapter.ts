import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { HttpException, HttpStatus } from "@nestjs/common";
import { assertOutboundUrl } from "../../common/outbound-url";

/**
 * 微信小程序服务端接口适配器（MP-02A）。
 *
 * 三个调用都必须持商户 AppSecret 在服务端完成，小程序包内不允许出现密钥：
 * - code2Session：wx.login 的 code → openid / unionid（session_key 不落库、不返回）；
 * - stable_token：接口调用凭据，按 AppID 在内存缓存到过期前 5 分钟；
 * - getuserphonenumber：手机号授权组件的一次性 code → 手机号（附 AppID 水印，调用方须核对）。
 *
 * 微信返回的 errcode 映射为稳定的 HTTP 语义：凭证类错误 401、频控 429、商户凭据/平台问题 503。
 * 没有真实 AppID/AppSecret 时这些调用只会失败，不存在“模拟成功”的分支。
 */
export interface WechatCodeSession {
  openid: string;
  unionid?: string;
}

export interface WechatPhoneInfo {
  phoneNumber: string;
  purePhoneNumber: string;
  countryCode: string;
  /** 微信返回的水印 AppID，必须与商户渠道 AppID 一致。 */
  watermarkAppId?: string;
}

export class WechatApiError extends Error {
  constructor(readonly errcode: number, message: string) {
    super(message);
    this.name = "WechatApiError";
  }
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_BASE_URL = "https://api.weixin.qq.com";
const TOKEN_REFRESH_MARGIN_SECONDS = 300;
/** 微信文档中的常见错误码：只做语义分类，不把具体码硬编码进业务判断。 */
const INVALID_CREDENTIAL_CODES = new Set([40029, 40163, 40226, 42001, 42003, 40125, 41008]);
const MERCHANT_CONFIG_CODES = new Set([40001, 40002, 40013, 41002, 41004, 40066, 48001]);
const RATE_LIMIT_CODES = new Set([45009, 45011, 45166]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

@Injectable()
export class WechatMiniProgramAdapter {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  private baseUrl() {
    return (process.env.WECHAT_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/u, "");
  }

  private async call(path: string, init: { method: "GET" | "POST"; query?: Record<string, string>; body?: JsonRecord }, timeoutMs = 8_000): Promise<JsonRecord> {
    const params = new URLSearchParams(init.query ?? {}).toString();
    const url = `${this.baseUrl()}${path}${params ? `?${params}` : ""}`;
    const safeUrl = await assertOutboundUrl(url, "微信接口地址", { allowQuery: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(safeUrl, {
        method: init.method,
        headers: init.body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
        body: init.body ? JSON.stringify(init.body) : undefined,
        redirect: "error",
        signal: controller.signal
      });
    } catch {
      throw new ServiceUnavailableException("无法连接微信接口，请稍后重试");
    } finally {
      clearTimeout(timer);
    }
    let payload: JsonRecord;
    try {
      payload = (await response.json()) as JsonRecord;
    } catch {
      throw new ServiceUnavailableException("微信接口返回了无法解析的内容");
    }
    const errcode = Number(payload.errcode ?? 0);
    if (!response.ok || (errcode && errcode !== 0)) {
      throw new WechatApiError(errcode || response.status, text(payload.errmsg) || `微信接口返回 HTTP ${response.status}`);
    }
    return payload;
  }

  /** 把微信错误翻译成客户端可理解的 HTTP 语义；未知错误一律视为平台暂不可用。 */
  static translate(error: unknown, context: "login" | "phone" | "credentials"): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof WechatApiError) {
      if (RATE_LIMIT_CODES.has(error.errcode)) return new HttpException("微信接口调用过于频繁，请稍后重试", HttpStatus.TOO_MANY_REQUESTS);
      if (MERCHANT_CONFIG_CODES.has(error.errcode)) return new ServiceUnavailableException("商户小程序凭据无效或未授权，请联系商户");
      if (INVALID_CREDENTIAL_CODES.has(error.errcode)) {
        return new UnauthorizedException(context === "phone" ? "手机号授权凭证无效或已使用，请重新授权" : "微信登录凭证无效或已使用，请重试");
      }
      return new ServiceUnavailableException(`微信接口暂不可用（${error.errcode}）`);
    }
    return new ServiceUnavailableException("微信接口暂不可用，请稍��重试");
  }

  async code2Session(appId: string, appSecret: string, jsCode: string): Promise<WechatCodeSession> {
    const payload = await this.call("/sns/jscode2session", { method: "GET", query: { appid: appId, secret: appSecret, js_code: jsCode, grant_type: "authorization_code" } });
    const openid = text(payload.openid);
    if (!openid) throw new WechatApiError(-1, "微信未返回 openid");
    // session_key 只用于解密旧版加密数据；本实现不解密任何客户端上传的密文，因此不保留。
    return { openid, unionid: text(payload.unionid) || undefined };
  }

  async accessToken(appId: string, appSecret: string, forceRefresh = false): Promise<string> {
    const cached = this.tokens.get(appId);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.token;
    const payload = await this.call("/cgi-bin/stable_token", {
      method: "POST",
      body: { grant_type: "client_credential", appid: appId, secret: appSecret, force_refresh: forceRefresh }
    });
    const token = text(payload.access_token);
    const expiresIn = Number(payload.expires_in ?? 0);
    if (!token) throw new WechatApiError(-1, "微信未返回接口调用凭据");
    this.tokens.set(appId, { token, expiresAt: Date.now() + Math.max(60, expiresIn - TOKEN_REFRESH_MARGIN_SECONDS) * 1000 });
    return token;
  }

  async phoneNumber(appId: string, appSecret: string, phoneCode: string): Promise<WechatPhoneInfo> {
    const attempt = async (forceRefresh: boolean) => {
      const token = await this.accessToken(appId, appSecret, forceRefresh);
      return this.call("/wxa/business/getuserphonenumber", { method: "POST", query: { access_token: token }, body: { code: phoneCode } });
    };
    let payload: JsonRecord;
    try {
      payload = await attempt(false);
    } catch (error) {
      // 凭据过期/失效时刷新一次再试；其他错误原样抛出。
      if (error instanceof WechatApiError && [40001, 42001, 40014].includes(error.errcode)) payload = await attempt(true);
      else throw error;
    }
    const info = (payload.phone_info ?? {}) as JsonRecord;
    const watermark = (info.watermark ?? {}) as JsonRecord;
    const purePhoneNumber = text(info.purePhoneNumber);
    const phoneNumber = text(info.phoneNumber) || purePhoneNumber;
    if (!purePhoneNumber && !phoneNumber) throw new WechatApiError(-1, "微信未返回手机号");
    return {
      phoneNumber,
      purePhoneNumber: purePhoneNumber || phoneNumber,
      countryCode: text(info.countryCode) || "86",
      watermarkAppId: text(watermark.appid) || undefined
    };
  }

  /** 运营端“测试连接”：只换取一次接口凭据，不读取任何用户数据。 */
  async verifyCredentials(appId: string, appSecret: string): Promise<void> {
    await this.accessToken(appId, appSecret, true);
  }

  /** 仅供测试：清空凭据缓存。 */
  resetForTest(): void {
    this.tokens.clear();
  }
}
