import type { ClientAgreementConsent } from "@rental-os/shared";
import { adoptSession, createChallenge, loginWithPassword, loginWithSms, loginWithWechatPhone, verifyRegistrationChallenge } from "../../api/auth";
import { describeError } from "../../core/errors";
import { isApiError } from "../../core/http";
import { newKey } from "../../core/keys";
import { cachedMerchant, loadMerchant, preferredServiceCode, resolveServiceCode, type MerchantInfo } from "../../core/merchant";
import { resolvePublicImageUrl } from "../../core/public-asset";
import { type FieldErrors } from "../../core/page";
import { isSignedIn, principalVersion } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, callPhone, navigate, redirect, safeRoute, toast } from "../../core/ui";

/**
 * P11 登录/授权（需求 §5.1）。
 * 按商户公开渠道提供微信手机号、短信或密码登录，服务端裁定身份与证明用途。
 * 短信证明只有一次消费；失应答不重复验证，页面/本人/服务变化后不采用旧会话。
 * 协议默认不勾选，必须主动同意；返回目标只能是白名单页面且不带私有参数。
 */
interface LoginData {
  merchantName: string;
  merchantInitial: string;
  merchantLogo: string;
  servicePhone: string;
  agreementName: string;
  agreementVersion: string;
  privacyName: string;
  privacyVersion: string;
  agreementsProvided: boolean;
  wechatAvailable: boolean;
  wechatNotice: string;
  showPassword: boolean;
  smsAvailable: boolean;
  passwordAvailable: boolean;
  loginUnavailable: boolean;
  authMode: "password" | "sms";
  smsCode: string;
  smsMasked: string;
  smsRetryAfter: number;
  smsDevelopmentCode: string;
  loginIdentifier: string;
  password: string;
  agreed: boolean;
  submitting: boolean;
  errors: FieldErrors;
  formError: string;
}

Page({
  behaviors: [themeBehavior],
  data: {
    merchantName: "",
    merchantInitial: "·",
    merchantLogo: "",
    servicePhone: "",
    agreementName: "用户服务协议",
    agreementVersion: "",
    privacyName: "隐私政策",
    privacyVersion: "",
    agreementsProvided: false,
    wechatAvailable: true,
    wechatNotice: "",
    showPassword: false,
    smsAvailable: false,
    passwordAvailable: true,
    loginUnavailable: false,
    authMode: "password",
    smsCode: "",
    smsMasked: "",
    smsRetryAfter: 0,
    smsDevelopmentCode: "",
    loginIdentifier: "",
    password: "",
    agreed: false,
    submitting: false,
    errors: {},
    formError: "",
  } as LoginData,

  redirectTo: ROUTES.home as string,
  loginCode: "" as string,
  smsChallengeId: "" as string,
  smsChallengeKey: "" as string,
  smsCountdown: undefined as number | undefined,
  loginActive: true,
  loginGeneration: 0,
  loginPending: false,

  captureLoginAttempt() {
    const generation = this.loginGeneration;
    const principal = principalVersion();
    const serviceCode = preferredServiceCode();
    return { serviceCode, current: () => this.loginActive && this.loginGeneration === generation
      && principalVersion() === principal && preferredServiceCode() === serviceCode };
  },

  onUnload() {
    this.loginActive = false;
    this.loginGeneration++;
    if (this.smsCountdown) clearInterval(this.smsCountdown);
  },

  onHide() {
    this.loginActive = false;
    this.loginGeneration++;
  },

  onShow() {
    this.loginActive = true;
    this.setData({ submitting: this.loginPending });
  },

  onLoad(options: Record<string, string | undefined>) {
    this.loginActive = true;
    this.redirectTo = safeRoute(options.redirect, ROUTES.home);
    if (isSignedIn()) {
      redirect(this.redirectTo);
      return;
    }
    const cached = cachedMerchant();
    if (cached) this.applyMerchant(cached);
    loadMerchant(false).then((info) => { if (this.loginActive) this.applyMerchant(info); }).catch(() => undefined);
    this.prefetchLoginCode();
  },

  applyMerchant(info: MerchantInfo) {
    const agreements = info.agreements;
    this.setData({
      merchantName: info.name,
      merchantInitial: info.name.trim().charAt(0) || "·",
      // 只接受可信 API 域名下的租户图片；缺省/非法时留空，由页面回落到商户名首字。
      merchantLogo: resolvePublicImageUrl(info.logoUrl) ?? "",
      servicePhone: info.servicePhone ?? "",
      agreementsProvided: Boolean(agreements),
      agreementName: agreements?.userAgreement.name ?? "用户服务协议",
      agreementVersion: agreements?.userAgreement.version ?? "",
      privacyName: agreements?.privacyPolicy.name ?? "隐私政策",
      privacyVersion: agreements?.privacyPolicy.version ?? "",
      wechatAvailable: info.loginMethods.includes("wechat_phone"),
      smsAvailable: info.loginMethods.includes("sms"),
      passwordAvailable: info.loginMethods.includes("password"),
      loginUnavailable: info.loginMethods.length === 0,
      authMode: info.loginMethods.includes("password") ? this.data.authMode : info.loginMethods.includes("sms") ? "sms" : this.data.authMode,
      showPassword: info.loginMethods.some((method) => method === "password" || method === "sms")
        && (!info.loginMethods.includes("wechat_phone") || this.data.showPassword),
      wechatNotice: info.loginMethods.includes("wechat_phone") ? "" : "商户尚未开通微信手机号一键登录，请使用其他方式登录。",
    });
  },

  /** wx.login 的 code 5 分钟有效且一次性；提前取一个，授权手机号时若已失效再取。 */
  prefetchLoginCode() {
    wx.login({ success: (res) => { this.loginCode = res.code ?? ""; }, fail: () => { this.loginCode = ""; } });
  },

  freshLoginCode(): Promise<string> {
    return new Promise((resolve) => {
      wx.login({ success: (res) => resolve(res.code ?? ""), fail: () => resolve("") });
    });
  },

  consent(): ClientAgreementConsent | undefined {
    if (!this.data.agreed) return undefined;
    return {
      userAgreementVersion: this.data.agreementVersion || "unversioned",
      privacyPolicyVersion: this.data.privacyVersion || "unversioned",
      agreedAt: new Date().toISOString()
    };
  },

  onAgreeChange(event: WechatMiniprogram.CheckboxGroupChange) {
    this.setData({ agreed: (event.detail.value as string[]).length > 0, formError: "" });
  },

  onOpenAgreement() {
    navigate(buildUrl(ROUTES.legal, { doc: "agreement" }));
  },

  onOpenPrivacy() {
    navigate(buildUrl(ROUTES.legal, { doc: "privacy" }));
  },

  requireConsent(): boolean {
    if (this.data.agreed) return true;
    this.setData({ formError: `请先阅读并同意《${this.data.agreementName}》和《${this.data.privacyName}》` });
    return false;
  },

  /** 微信手机号授权：组件回调只给一次性 code，手机号由服务端解析。 */
  async onPhoneNumber(event: WechatMiniprogram.ButtonGetPhoneNumber) {
    if (this.loginPending || this.data.submitting) return;
    const phoneCode = (event.detail as { code?: string; errMsg?: string }).code;
    if (!phoneCode) {
      const message = String((event.detail as { errMsg?: string }).errMsg ?? "");
      if (/deny|cancel/i.test(message)) {
        this.setData({ formError: "你已拒绝手机号授权，可改用手机号密码登录，或继续浏览设备。", showPassword: true });
      } else {
        this.setData({ formError: "未能获取手机号授权，请重试或改用手机号密码登录。", showPassword: true });
      }
      return;
    }
    if (!this.requireConsent()) return;
    const consent = this.consent()!;
    const attempt = this.captureLoginAttempt();
    this.loginPending = true;
    this.setData({ submitting: true, formError: "" });
    try {
      const loginCode = this.loginCode || (await this.freshLoginCode());
      if (!attempt.current()) return;
      this.loginCode = "";
      if (!loginCode) throw new Error("未能获取微信登录凭证，请重试");
      const session = await loginWithWechatPhone({ loginCode, phoneCode, consent, serviceCode: attempt.serviceCode });
      if (attempt.current()) this.finish(session);
    } catch (error) {
      if (!attempt.current()) return;
      this.prefetchLoginCode();
      if (isApiError(error, "UNAVAILABLE")) {
        this.setData({ wechatAvailable: false, showPassword: true, wechatNotice: describeError(error).message });
      } else {
        this.setData({ formError: describeError(error).message });
      }
    } finally {
      this.loginPending = false;
      if (this.loginActive) this.setData({ submitting: false });
    }
  },

  onTogglePassword() {
    this.setData({ showPassword: !this.data.showPassword, formError: "" });
  },

  /* ---------- MP-02B 短信验证码登录 ---------- */
  onSwitchAuthMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode ?? "password") === "sms" ? "sms" : "password";
    if (mode !== this.data.authMode) this.loginGeneration++;
    this.setData({ authMode: mode, formError: "", errors: {} });
  },

  onSmsCodeInput(event: WechatMiniprogram.Input) {
    this.setData({ smsCode: String(event.detail.value ?? ""), "errors.smsCode": "" });
  },

  startSmsCountdown(seconds: number) {
    if (this.smsCountdown) clearInterval(this.smsCountdown);
    this.setData({ smsRetryAfter: seconds });
    if (seconds <= 0) return;
    this.smsCountdown = setInterval(() => {
      const next = this.data.smsRetryAfter - 1;
      this.setData({ smsRetryAfter: Math.max(0, next) });
      if (next <= 0 && this.smsCountdown) clearInterval(this.smsCountdown);
    }, 1000) as unknown as number;
  },

  async onSendSmsCode() {
    if (this.loginPending || this.data.submitting || this.data.smsRetryAfter > 0) return;
    const identifier = this.data.loginIdentifier.trim().replace(/[\s-]/g, "");
    if (!/^\+?[0-9]{6,20}$/.test(identifier)) {
      this.setData({ errors: { loginIdentifier: "请输入正确的手机号" } });
      return;
    }
    const attempt = this.captureLoginAttempt();
    this.loginPending = true;
    this.setData({ submitting: true, formError: "" });
    try {
      // 同一手机号重试复用同一幂等键；换号码才换键。login 用途要求该手机号已注册，未注册时服务端返回明确错误。
      const fingerprint = `login-sms:${identifier}`;
      if (!this.smsChallengeKey.startsWith(`${fingerprint}|`)) this.smsChallengeKey = `${fingerprint}|${newKey("challenge")}`;
      const challenge = await createChallenge({ purpose: "login", method: "sms", identifier, idempotencyKey: this.smsChallengeKey.split("|")[1], serviceCode: attempt.serviceCode });
      if (!attempt.current()) return;
      this.smsChallengeId = challenge.challengeId;
      this.setData({ smsMasked: challenge.maskedDestination, smsDevelopmentCode: challenge.developmentCode ?? "", smsCode: "" });
      this.startSmsCountdown(challenge.retryAfterSeconds ?? 60);
    } catch (error) {
      if (!attempt.current()) return;
      const presented = describeError(error);
      if (presented.code === "RATE_LIMITED") this.startSmsCountdown((error as { retryAfterSeconds?: number }).retryAfterSeconds ?? 60);
      this.setData({ formError: presented.message });
    } finally {
      this.loginPending = false;
      if (this.loginActive) this.setData({ submitting: false });
    }
  },

  async onSmsLogin() {
    if (this.loginPending || this.data.submitting) return;
    const identifier = this.data.loginIdentifier.trim().replace(/[\s-]/g, "");
    const errors: FieldErrors = {};
    if (!/^\+?[0-9]{6,20}$/.test(identifier)) errors.loginIdentifier = "请输入正确的手机号";
    if (!this.smsChallengeId) errors.smsCode = "请先获取验证码";
    else if (!/^\d{6}$/.test(this.data.smsCode.trim())) errors.smsCode = "请输入 6 位验证码";
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    if (!this.requireConsent()) return;
    const challengeId = this.smsChallengeId;
    const code = this.data.smsCode.trim();
    const attempt = this.captureLoginAttempt();
    this.loginPending = true;
    this.setData({ submitting: true, formError: "" });
    let stage: "verify" | "login" = "verify";
    try {
      const verified = await verifyRegistrationChallenge(challengeId, code);
      stage = "login";
      // 只清除这次已验证的挑战，迟到结果不能覆盖用户后来选择的手机号。
      if (this.smsChallengeId === challengeId) {
        this.smsChallengeId = "";
        this.smsChallengeKey = "";
      }
      if (!attempt.current()) return;
      // preferredServiceCode 只会返回商户当前已发布的服务，不会因过期服务导致拒登；验证令牌一次性，故不重试。
      const session = await loginWithSms({ loginIdentifier: identifier, verificationToken: verified.verificationToken, serviceCode: attempt.serviceCode });
      if (attempt.current()) this.finish(session);
    } catch (error) {
      if (!attempt.current()) return;
      const presented = describeError(error);
      if (stage === "verify") {
        // 验证码错误可重输；挑战已过期/已用尽（409/404）则必须重新获取（并换幂等键）。
        if (presented.code === "CONFLICT" || presented.code === "NOT_FOUND") {
          this.smsChallengeId = "";
          this.smsChallengeKey = "";
        }
        this.setData({ errors: { ...this.data.errors, smsCode: presented.code === "CONFLICT" || presented.code === "NOT_FOUND" ? `${presented.message}，请重新获取验证码` : presented.message } });
      } else {
        // 网络或服务端失应答不证明会话未创建，原证明不能盲目重发。
        const status = (error as { status?: number }).status;
        this.setData({ smsCode: "", formError: status && status >= 400 && status < 500
          ? `${presented.message} 请重新获取验证码或改用密码登录。`
          : "本次短信登录结果未确认，请检查当前登录状态或改用密码登录；再次短信登录需重新获取验证码。" });
      }
    } finally {
      this.loginPending = false;
      if (this.loginActive) this.setData({ submitting: false });
    }
  },

  onIdentifierInput(event: WechatMiniprogram.Input) {
    const identifier = String(event.detail.value ?? "");
    if (identifier.trim().replace(/[\s-]/g, "") !== this.data.loginIdentifier.trim().replace(/[\s-]/g, "")) {
      this.loginGeneration++;
      this.smsChallengeId = "";
      this.smsChallengeKey = "";
    }
    this.setData({ loginIdentifier: identifier, "errors.loginIdentifier": "" });
  },

  onPasswordInput(event: WechatMiniprogram.Input) {
    this.setData({ password: String(event.detail.value ?? ""), "errors.password": "" });
  },

  async onPasswordLogin() {
    if (this.loginPending || this.data.submitting) return;
    const errors: FieldErrors = {};
    const identifier = this.data.loginIdentifier.trim().replace(/[\s-]/g, "");
    if (!/^\+?[0-9]{6,20}$/.test(identifier)) errors.loginIdentifier = "请输入正确的手机号";
    if (!this.data.password) errors.password = "请输入密码";
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    if (!this.requireConsent()) return;
    const password = this.data.password;
    const attempt = this.captureLoginAttempt();
    this.loginPending = true;
    this.setData({ submitting: true, formError: "" });
    try {
      const session = await this.passwordLogin(identifier, password, attempt);
      if (attempt.current()) this.finish(session);
    } catch (error) {
      if (!attempt.current()) return;
      const presented = describeError(error);
      this.setData({ formError: presented.code === "UNAUTHENTICATED" ? "手机号或密码不正确" : presented.message });
    } finally {
      this.loginPending = false;
      if (this.loginActive) this.setData({ submitting: false });
    }
  },

  /** 带初始服务登录；该服务已不可用（403/404）时退回不指定服务再试一次，由服务端选默认服务。 */
  async passwordLogin(identifier: string, password: string, attempt: { serviceCode: string | undefined; current: () => boolean }) {
    const serviceCode = attempt.serviceCode;
    try {
      return await loginWithPassword({ loginIdentifier: identifier, password, serviceCode });
    } catch (error) {
      if (attempt.current() && serviceCode && (isApiError(error, "FORBIDDEN") || isApiError(error, "NOT_FOUND"))) {
        return loginWithPassword({ loginIdentifier: identifier, password });
      }
      throw error;
    }
  },

  finish(session: Parameters<typeof adoptSession>[0]) {
    const preferred = preferredServiceCode() ?? resolveServiceCode(cachedMerchant());
    adoptSession(session, preferred, "login");
    toast("登录成功", { icon: "success" });
    redirect(this.redirectTo);
  },

  onRegister() {
    navigate(buildUrl(ROUTES.register, { redirect: this.redirectTo }));
  },

  onContact() {
    callPhone(this.data.servicePhone);
  },

  /** 商户品牌图加载失败（坏链/未加白名单）：回落到商户名首字头像，不显示破图。 */
  onLogoError() {
    if (this.data.merchantLogo) this.setData({ merchantLogo: "" });
  },

  onBrowse() {
    redirect(ROUTES.home);
  }
});
