import type { ClientFulfillmentView, ClientOrderView, RentalFundingBalance, RentalOrderExtension } from "@rental-os/shared";
import { cancelOrder, fetchFulfillment, fetchFunding, fetchOrder, listExtensions, previewCancellation } from "../../api/orders";
import { serverNow } from "../../core/clock";
import { describeError } from "../../core/errors";
import { ensureServiceForOrder } from "../../core/flow";
import { isApiError } from "../../core/http";
import { actionKey, pendingActionKey, releaseActionKey } from "../../core/keys";
import { chargeLabel, extensionLabel, fulfillmentLabel } from "../../core/labels";
import { cachedMerchant } from "../../core/merchant";
import { formatMoney } from "../../core/money";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { presentOrder, type OrderPresentation } from "../../core/status";
import { currentServiceCode, isSignedIn } from "../../core/session";
import { formatBusinessDateTime, zoneLabel } from "../../core/time";
import { ROUTES, buildUrl, callPhone, navigate, requireSignIn, toast } from "../../core/ui";
import { zoneOf, ensureCurrentZone } from "../../core/zones";

/**
 * P08 订单详情 + P09 取消面板 + 取还指引（需求 §9.3、§10.1、§10.3）。
 * 页面由订单、资金、履约、续租四类事实组合出主/副状态与允许的入口；
 * 取消必须先取服务端预览，确认时带持久化幂等键；取消成功不等于退款成功。
 */
interface OrderData {
  view: ViewState;
  order?: ClientOrderView;
  funding?: RentalFundingBalance;
  fulfillment?: ClientFulfillmentView;
  extensions: Array<{ id: string; label: string; period: string; amount: number; status: string; tone: string }>;
  presentation?: OrderPresentation;
  currency: string;
  timeZone: string;
  zoneNote: string;
  startText: string;
  endText: string;
  effectiveEndText: string;
  extended: boolean;
  fulfillmentMode: string;
  lines: Array<{ key: string; name: string; option: string; quantity: number; amount: number; allocation: string }>;
  charges: Array<{ key: string; label: string; amount: number }>;
  balance: number;
  balanceText: string;
  refundText: string;
  depositText: string;
  preAuthText: string;
  overdue: boolean;
  showCancel: boolean;
  cancelPreview?: { charge: number; calculatedAt: string };
  cancelReason: string;
  cancelReasons: string[];
  cancelLoading: boolean;
  cancelSubmitting: boolean;
  cancelError: string;
  showGuide: boolean;
  servicePhone: string;
  pendingCancelKey: boolean;
}

const CANCEL_REASONS = ["行程变更", "选错了设备或时间", "找到其他方案", "其他原因"];

Page({
  data: {
    view: loadingState(),
    extensions: [],
    currency: "",
    timeZone: "Asia/Shanghai",
    zoneNote: "",
    startText: "",
    endText: "",
    effectiveEndText: "",
    extended: false,
    fulfillmentMode: "",
    lines: [],
    charges: [],
    balance: 0,
    balanceText: "",
    refundText: "",
    depositText: "",
    preAuthText: "",
    overdue: false,
    showCancel: false,
    cancelReason: "",
    cancelReasons: CANCEL_REASONS,
    cancelLoading: false,
    cancelSubmitting: false,
    cancelError: "",
    showGuide: false,
    servicePhone: "",
    pendingCancelKey: false
  } as OrderData,

  orderId: "" as string,
  serviceCode: "" as string,
  loadVersion: 0,

  onLoad(options: Record<string, string | undefined>) {
    this.orderId = options.id ?? "";
    this.serviceCode = options.service ?? "";
    this.setData({ servicePhone: cachedMerchant()?.servicePhone ?? "" });
    if (!requireSignIn(buildUrl(ROUTES.order, { id: this.orderId, service: this.serviceCode }))) return;
  },

  onShow() {
    void this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    if (!this.orderId || !isSignedIn()) return;
    const token = ++this.loadVersion;
    try {
      // 深链接/历史进入：订单属于其他服务时先经服务端切换（保护未提交清单）。
      if (this.serviceCode && currentServiceCode() !== this.serviceCode) {
        const ok = await ensureServiceForOrder(this.serviceCode);
        if (!ok) {
          this.setData({ view: blockedState("已保留当前租赁", "查看该订单需要切换到它所属的服务。", "回订单列表", "none") });
          return;
        }
      }
      const [order, funding, fulfillment, extensions] = await Promise.all([
        fetchOrder(this.orderId),
        fetchFunding(this.orderId).catch(() => undefined),
        fetchFulfillment(this.orderId).catch(() => undefined),
        listExtensions(this.orderId).catch(() => [] as RentalOrderExtension[]),
        ensureCurrentZone()
      ]);
      if (token !== this.loadVersion) return;
      this.render(order, funding, fulfillment, extensions);
    } catch (error) {
      if (token !== this.loadVersion || isApiError(error, "STALE_CONTEXT")) return;
      if (isApiError(error, "NOT_FOUND")) {
        this.setData({ view: blockedState("订单不存在", "该订单不属于你，或所属服务当前不可访问。", "回订单列表", "none") });
        return;
      }
      this.setData({ view: errorState(error) });
    }
  },

  render(order: ClientOrderView, funding: RentalFundingBalance | undefined, fulfillment: ClientFulfillmentView | undefined, extensions: RentalOrderExtension[]) {
    const knownZone = zoneOf(currentServiceCode());
    const timeZone = knownZone ?? "Asia/Shanghai";
    const currency = order.currency ?? "";
    const pendingExtension = extensions.some((row) => row.status === "pending_payment");
    const presentation = presentOrder({
      status: order.status,
      startAt: order.startAt,
      endAt: order.endAt,
      effectiveEndAt: order.effectiveEndAt,
      currency,
      funding: funding ? { rental: funding.rental, deposit: funding.deposit, preauthorization: funding.preauthorization } : undefined,
      pendingExtension,
      now: serverNow()
    });
    const allocationByLine = new Map<string, string[]>();
    for (const allocation of order.allocations ?? []) {
      const list = allocationByLine.get(allocation.orderLineId) ?? [];
      list.push(allocation.assetNo ? `${allocation.assetNo}（${allocation.status}）` : `${allocation.quantity} 件（${allocation.status}）`);
      allocationByLine.set(allocation.orderLineId, list);
    }
    const lines = order.lines.map((line) => ({
      key: line.id,
      name: line.itemGroupName,
      option: line.pricingGroupName ?? "",
      quantity: line.quantity,
      amount: line.amount,
      allocation: allocationByLine.get(line.id)?.join("、") ?? "商户确认后安排"
    }));
    const charges = order.chargeLines
      .filter((row) => row.type !== "rental" && row.type !== "deposit" && row.type !== "preauthorization")
      .map((row, index) => ({ key: `${row.type}-${index}`, label: row.name || chargeLabel(row.type), amount: row.amount }));
    const balance = funding?.rental.balance ?? 0;
    const effectiveEnd = order.effectiveEndAt ?? order.endAt;
    this.setData({
      view: readyState(),
      order,
      funding,
      fulfillment,
      presentation,
      currency,
      timeZone,
      zoneNote: knownZone ? zoneLabel(timeZone) : "营业时区暂未获取，以下时间按 Asia/Shanghai 显示",
      startText: formatBusinessDateTime(order.startAt, timeZone),
      endText: formatBusinessDateTime(order.endAt, timeZone),
      effectiveEndText: formatBusinessDateTime(effectiveEnd, timeZone),
      extended: Boolean(order.effectiveEndAt && order.effectiveEndAt !== order.endAt),
      fulfillmentMode: fulfillmentLabel(order.fulfillmentMode),
      lines,
      charges,
      balance,
      balanceText: funding ? (balance > 0 ? `待补款 ${formatMoney(balance, currency || undefined)}` : balance < 0 ? `待退款 ${formatMoney(-balance, currency || undefined)}` : "已结清") : "资金状态暂不可读",
      refundText: funding && funding.rental.refunded > 0 ? `已退款 ${formatMoney(funding.rental.refunded, currency || undefined)}` : "",
      depositText: funding ? `应收 ${formatMoney(funding.deposit.requiredAmount, currency || undefined)} · 已收 ${formatMoney(funding.deposit.collected, currency || undefined)} · 已退 ${formatMoney(funding.deposit.refunded, currency || undefined)} · 已抵扣 ${formatMoney(funding.deposit.captured, currency || undefined)}` : "",
      preAuthText: funding ? `应冻 ${formatMoney(funding.preauthorization.requiredAmount, currency || undefined)} · 已冻 ${formatMoney(funding.preauthorization.frozen, currency || undefined)} · 已扣 ${formatMoney(funding.preauthorization.captured, currency || undefined)} · 已释放 ${formatMoney(funding.preauthorization.released, currency || undefined)}` : "",
      overdue: order.status === "renting" && Date.parse(effectiveEnd) < serverNow(),
      extensions: extensions.map((row) => ({
        id: row.id,
        label: extensionLabel(row.status),
        period: `延长至 ${formatBusinessDateTime(row.newEndAt, timeZone)}`,
        amount: row.payableAmount,
        status: row.status,
        tone: row.status === "effective" ? "success" : row.status === "pending_payment" ? "warning" : "neutral"
      })),
      pendingCancelKey: false
    });
  },

  onAction(event: WechatMiniprogram.TouchEvent) {
    const code = String(event.currentTarget.dataset.code ?? "");
    switch (code) {
      case "pay":
        navigate(buildUrl(ROUTES.pay, { id: this.orderId }));
        return;
      case "cancel":
        void this.openCancel();
        return;
      case "extend":
        navigate(buildUrl(ROUTES.extend, { id: this.orderId, service: this.serviceCode }));
        return;
      case "guide":
        this.setData({ showGuide: true });
        return;
      case "contact":
      default:
        callPhone(this.data.servicePhone);
    }
  },

  /* ---------- 取消 ---------- */
  async openCancel() {
    // 上一次确认结果未知：沿用原幂等键并锁定原因，不允许改内容换键重试。
    const pending = pendingActionKey("order.cancel", this.orderId);
    this.setData({ showCancel: true, cancelLoading: true, cancelError: "", cancelPreview: undefined, cancelReason: pending?.fingerprint ?? "", pendingCancelKey: Boolean(pending) });
    try {
      const preview = await previewCancellation(this.orderId);
      this.setData({ cancelLoading: false, cancelPreview: { charge: preview.cancellationCharge, calculatedAt: preview.calculatedAt } });
    } catch (error) {
      this.setData({ cancelLoading: false, cancelError: describeError(error).message });
    }
  },

  onCloseCancel() {
    if (this.data.cancelSubmitting) return;
    this.setData({ showCancel: false });
  },

  onPickReason(event: WechatMiniprogram.TouchEvent) {
    if (this.data.pendingCancelKey) return;
    this.setData({ cancelReason: String(event.currentTarget.dataset.reason ?? "") });
  },

  onReasonInput(event: WechatMiniprogram.Input) {
    if (this.data.pendingCancelKey) return;
    this.setData({ cancelReason: String(event.detail.value ?? "").slice(0, 200) });
  },

  async onConfirmCancel() {
    if (this.data.cancelSubmitting || !this.data.cancelPreview) return;
    const pending = pendingActionKey("order.cancel", this.orderId);
    const reason = (pending?.fingerprint ?? this.data.cancelReason).trim();
    if (!reason) {
      this.setData({ cancelError: "请选择或填写取消原因" });
      return;
    }
    this.setData({ cancelSubmitting: true, cancelError: "" });
    const key = pending?.key ?? actionKey("order.cancel", this.orderId, reason);
    try {
      const result = await cancelOrder(this.orderId, reason, key);
      releaseActionKey("order.cancel", this.orderId);
      this.setData({ showCancel: false, pendingCancelKey: false });
      toast(result.replayed ? "订单此前已取消" : "订单已取消；退款以资金状态为准", { duration: 3000 });
      await this.load();
    } catch (error) {
      if (isApiError(error, "TIMEOUT") || isApiError(error, "NETWORK") || isApiError(error, "SERVER")) {
        this.setData({ cancelError: "取消结果未知：请刷新订单查看；如仍可取消，再次确认会使用同一凭证与原因，不会重复取消。", pendingCancelKey: true });
      } else if (isApiError(error, "CONFLICT")) {
        releaseActionKey("order.cancel", this.orderId);
        this.setData({ cancelError: `${describeError(error).message} 请重新查看取消费用。`, pendingCancelKey: false });
        void this.openCancel();
      } else {
        releaseActionKey("order.cancel", this.orderId);
        this.setData({ cancelError: describeError(error).message, pendingCancelKey: false });
      }
    } finally {
      this.setData({ cancelSubmitting: false });
    }
  },

  /* ---------- 取还指引 ---------- */
  onCloseGuide() {
    this.setData({ showGuide: false });
  },

  onCall() {
    callPhone(this.data.servicePhone);
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.order, { id: this.orderId, service: this.serviceCode }), servicePhone: this.data.servicePhone })) return;
    if (this.data.view.actionText === "回订单列表") navigate(ROUTES.orders);
    else void this.load();
  }
});
