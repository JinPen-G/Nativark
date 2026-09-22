import type { ClientOrderView, ClientPaymentIntentResponse, RentalFundingBalance } from "@rental-os/shared";
import { fetchFunding, fetchOrder } from "../../api/orders";
import { closePaymentIntent, fetchPaymentCapabilities } from "../../api/payments";
import { formatRemaining, remainingMs } from "../../core/clock";
import { describeError } from "../../core/errors";
import { isApiError } from "../../core/http";
import { paymentMethodLabel } from "../../core/labels";
import { cachedMerchant } from "../../core/merchant";
import { formatMoney } from "../../core/money";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { forgetIntent, jsapiEnabled, launchPayment, obtainIntent, offlineMethods, rememberedIntent, rentalDue, verifyPayment, verifyWithRetries } from "../../core/payment";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, callPhone, confirmDialog, navigate, redirect, requireSignIn } from "../../core/ui";
import { bindWechatIdentity, isWechatIdentityRequired } from "../../core/wechat";

/**
 * P06 收银台与付款结果（需求 §8.2）。
 * - 待付金额 = 未付余额 + 待生效续租补款，与服务端支付单口径一致；不由页面提交金额。
 * - 微信支付只用服务端返回的 JSAPI 参数；成功回调后必须核对支付单与资金事件。
 * - 用户取消不取消订单；结果未知时有限重试后交给“稍后查看/联系商户”。
 * - 无线上路径时展示线下付款说明；服务端明确“小程序支付未开通”时不再显示支付按钮。
 */
type Phase = "idle" | "creating" | "paying" | "verifying" | "confirmed" | "unknown" | "failed" | "offline" | "unavailable" | "capabilities-unknown";

interface PayData {
  view: ViewState;
  order?: ClientOrderView;
  funding?: RentalFundingBalance;
  currency: string;
  dueAmount: number;
  dueText: string;
  collected: number;
  depositRequired: number;
  depositCollected: number;
  preAuthRequired: number;
  purpose: string;
  phase: Phase;
  phaseText: string;
  jsapi: boolean;
  offline: string[];
  offlineText: string;
  intent?: ClientPaymentIntentResponse;
  intentExpiresText: string;
  servicePhone: string;
  attempts: number;
  fromCheckout: boolean;
  error: string;
}

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    currency: "",
    dueAmount: 0,
    dueText: "",
    collected: 0,
    depositRequired: 0,
    depositCollected: 0,
    preAuthRequired: 0,
    purpose: "租赁款",
    phase: "idle",
    phaseText: "",
    jsapi: false,
    offline: [],
    offlineText: "",
    intentExpiresText: "",
    servicePhone: "",
    attempts: 0,
    fromCheckout: false,
    error: "",
  } as PayData,

  orderId: "" as string,
  ticker: undefined as number | undefined,
  busy: false,

  onLoad(options: Record<string, string | undefined>) {
    this.orderId = options.id ?? "";
    this.setData({ fromCheckout: options.from === "checkout", servicePhone: cachedMerchant()?.servicePhone ?? "" });
    if (!requireSignIn(buildUrl(ROUTES.pay, { id: this.orderId }))) return;
  },

  onShow() {
    void this.load();
    this.ticker = setInterval(() => this.tick(), 1000) as unknown as number;
  },

  onHide() {
    if (this.ticker) clearInterval(this.ticker);
  },

  onUnload() {
    if (this.ticker) clearInterval(this.ticker);
  },

  tick() {
    const intent = this.data.intent;
    if (!intent || intent.status !== "pending") return;
    const remaining = remainingMs(intent.expiresAt);
    this.setData({ intentExpiresText: remaining !== undefined && remaining <= 0 ? "本次支付单已过期，请重新发起" : `支付单有效期剩余 ${formatRemaining(remaining)}` });
  },

  applyFunding(funding: RentalFundingBalance, currency: string) {
    const due = rentalDue(funding);
    this.setData({
      funding,
      dueAmount: due,
      dueText: formatMoney(due, currency || undefined),
      collected: funding.rental.collected,
      depositRequired: funding.deposit.requiredAmount,
      depositCollected: funding.deposit.collected,
      preAuthRequired: funding.preauthorization.requiredAmount,
      purpose: funding.rental.pendingExtensionAmount > 0 ? "续租补款" : funding.rental.collected > 0 ? "补款" : "租赁款"
    });
    return due;
  },

  async load() {
    if (!this.orderId) {
      this.setData({ view: blockedState("缺少订单", "", "回订单列表", "none") });
      return;
    }
    try {
      const [order, funding, capabilities] = await Promise.all([
        fetchOrder(this.orderId),
        fetchFunding(this.orderId),
        fetchPaymentCapabilities().then((value) => ({ value }), (error: unknown) => ({ error }))
      ]);
      const currency = order.currency ?? "";
      this.setData({ order, currency, view: readyState() });
      const due = this.applyFunding(funding, currency);
      if ("error" in capabilities) {
        this.setData({ jsapi: false, offline: [], offlineText: "", phase: due > 0 ? "capabilities-unknown" : "confirmed", phaseText: due > 0 ? "付款方式暂时无法核实，请稍后重试" : "该订单当前没有待付款项" });
        return;
      }
      const offline = offlineMethods(capabilities.value).map(paymentMethodLabel);
      this.setData({ jsapi: jsapiEnabled(capabilities.value), offline, offlineText: offline.join("、") });
      if (due <= 0) {
        this.setData({ phase: "confirmed", phaseText: "该订单当前没有待付款项" });
        return;
      }
      // 上次离开时可能已经付了款但没核对：先核对再决定显示。
      const remembered = rememberedIntent(this.orderId);
      if (remembered && this.data.phase === "idle") {
        this.setData({ phase: "verifying", phaseText: "正在核对上次的付款结果…" });
        const result = await verifyPayment(this.orderId, remembered);
        if (result.confirmed) {
          forgetIntent(this.orderId);
          this.setData({ phase: "confirmed", phaseText: "付款已到账" });
          await this.refreshFunding();
          return;
        }
        this.setData({ phase: "idle", phaseText: "", intent: result.intent });
      }
      if (!this.data.jsapi) this.setData({ phase: offline.length ? "offline" : "unavailable", phaseText: offline.length ? "" : "商户尚未开通可用的付款方式，请联系商户" });
    } catch (error) {
      if (isApiError(error, "STALE_CONTEXT")) return;
      this.setData({ view: errorState(error) });
    }
  },

  async refreshFunding() {
    try {
      const funding = await fetchFunding(this.orderId);
      this.applyFunding(funding, this.data.currency);
    } catch {
      // 保留已加载数据。
    }
  },

  async onPay() {
    if (this.busy || !this.data.jsapi) return;
    this.busy = true;
    this.setData({ phase: "creating", phaseText: "正在创建支付单…", error: "" });
    let intent: ClientPaymentIntentResponse;
    try {
      intent = await obtainIntent(this.orderId);
    } catch (error) {
      this.busy = false;
      if (isWechatIdentityRequired(error)) {
        // 缺可信微信身份：引导先绑定（也可提前在“我的”里绑定），绑定成功后重新发起付款。
        const ok = await confirmDialog({ title: "绑定微信支付", content: "小程序内微信支付需要先绑定你的微信身份。绑定后即可继续付款。", confirmText: "绑定并继续" });
        if (!ok) {
          this.setData({ phase: "idle", phaseText: "", error: "未绑定微信，暂不能在小程序内微信支付；可改用线下付款或联系商户。" });
          return;
        }
        try {
          await bindWechatIdentity();
        } catch (bindError) {
          this.setData({ phase: "idle", phaseText: "", error: describeError(bindError).message });
          return;
        }
        void this.onPay();
        return;
      }
      if (isApiError(error, "UNAVAILABLE")) {
        // 服务端明确：小程序内微信支付尚未开通。不再显示支付按钮，改为线下/联系商户出口。
        this.setData({ jsapi: false, phase: this.data.offline.length ? "offline" : "unavailable", phaseText: this.data.offline.length ? "" : describeError(error).message, error: this.data.offline.length ? describeError(error).message : "" });
        return;
      }
      this.setData({ phase: "idle", phaseText: "", error: describeError(error).message });
      return;
    }
    if (intent.status === "paid") {
      this.busy = false;
      this.setData({ intent, phase: "verifying", phaseText: "支付单显示已付款，正在核对到账…" });
      await this.verify(intent.intentId, false);
      return;
    }
    if (!intent.jsapi) {
      this.busy = false;
      this.setData({ intent, phase: "idle", phaseText: "", error: "商户支付配置未返回小程序支付参数，暂不能在小程序内付款；可关闭该支付单后联系商户" });
      return;
    }
    this.setData({ intent, phase: "paying", phaseText: "请在微信收银台完成付款" });
    this.tick();
    const outcome = await launchPayment(intent);
    if (outcome === "cancelled") {
      this.busy = false;
      this.setData({ phase: "idle", phaseText: "", error: "你取消了付款。订单仍然保留，可在有效期内继续付款。" });
      return;
    }
    this.setData({ phase: "verifying", phaseText: outcome === "failed" ? "付款未完成，正在核对结果…" : "付款已提交，正在核对到账…" });
    await this.verify(intent.intentId, true);
  },

  async verify(intentId: string, withRetries: boolean) {
    const result = withRetries
      ? await verifyWithRetries(this.orderId, intentId, (attempt) => this.setData({ attempts: attempt, phaseText: `正在核对到账（第 ${attempt} 次）…` }))
      : await verifyPayment(this.orderId, intentId);
    this.busy = false;
    if (result.confirmed) {
      forgetIntent(this.orderId);
      this.setData({ phase: "confirmed", phaseText: "付款已到账", intent: result.intent });
      await this.refreshFunding();
      return;
    }
    if (result.status === "failed" || result.status === "funding_failed") {
      this.setData({ phase: "failed", phaseText: "付款失败，未扣款；可重新发起付款", intent: result.intent });
      forgetIntent(this.orderId);
      return;
    }
    if (result.status === "closed") {
      this.setData({ phase: "idle", phaseText: "", intent: undefined, error: "上一笔支付单已关闭，可重新发起付款" });
      forgetIntent(this.orderId);
      return;
    }
    if (result.status === "paid") {
      this.setData({ phase: "unknown", phaseText: "支付单已付款，但资金入账尚未确认；请稍后刷新，不要重复付款", intent: result.intent });
      return;
    }
    this.setData({ phase: "unknown", phaseText: "付款结果待核对：请稍后点击“刷新结果”，或联系商户；请勿重复付款", intent: result.intent });
  },

  /** 结果未知、收银台无回调或付款方式未核实时的手动刷新入口。 */
  async onRefresh() {
    if (this.data.phase === "capabilities-unknown") {
      this.busy = false;
      await this.load();
      return;
    }
    // 收银台没有回调（极少见）时页面停在 paying：允许用户手动触发核对，而不是被 busy 卡死。
    if (this.busy && this.data.phase !== "paying") return;
    const intentId = this.data.intent?.intentId ?? rememberedIntent(this.orderId);
    if (!intentId) {
      this.busy = false;
      await this.load();
      return;
    }
    this.busy = true;
    this.setData({ phase: "verifying", phaseText: "正在核对到账…" });
    await this.verify(intentId, false);
  },

  async onCloseIntent() {
    const intent = this.data.intent;
    if (!intent || this.busy || intent.status !== "pending") return;
    try {
      await closePaymentIntent(this.orderId, intent.intentId);
      forgetIntent(this.orderId);
      this.setData({ intent: undefined, phase: "idle", phaseText: "", error: "" });
    } catch (error) {
      this.setData({ error: describeError(error).message });
    }
  },

  onOrder() {
    redirect(buildUrl(ROUTES.order, { id: this.orderId }));
  },

  onOrders() {
    navigate(ROUTES.orders);
  },

  onContact() {
    callPhone(this.data.servicePhone);
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.pay, { id: this.orderId }), servicePhone: this.data.servicePhone })) return;
    if (this.data.view.actionText === "回订单列表") navigate(ROUTES.orders);
    else void this.load();
  }
});
