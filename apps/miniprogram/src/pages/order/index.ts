import { themeBehavior } from "../../core/theme-behavior";
import type { ClientCatalogResponse, ClientFeeItemView, ClientFulfillmentView, ClientOrderView, RentalFundingBalance, RentalOrderExtension } from "@rental-os/shared";
import { cancelOrder, fetchFeeItems, fetchFulfillment, fetchFunding, fetchOrder, listExtensions, previewCancellation, respondToFee } from "../../api/orders";
import { contractMissing } from "../../contracts/planned";
import { isDeliveryMode } from "../../core/cart";
import { loadCatalog } from "../../core/catalogStore";
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
  pickupActionLabel: string;
  returnActionLabel: string;
  /** 配送订单收货地址快照（脱敏，取自 ClientOrderView.deliveryAddress，非旁表）；自取订单为空。 */
  hasDeliveryAddress: boolean;
  deliveryRecipientLine: string;
  deliveryAddressText: string;
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
  /* MP-11 费用确认与异议 */
  feeAvailable: boolean;
  feeLoadError: string;
  feePending: number;
  feeItems: Array<{ key: string; inspectionId: string; exceptionIndex: number; stage: string; description: string; amount: number; currency: string; statusLabel: string; statusTone: string; actionable: boolean; note: string }>;
  showFee: boolean;
  feeMode: "confirm" | "dispute";
  feeTargetLabel: string;
  feeTargetAmount: number;
  feeReason: string;
  feeReasons: string[];
  feeSubmitting: boolean;
  feeError: string;
  feePendingKey: boolean;
}

const CANCEL_REASONS = ["行程变更", "选错了设备或时间", "找到其他方案", "其他原因"];
const DISPUTE_REASONS = ["设备原有问题，非我造成", "金额与现场沟通不一致", "未收到相应设备/服务", "其他原因"];

Page({
  behaviors: [themeBehavior],
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
    pickupActionLabel: "领取",
    returnActionLabel: "归还",
    hasDeliveryAddress: false,
    deliveryRecipientLine: "",
    deliveryAddressText: "",
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
    pendingCancelKey: false,
    feeAvailable: false,
    feeLoadError: "",
    feePending: 0,
    feeItems: [],
    showFee: false,
    feeMode: "confirm",
    feeTargetLabel: "",
    feeTargetAmount: 0,
    feeReason: "",
    feeReasons: DISPUTE_REASONS,
    feeSubmitting: false,
    feeError: "",
    feePendingKey: false
  } as OrderData,

  orderId: "" as string,
  serviceCode: "" as string,
  loadVersion: 0,
  feeInspectionId: "" as string,
  feeExceptionIndex: 0 as number,

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
      const service = this.serviceCode || currentServiceCode();
      const [order, funding, fulfillment, extensions, fees, catalog] = await Promise.all([
        fetchOrder(this.orderId),
        fetchFunding(this.orderId).catch(() => undefined),
        fetchFulfillment(this.orderId).catch(() => undefined),
        listExtensions(this.orderId).catch(() => [] as RentalOrderExtension[]),
        // 费用确认/异议未开通时服务端返回 404/501/503 → 如实标记“未开通”；其他错误（网络等）只标记“暂时读不到”，不冒充未开通。
        fetchFeeItems(this.orderId).then((r) => ({ available: true, items: r.items, pending: r.pendingCount, loadError: "" })).catch((error) => contractMissing(error) ? { available: false, loadError: "" } : { available: true, loadError: describeError(error).message }),
        service ? loadCatalog(service, false).catch(() => undefined) : Promise.resolve(undefined),
        ensureCurrentZone()
      ]);
      if (token !== this.loadVersion) return;
      this.render(order, funding, fulfillment, extensions, fees, catalog);
    } catch (error) {
      if (token !== this.loadVersion || isApiError(error, "STALE_CONTEXT")) return;
      if (isApiError(error, "NOT_FOUND")) {
        this.setData({ view: blockedState("订单不存在", "该订单不属于你，或所属服务当前不可访问。", "回订单列表", "none") });
        return;
      }
      // 二次加载（下拉/onShow）失败时保留已加载详情，只在首屏无数据时整屏报错。
      if (this.data.order) toast("刷新失败，已保留已加载的订单信息");
      else this.setData({ view: errorState(error) });
    }
  },

  render(order: ClientOrderView, funding: RentalFundingBalance | undefined, fulfillment: ClientFulfillmentView | undefined, extensions: RentalOrderExtension[], fees: { available: boolean; items?: ClientFeeItemView[]; pending?: number; loadError: string }, catalog?: ClientCatalogResponse) {
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
    // 收货地址一律来自订单快照 ClientOrderView.deliveryAddress（不依赖已弃用的旁表）；仅配送订单有值。
    const address = order.deliveryAddress;
    const deliveryAddressText = address ? `${address.province}${address.city}${address.district ?? ""}${address.detail}` : "";
    const feeItems = (fees.items ?? []).map((item) => {
      const noteParts: string[] = [];
      if (item.adjustments.length) {
        const last = item.adjustments[item.adjustments.length - 1];
        noteParts.push(`商户已把金额调整为 ${formatMoney(last.toAmount, item.currency || undefined)}`);
      }
      if (item.responseReason) noteParts.push(`你的说明：${item.responseReason}`);
      if (item.evidenceCount) noteParts.push(`商户上传凭证 ${item.evidenceCount} 项`);
      return {
        key: `${item.inspectionId}-${item.exceptionIndex}`,
        inspectionId: item.inspectionId,
        exceptionIndex: item.exceptionIndex,
        stage: item.stage === "pickup" ? `${catalog?.terminology?.pickupLabel ?? "领取"}检查` : `${catalog?.terminology?.returnLabel ?? "归还"}检查`,
        description: item.description || chargeLabel(item.code),
        amount: item.amount,
        currency: item.currency,
        statusLabel: item.responseStatus === "confirmed" ? "已确认" : item.responseStatus === "disputed" ? "已提异议" : "待确认",
        statusTone: item.responseStatus === "confirmed" ? "success" : item.responseStatus === "disputed" ? "warning" : "danger",
        actionable: item.responseStatus === "pending",
        note: noteParts.join("；")
      };
    });
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
      fulfillmentMode: isDeliveryMode(order.fulfillmentMode)
        ? catalog?.fulfillment?.deliveryLabel ?? catalog?.terminology?.deliveryLabel ?? fulfillmentLabel(order.fulfillmentMode)
        : catalog?.terminology?.pickupLabel ?? fulfillmentLabel(order.fulfillmentMode),
      pickupActionLabel: catalog?.terminology?.pickupLabel ?? "领取",
      returnActionLabel: catalog?.terminology?.returnLabel ?? "归还",
      hasDeliveryAddress: Boolean(address),
      deliveryRecipientLine: address ? `${address.recipient} · ${address.phoneMasked}` : "",
      deliveryAddressText,
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
      pendingCancelKey: false,
      feeAvailable: fees.available,
      feeLoadError: fees.loadError,
      feeItems,
      feePending: fees.pending ?? feeItems.filter((row) => row.actionable).length
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

  /* ---------- MP-11 费用确认与异议 ---------- */
  onFeeAction(event: WechatMiniprogram.TouchEvent) {
    const inspectionId = String(event.currentTarget.dataset.inspection ?? "");
    const exceptionIndex = Number(event.currentTarget.dataset.index ?? 0);
    const mode = String(event.currentTarget.dataset.mode ?? "confirm") === "dispute" ? "dispute" : "confirm";
    const item = this.data.feeItems.find((row) => row.inspectionId === inspectionId && row.exceptionIndex === exceptionIndex);
    if (!item || !item.actionable) return;
    this.feeInspectionId = inspectionId;
    this.feeExceptionIndex = exceptionIndex;
    // 上一次提交结果未知：锁定原决定与原因，再次确认沿用同一凭证，不重复处理。
    const pending = pendingActionKey("order.fee-response", `${this.orderId}:${inspectionId}:${exceptionIndex}`);
    let lockedMode: "confirm" | "dispute" = mode;
    let lockedReason = "";
    if (pending) {
      const parts = pending.fingerprint.split("|");
      lockedMode = parts[0] === "disputed" ? "dispute" : "confirm";
      lockedReason = parts.slice(1).join("|");
    }
    this.setData({ showFee: true, feeMode: lockedMode, feeTargetLabel: item.description, feeTargetAmount: item.amount, feeReason: lockedMode === "dispute" ? lockedReason : "", feeError: "", feePendingKey: Boolean(pending) });
  },

  onCloseFee() {
    if (this.data.feeSubmitting) return;
    this.setData({ showFee: false });
  },

  onPickFeeReason(event: WechatMiniprogram.TouchEvent) {
    if (this.data.feePendingKey) return;
    this.setData({ feeReason: String(event.currentTarget.dataset.reason ?? "") });
  },

  onFeeReasonInput(event: WechatMiniprogram.Input) {
    if (this.data.feePendingKey) return;
    this.setData({ feeReason: String(event.detail.value ?? "").slice(0, 200) });
  },

  async onSubmitFee() {
    if (this.data.feeSubmitting) return;
    const decision: "confirmed" | "disputed" = this.data.feeMode === "dispute" ? "disputed" : "confirmed";
    const reason = decision === "disputed" ? this.data.feeReason.trim() : this.data.feeReason.trim() || "确认无异议";
    if (decision === "disputed" && !reason) {
      this.setData({ feeError: "请选择或填写异议原因" });
      return;
    }
    const id = `${this.orderId}:${this.feeInspectionId}:${this.feeExceptionIndex}`;
    const pending = pendingActionKey("order.fee-response", id);
    const key = pending?.key ?? actionKey("order.fee-response", id, `${decision}|${reason}`);
    this.setData({ feeSubmitting: true, feeError: "" });
    try {
      const result = await respondToFee(this.orderId, this.feeInspectionId, this.feeExceptionIndex, { decision, reason }, key);
      releaseActionKey("order.fee-response", id);
      this.setData({ showFee: false, feePendingKey: false });
      toast(result.replayed ? "该费用此前已处理" : decision === "disputed" ? "已提交异议，商户会尽快处理" : "已确认该费用", { duration: 2500 });
      await this.load();
    } catch (error) {
      if (isApiError(error, "TIMEOUT") || isApiError(error, "NETWORK") || isApiError(error, "SERVER")) {
        this.setData({ feeError: "提交结果未知：请刷新订单查看；如仍待处理，再次提交会沿用同一凭证与内容，不会重复处理。", feePendingKey: true });
      } else if (isApiError(error, "CONFLICT")) {
        releaseActionKey("order.fee-response", id);
        this.setData({ feeError: `${describeError(error).message} 请刷新后重试。`, feePendingKey: false });
      } else {
        releaseActionKey("order.fee-response", id);
        this.setData({ feeError: describeError(error).message, feePendingKey: false });
      }
    } finally {
      this.setData({ feeSubmitting: false });
    }
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.order, { id: this.orderId, service: this.serviceCode }), servicePhone: this.data.servicePhone })) return;
    if (this.data.view.actionText === "回订单列表") navigate(ROUTES.orders);
    else void this.load();
  }
});
