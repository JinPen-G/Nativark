import { themeBehavior } from "../../core/theme-behavior";
import type { ClientOrderView, RentalOrderExtension, RentalOrderExtensionPreview } from "@rental-os/shared";
import { activatePaidExtension, applyExtension, fetchFunding, fetchOrder, listExtensions, previewExtension } from "../../api/orders";
import { describeError } from "../../core/errors";
import { ensureServiceForOrder } from "../../core/flow";
import { isApiError } from "../../core/http";
import { actionKey, releaseActionKey } from "../../core/keys";
import { describeDelta } from "../../core/money";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { rentalDue } from "../../core/payment";
import { currentServiceCode, isSignedIn } from "../../core/session";
import { formatBusinessDateTime, splitInstant, todayInZone, zoneLabel, zonedToInstant } from "../../core/time";
import { ROUTES, buildUrl, navigate, requireSignIn, toast } from "../../core/ui";
import { zoneOf, ensureCurrentZone } from "../../core/zones";

/**
 * P10 续租（需求 §10.2）。只选一个新的归还时间；金额由服务端预览返回，正/零/负差额分别说明。
 * 正差额：申请后进入收银台补款，到账后再执行“生效”动作；零差额：服务端确认资源后生效；
 * 负差额：进入审核/退款，不显示“已退款”。已有待补款申请时优先恢复它，不重复提交。
 */
interface ExtendData {
  view: ViewState;
  order?: ClientOrderView;
  timeZone: string;
  zoneNote: string;
  currentEndText: string;
  minDate: string;
  endDate: string;
  endTime: string;
  preview?: RentalOrderExtensionPreview;
  deltaText: string;
  depositDeltaText: string;
  preAuthDeltaText: string;
  previewLoading: boolean;
  previewError: string;
  submitting: boolean;
  pending?: RentalOrderExtension;
  pendingText: string;
  currency: string;
  blockedReason: string;
  unknownResult: boolean;
}

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    timeZone: "Asia/Shanghai",
    zoneNote: "",
    currentEndText: "",
    minDate: "",
    endDate: "",
    endTime: "10:00",
    deltaText: "",
    depositDeltaText: "",
    preAuthDeltaText: "",
    previewLoading: false,
    previewError: "",
    submitting: false,
    pendingText: "",
    currency: "",
    blockedReason: "",
    unknownResult: false
  } as ExtendData,

  orderId: "" as string,
  serviceCode: "" as string,

  onLoad(options: Record<string, string | undefined>) {
    this.orderId = options.id ?? "";
    this.serviceCode = options.service ?? "";
    if (!requireSignIn(buildUrl(ROUTES.extend, { id: this.orderId, service: this.serviceCode }))) return;
  },

  onShow() {
    void this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  onReload() {
    void this.load();
  },

  async load() {
    if (!this.orderId || !isSignedIn()) return;
    try {
      if (this.serviceCode && currentServiceCode() !== this.serviceCode) {
        const ok = await ensureServiceForOrder(this.serviceCode);
        if (!ok) {
          this.setData({ view: blockedState("已保留当前租赁", "续租需要切换到该订单所属的服务。", "返回订单", "none") });
          return;
        }
      }
      const [order, extensions] = await Promise.all([fetchOrder(this.orderId), listExtensions(this.orderId), ensureCurrentZone()]);
      const knownZone = zoneOf(currentServiceCode());
      const timeZone = knownZone ?? "Asia/Shanghai";
      const currentEnd = order.effectiveEndAt ?? order.endAt;
      const pending = extensions.find((row) => row.status === "pending_payment");
      const status = String(order.status);
      const blockedReason = status !== "ready_for_pickup" && status !== "renting" ? "只有待取件或使用中的订单可以续租" : "";
      const split = splitInstant(currentEnd, timeZone);
      this.setData({
        view: readyState(),
        order,
        timeZone,
        zoneNote: knownZone ? zoneLabel(timeZone) : "营业时区暂未获取，以下时间按 Asia/Shanghai 显示",
        currentEndText: formatBusinessDateTime(currentEnd, timeZone),
        minDate: split.date || todayInZone(timeZone),
        endDate: this.data.endDate || split.date,
        endTime: this.data.endTime || split.time || "10:00",
        currency: order.currency ?? "",
        pending,
        pendingText: pending ? `你有一笔待补款的续租申请（延长至 ${formatBusinessDateTime(pending.newEndAt, timeZone)}，${describeDelta(pending.payableAmount, order.currency)}）。请先完成补款并生效，不要重复申请。` : "",
        blockedReason,
        unknownResult: false
      });
    } catch (error) {
      if (isApiError(error, "STALE_CONTEXT")) return;
      // 二次加载失败保留当前续租信息，只在首屏无数据时整屏报错。
      if (this.data.order) toast("刷新失败，已保留当前续租信息");
      else this.setData({ view: errorState(error) });
    }
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    const field = String(event.currentTarget.dataset.field) as "endDate" | "endTime";
    this.setData({ [field]: String(event.detail.value), preview: undefined, deltaText: "", previewError: "" });
  },

  newEndAt(): string | undefined {
    try {
      return zonedToInstant(this.data.endDate, this.data.endTime, this.data.timeZone);
    } catch (error) {
      this.setData({ previewError: error instanceof Error ? error.message : "时间无效" });
      return undefined;
    }
  },

  async onPreview() {
    const order = this.data.order;
    if (!order || this.data.previewLoading) return;
    const newEndAt = this.newEndAt();
    if (!newEndAt) return;
    const currentEnd = Date.parse(order.effectiveEndAt ?? order.endAt);
    if (Date.parse(newEndAt) <= currentEnd) {
      this.setData({ previewError: "新的归还时间必须晚于当前归还时间" });
      return;
    }
    this.setData({ previewLoading: true, previewError: "", preview: undefined });
    try {
      const preview = await previewExtension(this.orderId, { newEndAt });
      this.setData({
        preview,
        deltaText: describeDelta(preview.payableAmount, preview.currency),
        depositDeltaText: preview.depositDelta ? describeDelta(preview.depositDelta, preview.currency) : "无变化",
        preAuthDeltaText: preview.preAuthDelta ? describeDelta(preview.preAuthDelta, preview.currency) : "无变化"
      });
    } catch (error) {
      this.setData({ previewError: describeError(error).message });
    } finally {
      this.setData({ previewLoading: false });
    }
  },

  async onApply() {
    const preview = this.data.preview;
    if (!preview || this.data.submitting) return;
    if (this.data.pending) {
      toast("已有待补款的续租申请，请先处理", { duration: 3000 });
      return;
    }
    this.setData({ submitting: true, previewError: "" });
    const key = actionKey("order.extend", this.orderId, preview.newEndAt);
    try {
      const result = await applyExtension(this.orderId, { newEndAt: preview.newEndAt }, key);
      releaseActionKey("order.extend", this.orderId);
      const extension = result.extension;
      if (extension.status === "effective") {
        toast("续租已生效", { icon: "success" });
        navigate(buildUrl(ROUTES.order, { id: this.orderId, service: this.serviceCode }));
        return;
      }
      if (extension.status === "pending_payment") {
        if (extension.payableAmount > 0) {
          toast("续租申请已提交，请完成补款", { duration: 3000 });
          navigate(buildUrl(ROUTES.pay, { id: this.orderId }));
        } else {
          toast("续租申请已提交，等待商户确认", { duration: 3000 });
          await this.load();
        }
        return;
      }
      toast(`续租申请状态：${extension.status}`, { duration: 3000 });
      await this.load();
    } catch (error) {
      if (isApiError(error, "TIMEOUT") || isApiError(error, "NETWORK") || isApiError(error, "SERVER")) {
        this.setData({ previewError: "申请结果未知：请点击下方“刷新本页”；若申请已存在会显示在上方，再次提交会使用同一凭证，不会重复申请。", unknownResult: true });
      } else {
        releaseActionKey("order.extend", this.orderId);
        this.setData({ previewError: describeError(error).message });
      }
    } finally {
      this.setData({ submitting: false });
    }
  },

  /** 补款已到账后，执行服务端资金校验的生效动作（不是付款入口）。 */
  async onActivate() {
    const pending = this.data.pending;
    if (!pending || this.data.submitting) return;
    this.setData({ submitting: true, previewError: "" });
    try {
      const funding = await fetchFunding(this.orderId);
      // 待付 = 未付余额 + 待生效续租补款；服务端 assertExtensionPaid 按同一口径校验。
      if (rentalDue(funding) > 0) {
        toast("续租补款尚未到账，请先完成付款", { duration: 3000 });
        navigate(buildUrl(ROUTES.pay, { id: this.orderId }));
        return;
      }
      const key = actionKey("order.extend.pay", pending.id);
      const result = await activatePaidExtension(this.orderId, pending.id, key);
      releaseActionKey("order.extend.pay", pending.id);
      if (result.extension.status === "effective") {
        toast("续租已生效", { icon: "success" });
        navigate(buildUrl(ROUTES.order, { id: this.orderId, service: this.serviceCode }));
      } else {
        this.setData({ previewError: "款项已收到，但续租尚未生效，正在核对；请勿重复付款。" });
      }
    } catch (error) {
      if (isApiError(error, "CONFLICT")) this.setData({ previewError: `${describeError(error).message} 款项已收的情况下不会重复收费，请联系商户核对。` });
      else this.setData({ previewError: describeError(error).message });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onPay() {
    navigate(buildUrl(ROUTES.pay, { id: this.orderId }));
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.extend, { id: this.orderId, service: this.serviceCode }) })) return;
    if (this.data.view.actionText === "返回订单") navigate(buildUrl(ROUTES.order, { id: this.orderId, service: this.serviceCode }));
    else void this.load();
  }
});
