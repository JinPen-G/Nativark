import { themeBehavior } from "../../core/theme-behavior";
import { closeAccount, closurePreview, closureChallenge, logout, verifyRegistrationChallenge } from "../../api/auth";
import { contractMissing } from "../../contracts/planned";
import { describeError } from "../../core/errors";
import { errorState, handleCommonViewAction, loadingState, readyState, type FieldErrors, type ViewState } from "../../core/page";
import { currentSession, isSignedIn, principalVersion } from "../../core/session";
import { ROUTES, buildUrl, callPhone, confirmDialog, navigate, redirect, requireSignIn, toast } from "../../core/ui";
import { cachedMerchant } from "../../core/merchant";
import { newKey } from "../../core/keys";
import { STORAGE_KEYS, writeRequiredStorage } from "../../core/storage";
import { clockCalibrated, serverNow } from "../../core/clock";

/**
 * MP-02B 自助注销。注销前先取服务端可注销性预览（在途订单、押金、预授权、待退款等阻断项），
 * 客户显式确认系统无法自动核对的项，再用 account_closure 用途验证码证明本人，最后提交注销。
 * 有阻断项时不允许提交；批准注销不等于退款/释放完成，资金动作仍由商户按记录办理。
 * 页面不显示原始验证码，注销成功后清本机会话并回首页。
 * 发起前保留本人请求键，重启/丢应答只回读；重新获取须独立确认，不按冷却或过期自动换键。
 */
interface ClosureChallengeReference {
  tenantCode: string;
  customerId: string;
  idempotencyKey: string;
  createdAt: number;
  challengeId?: string;
  expiresAt?: string;
}

interface ClosureData {
  view: ViewState;
  step: "preview" | "code";
  available: boolean;
  closable: boolean;
  blockers: Array<{ code: string; message: string; count?: number }>;
  manualConfirmations: Array<{ code: string; message: string }>;
  acknowledgedAll: boolean;
  phoneMasked: string;
  phone: string;
  code: string;
  reason: string;
  maskedDestination: string;
  retryAfter: number;
  developmentCode: string;
  deliveryPending: boolean;
  hasChallengeRequest: boolean;
  submitting: boolean;
  formError: string;
  errors: FieldErrors;
  servicePhone: string;
}

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    step: "preview",
    available: true,
    closable: false,
    blockers: [],
    manualConfirmations: [],
    acknowledgedAll: false,
    phoneMasked: "",
    phone: "",
    code: "",
    reason: "",
    maskedDestination: "",
    retryAfter: 0,
    developmentCode: "",
    deliveryPending: false,
    hasChallengeRequest: false,
    submitting: false,
    formError: "",
    errors: {},
    servicePhone: ""
  } as ClosureData,

  challengeId: "" as string,
  challengeExpiresAt: "" as string,
  unloaded: false,
  countdown: undefined as number | undefined,

  onLoad() {
    this.unloaded = false;
    this.setData({ phoneMasked: currentSession()?.customer.loginIdentifierMasked ?? "", servicePhone: cachedMerchant()?.servicePhone ?? "" });
    if (!requireSignIn(ROUTES.closure)) return;
    try {
      this.setData({ hasChallengeRequest: Boolean(this.readClosureRequest()) });
    } catch (error) {
      this.setData({ formError: describeError(error).message });
    }
    void this.loadPreview();
  },

  onUnload() {
    this.unloaded = true;
    if (this.countdown) clearInterval(this.countdown);
  },

  async loadPreview() {
    if (!isSignedIn()) return;
    this.setData({ view: loadingState() });
    try {
      const preview = await closurePreview();
      const manual = preview.manualConfirmations ?? [];
      this.setData({
        view: readyState(),
        available: true,
        closable: preview.closable,
        blockers: preview.blockers ?? [],
        manualConfirmations: manual,
        acknowledgedAll: manual.length === 0
      });
    } catch (error) {
      if (contractMissing(error)) {
        this.setData({ view: readyState(), available: false, closable: false });
        return;
      }
      this.setData({ view: errorState(error) });
    }
  },

  onToggleConfirm(event: WechatMiniprogram.CheckboxGroupChange) {
    const checked = (event.detail.value as string[]).length;
    this.setData({ acknowledgedAll: checked >= this.data.manualConfirmations.length, formError: "" });
  },

  onReasonInput(event: WechatMiniprogram.Input) {
    this.setData({ reason: String(event.detail.value ?? "").slice(0, 200) });
  },

  onPhoneInput(event: WechatMiniprogram.Input) {
    this.setData({ phone: String(event.detail.value ?? ""), "errors.phone": "", formError: "" });
  },

  onCodeInput(event: WechatMiniprogram.Input) {
    this.setData({ code: String(event.detail.value ?? ""), "errors.code": "" });
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

  readClosureRequest(): ClosureChallengeReference | undefined {
    const session = currentSession();
    if (!session) throw new Error("请先登录客户端账号");
    // 恢复读取失败必须保留原意图，不能将存储错误当作第一次发送。
    const stored = wx.getStorageSync(STORAGE_KEYS.closureChallenge) as ClosureChallengeReference | "" | null | undefined;
    if (stored === "" || stored === null || stored === undefined) return undefined;
    if (typeof stored !== "object" || typeof stored.tenantCode !== "string" || !stored.tenantCode || typeof stored.customerId !== "string" || !stored.customerId
      || typeof stored.idempotencyKey !== "string" || !stored.idempotencyKey.trim() || stored.idempotencyKey.length > 191
      || !Number.isFinite(stored.createdAt)) throw new Error("原验证码请求无法读取，请联系商户核对");
    return stored.tenantCode === session.tenantCode && stored.customerId === session.customer.customerId ? stored : undefined;
  },

  async onSendCode() {
    if (this.data.retryAfter > 0) return;
    await this.requestClosureCode("start");
  },

  async onRecoverCode() {
    await this.requestClosureCode("recover");
  },

  async onResendCode() {
    if (this.data.submitting || this.data.retryAfter > 0) return;
    const version = principalVersion();
    this.setData({ submitting: true });
    let confirmed = false;
    try {
      confirmed = await confirmDialog({ title: "重新获取验证码", content: "之前的验证码可能已经发送。继续会申请一条新的验证码，是否继续？", confirmText: "重新获取" });
    } finally {
      if (!this.unloaded && principalVersion() === version) this.setData({ submitting: false });
    }
    if (!confirmed || this.unloaded || principalVersion() !== version) return;
    await this.requestClosureCode("new");
  },

  async requestClosureCode(mode: "start" | "recover" | "new") {
    if (this.data.submitting) return;
    if (!this.data.closable) {
      this.setData({ formError: "当前存在无法注销的事项，请先按提示处理或联系商户。" });
      return;
    }
    if (!this.data.acknowledgedAll) {
      this.setData({ formError: "请先逐项确认注销须知。" });
      return;
    }
    const version = principalVersion();
    this.setData({ submitting: true, formError: "" });
    try {
      const session = currentSession();
      if (!session) throw new Error("请先登录客户端账号");
      let reference = mode === "new" ? undefined : this.readClosureRequest();
      const recoverOnly = reference !== undefined;
      if (mode === "recover" && !reference) throw new Error("没有原验证码请求，请先获取验证码");
      if (!reference) {
        reference = { tenantCode: session.tenantCode, customerId: session.customer.customerId, idempotencyKey: newKey("closure"), createdAt: Date.now() };
        writeRequiredStorage(STORAGE_KEYS.closureChallenge, reference);
        this.challengeId = "";
        this.challengeExpiresAt = "";
        this.setData({ code: "", developmentCode: "", deliveryPending: true });
      }
      this.setData({ hasChallengeRequest: true });
      const challenge = await closureChallenge({ idempotencyKey: reference.idempotencyKey, recoverOnly });
      if (this.unloaded || principalVersion() !== version) return;
      if (challenge.purpose !== undefined && challenge.purpose !== "account_closure") {
        this.startCountdown(challenge.retryAfterSeconds ?? 60);
        throw new Error("请等待当前验证码冷却后，明确重新获取注销验证码");
      }
      writeRequiredStorage(STORAGE_KEYS.closureChallenge, { ...reference, challengeId: challenge.challengeId, expiresAt: challenge.expiresAt });
      const sameChallenge = this.challengeId === challenge.challengeId;
      this.challengeId = challenge.challengeId;
      this.challengeExpiresAt = challenge.expiresAt;
      if (challenge.status !== "pending_verification" || !Number.isFinite(Date.parse(challenge.expiresAt))
        || clockCalibrated() && Date.parse(challenge.expiresAt) <= serverNow()) {
        this.startCountdown(0);
        throw new Error("原验证码已失效，请明确重新获取验证码");
      }
      this.setData({ step: "code", maskedDestination: challenge.maskedDestination, developmentCode: challenge.developmentCode ?? "", deliveryPending: challenge.deliveryMode === "provider_pending", code: sameChallenge ? this.data.code : "" });
      this.startCountdown(challenge.retryAfterSeconds ?? 60);
    } catch (error) {
      if (this.unloaded || principalVersion() !== version) return;
      const presented = describeError(error);
      if (presented.code === "RATE_LIMITED") this.startCountdown((error as { retryAfterSeconds?: number }).retryAfterSeconds ?? 60);
      this.setData({ formError: presented.message });
    } finally {
      if (!this.unloaded && principalVersion() === version) this.setData({ submitting: false });
    }
  },

  onBackToPreview() {
    if (this.data.submitting) return;
    this.setData({ step: "preview", formError: "", code: "" });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    if (!this.challengeId || !Number.isFinite(Date.parse(this.challengeExpiresAt))
      || clockCalibrated() && Date.parse(this.challengeExpiresAt) <= serverNow()) {
      this.setData({ formError: "验证码已失效，请明确重新获取验证码" });
      return;
    }
    const errors: FieldErrors = {};
    const phone = this.data.phone.trim().replace(/[\s-]/g, "");
    if (!/^\+?[0-9]{6,20}$/.test(phone)) errors.phone = "请输入本账号的手机号以再次确认本人";
    if (!/^\d{6}$/.test(this.data.code.trim())) errors.code = "请输入 6 位验证码";
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    this.setData({ submitting: true, formError: "" });
    try {
      const verified = await verifyRegistrationChallenge(this.challengeId, this.data.code.trim());
      await closeAccount({ loginIdentifier: phone, verificationToken: verified.verificationToken, acknowledgedManualChecks: true, reason: this.data.reason.trim() || undefined });
    } catch (error) {
      const presented = describeError(error);
      if (presented.code === "BAD_REQUEST" || presented.code === "UNAUTHENTICATED") {
        this.setData({ errors: { ...this.data.errors, code: presented.message } });
      } else if (presented.code === "CONFLICT") {
        // 409 可能是手机号不一致（证明未消耗，可改后再提交）、证明过期/已用，或期间新增了在途事项；
        // 留在验证码步骤如实显示原因，同时后台重读可注销性，不把用户踢回预览。
        const phoneMismatch = presented.message.includes("手机号");
        this.setData(phoneMismatch ? { errors: { ...this.data.errors, phone: presented.message } } : { formError: `${presented.message} 如有新的在途事项请返回重新核对。` });
        void this.loadPreview();
      } else if (presented.code === "AUTH_EXPIRED") {
        // 提交那一刻登录状态刚刷新：证明仍有效，再点一次即可，不是登录失效。
        this.setData({ formError: "登录状态已刷新，请再次点击“确认注销”。" });
      } else {
        this.setData({ formError: presented.message });
      }
      this.setData({ submitting: false });
      return;
    }
    // 注销已在服务端完成：清本机会话，回首页。
    await logout();
    this.setData({ submitting: false });
    toast("账号已注销", { icon: "success", duration: 3000 });
    redirect(ROUTES.home);
  },

  onContact() {
    callPhone(this.data.servicePhone);
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.closure, servicePhone: this.data.servicePhone })) return;
    void this.loadPreview();
  },

  onOpenOrders() {
    navigate(buildUrl(ROUTES.orders));
  }
});
