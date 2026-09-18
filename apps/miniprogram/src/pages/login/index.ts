import type { ClientAgreementConsent } from "@rental-os/shared";
import { adoptSession, loginWithPassword, loginWithWechatPhone } from "../../api/auth";
import { describeError } from "../../core/errors";
import { isApiError } from "../../core/http";
import { cachedMerchant, loadMerchant, preferredServiceCode, resolveServiceCode, type MerchantInfo } from "../../core/merchant";
import { type FieldErrors } from "../../core/page";
import { isSignedIn } from "../../core/session";
import { ROUTES, buildUrl, callPhone, navigate, redirect, safeRoute, toast } from "../../core/ui";

/**
 * P11 登录/授权（需求 §5.1）。
 * 主入口：微信手机号授权登录（拟新增契约，服务端未提供时如实提示并展开备用入口）；
 * 备用：手机号 + 密码（现有契约）；短信验证码登录属 MP-02B，未提供时不显示假入口。
 * 协议默认不勾选，必须主动同意；返回目标只能是白名单页面且不带私有参数。
 */
interface LoginData {
  merchantName: string;
  merchantInitial: string;
  servicePhone: string;
  agreementName: string;
  agreementVersion: string;
  privacyName: string;
  privacyVersion: string;
  agreementsProvided: boolean;
  wechatAvailable: boolean;
  wechatNotice: string;
  showPassword: boolean;
  loginIdentifier: string;
  password: string;
  agreed: boolean;
  submitting: boolean;
  errors: FieldErrors;
  formError: string;
}

Page({
  data: {
    merchantName: "",
    merchantInitial: "·",
    servicePhone: "",
    agreementName: "用户服务协议",
    agreementVersion: "",
    privacyName: "隐私政策",
    privacyVersion: "",
    agreementsProvided: false,
    wechatAvailable: true,
    wechatNotice: "",
    showPassword: false,
    loginIdentifier: "",
    password: "",
    agreed: false,
    submitting: false,
    errors: {},
    formError: ""
  } as LoginData,

  redirectTo: ROUTES.home as string,
  loginCode: "" as string,

  onLoad(options: Record<string, string | undefined>) {
    this.redirectTo = safeRoute(options.redirect, ROUTES.home);
    if (isSignedIn()) {
      redirect(this.redirectTo);
      return;
    }
    const cached = cachedMerchant();
    if (cached) this.applyMerchant(cached);
    loadMerchant(false).then((info) => this.applyMerchant(info)).catch(() => undefined);
    this.prefetchLoginCode();
  },

  applyMerchant(info: MerchantInfo) {
    const agreements = info.agreements;
    this.setData({
      merchantName: info.name,
      merchantInitial: info.name.trim().charAt(0) || "·",
      servicePhone: info.servicePhone ?? "",
      agreementsProvided: Boolean(agreements),
      agreementName: agreements?.userAgreement.name ?? "用户服务协议",
      agreementVersion: agreements?.userAgreement.version ?? "",
      privacyName: agreements?.privacyPolicy.name ?? "隐私政策",
      privacyVersion: agreements?.privacyPolicy.version ?? "",
      wechatAvailable: info.loginMethods.includes("wechat_phone"),
      showPassword: !info.loginMethods.includes("wechat_phone") || this.data.showPassword,
      wechatNotice: info.loginMethods.includes("wechat_phone") ? "" : "商户尚未开通微信手机号一键登录，请使用手机号密码登录。"
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
    if (this.data.submitting) return;
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
    this.setData({ submitting: true, formError: "" });
    try {
      const loginCode = this.loginCode || (await this.freshLoginCode());
      this.loginCode = "";
      if (!loginCode) throw new Error("未能获取微信登录凭证，请重试");
      const session = await loginWithWechatPhone({ loginCode, phoneCode, consent, serviceCode: preferredServiceCode() });
      this.finish(session);
    } catch (error) {
      this.prefetchLoginCode();
      if (isApiError(error, "UNAVAILABLE")) {
        this.setData({ wechatAvailable: false, showPassword: true, wechatNotice: describeError(error).message });
      } else {
        this.setData({ formError: describeError(error).message });
      }
    } finally {
      this.setData({ submitting: false });
    }
  },

  onTogglePassword() {
    this.setData({ showPassword: !this.data.showPassword, formError: "" });
  },

  onIdentifierInput(event: WechatMiniprogram.Input) {
    this.setData({ loginIdentifier: String(event.detail.value ?? ""), "errors.loginIdentifier": "" });
  },

  onPasswordInput(event: WechatMiniprogram.Input) {
    this.setData({ password: String(event.detail.value ?? ""), "errors.password": "" });
  },

  async onPasswordLogin() {
    if (this.data.submitting) return;
    const errors: FieldErrors = {};
    const identifier = this.data.loginIdentifier.trim().replace(/[\s-]/g, "");
    if (!/^\+?[0-9]{6,20}$/.test(identifier)) errors.loginIdentifier = "请输入正确的手机号";
    if (!this.data.password) errors.password = "请输入密码";
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    if (!this.requireConsent()) return;
    this.setData({ submitting: true, formError: "" });
    try {
      const session = await this.passwordLogin(identifier);
      this.finish(session);
    } catch (error) {
      const presented = describeError(error);
      this.setData({ formError: presented.code === "UNAUTHENTICATED" ? "手机号或密码不正确" : presented.message });
    } finally {
      this.setData({ submitting: false });
    }
  },

  /** 带初始服务登录；该服务已不可用（403/404）时退回不指定服务再试一次，由服务端选默认服务。 */
  async passwordLogin(identifier: string) {
    const serviceCode = preferredServiceCode();
    try {
      return await loginWithPassword({ loginIdentifier: identifier, password: this.data.password, serviceCode });
    } catch (error) {
      if (serviceCode && (isApiError(error, "FORBIDDEN") || isApiError(error, "NOT_FOUND"))) {
        return loginWithPassword({ loginIdentifier: identifier, password: this.data.password });
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

  onBrowse() {
    redirect(ROUTES.home);
  }
});
