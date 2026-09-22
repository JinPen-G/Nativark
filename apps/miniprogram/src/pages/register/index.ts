import { themeBehavior } from "../../core/theme-behavior";
import { adoptSession, createRegistrationChallenge, loginWithPassword, registerPersonal, verifyRegistrationChallenge } from "../../api/auth";
import { describeError } from "../../core/errors";
import { newKey } from "../../core/keys";
import { cachedMerchant, loadMerchant, preferredServiceCode, type MerchantInfo } from "../../core/merchant";
import { type FieldErrors } from "../../core/page";
import { ROUTES, buildUrl, navigate, redirect, safeRoute, toast } from "../../core/ui";

/**
 * 注册（现有契约：验证码挑战 → 一次性证明 → 注册）。这是密码账号的兼容路径；
 * 微信手机号主路径就绪后，新用户不需要来这里设密码。
 * 验证码有效期、重发时点由服务端返回；开发环境的 developmentCode 只用于本机联调提示，不进日志。
 */
interface RegisterData {
  step: "form" | "code";
  merchantName: string;
  agreementName: string;
  privacyName: string;
  agreementVersion: string;
  privacyVersion: string;
  name: string;
  phone: string;
  email: string;
  password: string;
  code: string;
  agreed: boolean;
  submitting: boolean;
  errors: FieldErrors;
  formError: string;
  maskedDestination: string;
  retryAfter: number;
  developmentCode: string;
  deliveryMode: string;
}

Page({
  behaviors: [themeBehavior],
  data: {
    step: "form",
    merchantName: "",
    agreementName: "用户服务协议",
    privacyName: "隐私政策",
    agreementVersion: "",
    privacyVersion: "",
    name: "",
    phone: "",
    email: "",
    password: "",
    code: "",
    agreed: false,
    submitting: false,
    errors: {},
    formError: "",
    maskedDestination: "",
    retryAfter: 0,
    developmentCode: "",
    deliveryMode: ""
  } as RegisterData,

  redirectTo: ROUTES.home as string,
  challengeId: "" as string,
  challengeKey: "" as string,
  registrationKey: "" as string,
  countdown: undefined as number | undefined,

  onLoad(options: Record<string, string | undefined>) {
    this.redirectTo = safeRoute(options.redirect, ROUTES.home);
    const cached = cachedMerchant();
    if (cached) this.applyMerchant(cached);
    loadMerchant(false).then((info) => this.applyMerchant(info)).catch(() => undefined);
  },

  onUnload() {
    if (this.countdown) clearInterval(this.countdown);
  },

  applyMerchant(info: MerchantInfo) {
    this.setData({
      merchantName: info.name,
      agreementName: info.agreements?.userAgreement.name ?? "用户服务协议",
      privacyName: info.agreements?.privacyPolicy.name ?? "隐私政策",
      agreementVersion: info.agreements?.userAgreement.version ?? "",
      privacyVersion: info.agreements?.privacyPolicy.version ?? ""
    });
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field);
    this.setData({ [field]: String(event.detail.value ?? ""), [`errors.${field}`]: "", formError: "" });
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

  normalizedPhone(): string {
    return this.data.phone.trim().replace(/[\s-]/g, "");
  },

  validateForm(): boolean {
    const errors: FieldErrors = {};
    if (!this.data.name.trim()) errors.name = "请填写姓名";
    if (!/^\+?[0-9]{6,20}$/.test(this.normalizedPhone())) errors.phone = "请输入正确的手机号";
    if (this.data.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.data.email.trim())) errors.email = "邮箱格式不正确";
    if (this.data.password.length < 8 || this.data.password.length > 128) errors.password = "密码长度为 8-128 位";
    else if (!/[A-Za-z]/.test(this.data.password) || !/[0-9]/.test(this.data.password)) errors.password = "密码需同时包含字母和数字";
    if (!this.data.agreed) errors.agreed = `请先阅读并同意《${this.data.agreementName}》和《${this.data.privacyName}》`;
    this.setData({ errors, formError: errors.agreed ?? "" });
    return Object.keys(errors).length === 0;
  },

  startCountdown(seconds: number) {
    if (this.countdown) clearInterval(this.countdown);
    this.setData({ retryAfter: seconds });
    if (seconds <= 0) return;
    this.countdown = setInterval(() => {
      const next = this.data.retryAfter - 1;
      this.setData({ retryAfter: Math.max(0, next) });
      if (next <= 0 && this.countdown) clearInterval(this.countdown);
    }, 1000) as unknown as number;
  },

  async onSendCode() {
    if (this.data.submitting || this.data.retryAfter > 0) return;
    if (!this.validateForm()) return;
    this.setData({ submitting: true, formError: "" });
    try {
      // 同一手机号的重试复用同一个幂等键；换号码才换键。
      const fingerprint = `sms:${this.normalizedPhone()}`;
      if (!this.challengeKey.startsWith(`${fingerprint}|`)) this.challengeKey = `${fingerprint}|${newKey("challenge")}`;
      const challenge = await createRegistrationChallenge({ method: "sms", identifier: this.normalizedPhone(), idempotencyKey: this.challengeKey.split("|")[1], serviceCode: preferredServiceCode() });
      this.challengeId = challenge.challengeId;
      this.setData({ step: "code", maskedDestination: challenge.maskedDestination, developmentCode: challenge.developmentCode ?? "", deliveryMode: challenge.deliveryMode ?? "", code: "" });
      this.startCountdown(challenge.retryAfterSeconds ?? 60);
    } catch (error) {
      const presented = describeError(error);
      if (presented.code === "RATE_LIMITED") this.startCountdown((error as { retryAfterSeconds?: number }).retryAfterSeconds ?? 60);
      this.setData({ formError: presented.message });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onBackToForm() {
    this.setData({ step: "form", formError: "" });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    if (!/^\d{6}$/.test(this.data.code.trim())) {
      this.setData({ errors: { ...this.data.errors, code: "请输入 6 位验证码" } });
      return;
    }
    this.setData({ submitting: true, formError: "" });
    let registered: Awaited<ReturnType<typeof registerPersonal>> | undefined;
    try {
      const verified = await verifyRegistrationChallenge(this.challengeId, this.data.code.trim());
      if (!this.registrationKey) this.registrationKey = newKey("register");
      registered = await registerPersonal({
        name: this.data.name.trim(),
        phone: this.normalizedPhone(),
        email: this.data.email.trim() || undefined,
        password: this.data.password,
        verificationToken: verified.verificationToken,
        consent: {
          userAgreementVersion: this.data.agreementVersion || "unversioned",
          privacyPolicyVersion: this.data.privacyVersion || "unversioned",
          agreedAt: new Date().toISOString()
        },
        idempotencyKey: this.registrationKey,
        serviceCode: preferredServiceCode()
      });
    } catch (error) {
      const presented = describeError(error);
      if (presented.code === "BAD_REQUEST" || presented.code === "CONFLICT") {
        this.setData({ errors: { ...this.data.errors, code: presented.message }, formError: "" });
      } else {
        this.setData({ formError: presented.message });
      }
      this.setData({ submitting: false });
      return;
    }
    // 注册已在服务端完成：后续自动登录失败不能让用户重新提交注册（验证码已消费），改为引导去登录。
    try {
      const session = await loginWithPassword({ loginIdentifier: this.normalizedPhone(), password: this.data.password, serviceCode: preferredServiceCode() });
      adoptSession(session, preferredServiceCode(), "register");
      if (registered.membershipStatus === "pending_activation") {
        toast("注册成功，会员资料等待商户审核", { duration: 3000 });
        redirect(ROUTES.me);
      } else {
        toast("注册成功", { icon: "success" });
        redirect(this.redirectTo);
      }
    } catch {
      toast("注册已完成，请使用手机号和密码登录", { duration: 3000 });
      redirect(buildUrl(ROUTES.login, { redirect: this.redirectTo }));
    } finally {
      this.setData({ submitting: false });
    }
  },

  onLogin() {
    redirect(buildUrl(ROUTES.login, { redirect: this.redirectTo }));
  }
});
