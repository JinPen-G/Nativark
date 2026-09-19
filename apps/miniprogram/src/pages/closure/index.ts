import { closeAccount, closurePreview, closureChallenge, logout, verifyRegistrationChallenge } from "../../api/auth";
import { contractMissing } from "../../contracts/planned";
import { describeError } from "../../core/errors";
import { errorState, handleCommonViewAction, loadingState, readyState, type FieldErrors, type ViewState } from "../../core/page";
import { currentSession, isSignedIn } from "../../core/session";
import { ROUTES, buildUrl, callPhone, navigate, redirect, requireSignIn, toast } from "../../core/ui";
import { cachedMerchant } from "../../core/merchant";

/**
 * MP-02B 自助注销。注销前先取服务端可注销性预览（在途订单、押金、预授权、待退款等阻断项），
 * 客户显式确认系统无法自动核对的项，再用 account_closure 用途验证码证明本人，最后提交注销。
 * 有阻断项时不允许提交；批准注销不等于退款/释放完成，资金动作仍由商户按记录办理。
 * 页面不显示原始验证码，注销成功后清本机会话并回首页。
 */
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
  submitting: boolean;
  formError: string;
  errors: FieldErrors;
  servicePhone: string;
}

Page({
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
    submitting: false,
    formError: "",
    errors: {},
    servicePhone: ""
  } as ClosureData,

  challengeId: "" as string,
  countdown: undefined as number | undefined,

  onLoad() {
    this.setData({ phoneMasked: currentSession()?.customer.loginIdentifierMasked ?? "", servicePhone: cachedMerchant()?.servicePhone ?? "" });
    if (!requireSignIn(ROUTES.closure)) return;
    void this.loadPreview();
  },

  onUnload() {
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

  async onSendCode() {
    if (this.data.submitting || this.data.retryAfter > 0) return;
    if (!this.data.closable) {
      this.setData({ formError: "当前存在无法注销的事项，请先按提示处理或联系商户。" });
      return;
    }
    if (!this.data.acknowledgedAll) {
      this.setData({ formError: "请先逐项确认注销须知。" });
      return;
    }
    this.setData({ submitting: true, formError: "" });
    try {
      const challenge = await closureChallenge();
      this.challengeId = challenge.challengeId;
      this.setData({ step: "code", maskedDestination: challenge.maskedDestination, developmentCode: challenge.developmentCode ?? "", code: "" });
      this.startCountdown(challenge.retryAfterSeconds ?? 60);
    } catch (error) {
      const presented = describeError(error);
      if (presented.code === "RATE_LIMITED") this.startCountdown((error as { retryAfterSeconds?: number }).retryAfterSeconds ?? 60);
      this.setData({ formError: presented.message });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onBackToPreview() {
    if (this.data.submitting) return;
    this.setData({ step: "preview", formError: "", code: "" });
  },

  async onSubmit() {
    if (this.data.submitting) return;
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
        // 期间新增了在途事项：回到预览重新核对。
        this.setData({ formError: `${presented.message} 请返回重新核对可注销状态。`, step: "preview" });
        void this.loadPreview();
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
