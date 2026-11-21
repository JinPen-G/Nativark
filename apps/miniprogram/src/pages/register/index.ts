import { themeBehavior } from "../../core/theme-behavior";
import { adoptSession, createRegistrationChallenge, loginWithPassword, registerPersonal, verifyRegistrationChallenge } from "../../api/auth";
import { describeError } from "../../core/errors";
import { newKey } from "../../core/keys";
import { PUBLIC_CONFIG } from "../../config/public";
import { STORAGE_KEYS, writeRequiredStorage } from "../../core/storage";
import { serverNow } from "../../core/clock";
import { cachedMerchant, loadMerchant, preferredServiceCode, type MerchantInfo } from "../../core/merchant";
import { type FieldErrors } from "../../core/page";
import { ROUTES, buildUrl, confirmDialog, navigate, redirect, safeRoute, toast } from "../../core/ui";

/**
 * 注册（现有契约：验证码挑战 → 一次性证明 → 注册）。这是密码账号的兼容路径；
 * 微信手机号主路径就绪后，新用户不需要来这里设密码。
 * 先保存原请求引用，丢应答或重启沿原键恢复，重新获取须用户明确选择。
 * 验证后的证明与完整注册输入只保留在当前页面；注册失应答重试原提交，不再次验证验证码。
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
  challengeExpiresAt: "" as string,
  challengeScope: "" as string,
  sending: false,
  challengeGeneration: 0,
  unloaded: false,
  registrationKey: "" as string,
  registrationRequest: undefined as { scope: string; generation: number; input: Parameters<typeof registerPersonal>[0] } | undefined,
  registering: false,
  countdown: undefined as number | undefined,

  onLoad(options: Record<string, string | undefined>) {
    this.unloaded = false;
    this.redirectTo = safeRoute(options.redirect, ROUTES.home);
    const cached = cachedMerchant();
    if (cached) this.applyMerchant(cached);
    loadMerchant(false).then((info) => this.applyMerchant(info)).catch(() => undefined);
  },

  onUnload() {
    this.unloaded = true;
    this.challengeGeneration++;
    this.registrationRequest = undefined;
    this.registrationKey = "";
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
    if (field === "phone") {
      this.challengeGeneration++;
      this.challengeId = "";
      this.challengeExpiresAt = "";
      this.registrationRequest = undefined;
      this.registrationKey = "";
      this.startCountdown(0);
      this.setData({ code: "", developmentCode: "", deliveryMode: "", step: "form" });
    }
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

  challengeStorageKey(): string {
    return `${STORAGE_KEYS.actionKeys}:registration-challenge:${JSON.stringify([PUBLIC_CONFIG.tenantCode, preferredServiceCode(), this.normalizedPhone()])}`;
  },

  async onSendCode() {
    if (this.sending || this.data.submitting || this.data.retryAfter > 0) return;
    if (!this.validateForm()) return;
    this.sending = true;
    this.setData({ submitting: true, formError: "" });
    const scope = this.challengeStorageKey();
    const identifier = this.normalizedPhone();
    const serviceCode = preferredServiceCode();
    const generation = this.challengeGeneration;
    const current = () => !this.unloaded && this.challengeGeneration === generation && this.challengeStorageKey() === scope;
    try {
      // 原引用不按冷却或有效期清除，存储异常也不能当作第一次发送。
      const stored = wx.getStorageSync(scope) as unknown;
      if (stored !== "" && stored !== null && stored !== undefined &&
        (typeof stored !== "string" || !stored.trim() || stored.length > 191)) {
        throw new Error("原验证码请求无法读取，请联系商户核对");
      }
      let key = typeof stored === "string" && stored ? stored : undefined;
      if (key) {
        const confirmed = await confirmDialog({ title: "重新获取验证码", content: "原验证码可能已经发送。重新获取会申请一条新的验证码，也可以核对原请求。", confirmText: "重新获取", cancelText: "核对原请求" });
        if (!current()) return;
        if (confirmed) key = undefined;
      }
      if (!key) {
        key = newKey("challenge");
        writeRequiredStorage(scope, key);
        this.challengeId = "";
        this.challengeExpiresAt = "";
        this.registrationRequest = undefined;
        this.registrationKey = "";
        this.setData({ code: "", developmentCode: "", deliveryMode: "" });
      }
      const challenge = await createRegistrationChallenge({ method: "sms", identifier, idempotencyKey: key, serviceCode });
      if (!current()) return;
      const expiry = Date.parse(challenge.expiresAt);
      const pending = challenge.deliveryMode === "provider_pending";
      if (typeof challenge.challengeId !== "string" || !challenge.challengeId || challenge.status !== "pending_verification" || !Number.isFinite(expiry) || expiry <= serverNow() || pending ||
        !["provider", "development"].includes(challenge.deliveryMode ?? "")) {
        this.challengeId = "";
        this.challengeExpiresAt = "";
        this.setData({ step: "form", deliveryMode: "", developmentCode: "", formError: pending
          ? "原短信投递结果待核对。再次获取可核对原请求，或明确选择重新获取。"
          : "原验证码已失效或无法验证，请明确选择重新获取。" });
        this.startCountdown(challenge.retryAfterSeconds ?? 0);
        return;
      }
      this.challengeId = challenge.challengeId;
      this.challengeExpiresAt = challenge.expiresAt;
      this.challengeScope = scope;
      this.setData({ step: "code", maskedDestination: challenge.maskedDestination,
        developmentCode: challenge.developmentCode ?? this.data.developmentCode,
        deliveryMode: challenge.deliveryMode ?? "" });
      this.startCountdown(challenge.retryAfterSeconds ?? 0);
    } catch (error) {
      if (!current()) return;
      const presented = describeError(error);
      if (presented.code === "CONFLICT") {
        this.challengeId = "";
        this.challengeExpiresAt = "";
        this.setData({ step: "form", developmentCode: "" });
      }
      if (presented.code === "RATE_LIMITED") this.startCountdown((error as { retryAfterSeconds?: number }).retryAfterSeconds ?? 60);
      this.setData({ formError: presented.message });
    } finally {
      this.sending = false;
      if (!this.unloaded) this.setData({ submitting: false });
    }
  },

  onBackToForm() {
    this.setData({ step: "form", formError: "" });
  },

  async onSubmit() {
    if (this.registering || this.data.submitting) return;
    const generation = this.challengeGeneration;
    const scope = this.challengeStorageKey();
    const current = () => !this.unloaded && this.challengeGeneration === generation && this.challengeStorageKey() === scope;
    let original = this.registrationRequest;
    if (original?.scope !== scope || original.generation !== generation) {
      original = undefined;
      this.registrationRequest = undefined;
      this.registrationKey = "";
    }
    if (!original && (!this.challengeId || this.challengeScope !== scope ||
      !Number.isFinite(Date.parse(this.challengeExpiresAt)) || Date.parse(this.challengeExpiresAt) <= serverNow())) {
      this.setData({ step: "form", formError: "原验证码已失效，请明确选择重新获取。" });
      return;
    }
    if (!original && !/^\d{6}$/.test(this.data.code.trim())) {
      this.setData({ errors: { ...this.data.errors, code: "请输入 6 位验证码" } });
      return;
    }
    this.registering = true;
    this.setData({ submitting: true, formError: "" });
    try {
      let registered: Awaited<ReturnType<typeof registerPersonal>>;
      try {
        if (!original) {
          // 在验证等待前固定用户输入；证明取得后先保留原提交，再派发注册。
          const input = {
            name: this.data.name.trim(),
            phone: this.normalizedPhone(),
            email: this.data.email.trim() || undefined,
            password: this.data.password,
            consent: {
              userAgreementVersion: this.data.agreementVersion || "unversioned",
              privacyPolicyVersion: this.data.privacyVersion || "unversioned",
              agreedAt: new Date().toISOString()
            },
            serviceCode: preferredServiceCode()
          };
          const verified = await verifyRegistrationChallenge(this.challengeId, this.data.code.trim());
          if (!current()) return;
          this.registrationKey ||= newKey("register");
          original = { scope, generation, input: { ...input, verificationToken: verified.verificationToken, idempotencyKey: this.registrationKey } };
          this.registrationRequest = original;
        }
        registered = await registerPersonal(original.input);
        if (!current()) return;
      } catch (error) {
        if (!current()) return;
        const presented = describeError(error);
        if (!original && (presented.code === "BAD_REQUEST" || presented.code === "CONFLICT")) {
          this.setData({ errors: { ...this.data.errors, code: presented.message }, formError: "" });
        } else {
          this.setData({ formError: presented.message });
        }
        return;
      }

      // 注册已完成后只沿原输入自动登录，失败引导登录，不重新验证或另建注册。
      try {
        const session = await loginWithPassword({ loginIdentifier: original.input.phone, password: original.input.password, serviceCode: original.input.serviceCode });
        if (!current()) return;
        adoptSession(session, original.input.serviceCode ?? preferredServiceCode(), "register");
        if (registered.membershipStatus === "pending_activation") {
          toast("注册成功，会员资料等待商户审核", { duration: 3000 });
          redirect(ROUTES.me);
        } else {
          toast("注册成功", { icon: "success" });
          redirect(this.redirectTo);
        }
      } catch {
        if (!current()) return;
        toast("注册已完成，请使用手机号和密码登录", { duration: 3000 });
        redirect(buildUrl(ROUTES.login, { redirect: this.redirectTo }));
      }
    } finally {
      this.registering = false;
      if (!this.unloaded) this.setData({ submitting: false });
    }
  },

  onLogin() {
    redirect(buildUrl(ROUTES.login, { redirect: this.redirectTo }));
  }
});
