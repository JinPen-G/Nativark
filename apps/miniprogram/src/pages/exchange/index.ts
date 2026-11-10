/** Own-order exchange expense application, not fulfillment. Original request and
 * closure references remain recoverable when new-spending eligibility disappears. */
import type { ClientOrderView, EnterpriseExchangeChoices, EnterpriseExchangeIntent, EnterpriseExchangeRequestOriginalResult } from "@rental-os/shared";
import { fetchEnterpriseExchangeChoices } from "../../api/enterprise";
import { fetchOrder } from "../../api/orders";
import { enterpriseExchangeRequest } from "../../core/enterprise-exchange-request";
import { themeBehavior } from "../../core/theme-behavior";
import { describeError } from "../../core/errors";
import { ensureServiceForOrder } from "../../core/flow";
import { contextVersion, currentServiceCode, currentSession, isSignedIn, sessionEvents } from "../../core/session";
import { ROUTES, buildUrl, requireSignIn } from "../../core/ui";

interface ExchangeData {
  order?: ClientOrderView | null;
  loading: boolean;
  busy: boolean;
  error: string;
  notice: string;
  pending: boolean;
  closing: boolean;
  choices?: EnterpriseExchangeChoices | null;
  lineLabels: string[];
  replacementLabels: string[];
  assetLabels: string[];
  pricingLabels: string[];
  lineIndex: number;
  replacementIndex: number;
  assetIndex: number;
  pricingIndex: number;
  priceIndex: number;
  priceLabels: string[];
  allocationId: string;
  replacementId: string;
  assetId: string;
  pricingId: string;
  serialized: boolean;
  reason: string;
  closureReason: string;
  canRequest: boolean;
}
Page({
  behaviors: [themeBehavior],
  data: { loading: true, busy: false, error: "", notice: "", pending: false, closing: false, lineLabels: [], replacementLabels: [], assetLabels: [], pricingLabels: [],
    lineIndex: -1, replacementIndex: -1, assetIndex: -1, pricingIndex: -1, priceIndex: 0, priceLabels: ["原订单价格", "替换商品当前价格"],
    allocationId: "", replacementId: "", assetId: "", pricingId: "", serialized: false, reason: "", closureReason: "", canRequest: false } as ExchangeData,
  orderId: "", serviceCode: "", visible: false, epoch: 0, lifecycle: 0, choiceSequence: 0,
  unsubscribe: undefined as (() => void) | undefined,
  operation: undefined as ReturnType<typeof enterpriseExchangeRequest> | undefined,
  identity() { return JSON.stringify([contextVersion(), currentSession()?.customer.customerId, currentServiceCode()]); },
  current(epoch: number, identity: string) { return this.visible && this.epoch === epoch && this.identity() === identity; },
  resetChoices() {
    this.choiceSequence++;
    this.setData({ choices: null, lineLabels: [], replacementLabels: [], assetLabels: [], pricingLabels: [], lineIndex: -1, replacementIndex: -1,
      assetIndex: -1, pricingIndex: -1, allocationId: "", replacementId: "", assetId: "", pricingId: "", serialized: false, canRequest: false, priceIndex: 0, reason: "" });
  },
  invalidate() {
    this.epoch++; this.operation = undefined; this.resetChoices();
    this.setData({ order: null, loading: true, busy: false, error: "", notice: "", pending: false, closing: false, closureReason: "" });
  },
  onLoad(options: Record<string, string | undefined>) {
    this.orderId = options.id ?? ""; this.serviceCode = options.service ?? "";
    requireSignIn(buildUrl(ROUTES.exchange, { id: this.orderId, service: this.serviceCode }));
  },
  onShow() {
    this.visible = true; this.lifecycle++; this.unsubscribe?.();
    this.unsubscribe = sessionEvents.on(event => { if (event.type !== "refreshed") this.invalidate(); });
    void this.load();
  },
  onHide() { this.visible = false; this.lifecycle++; this.invalidate(); this.unsubscribe?.(); this.unsubscribe = undefined; },
  onUnload() { this.onHide(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  finish(operation: ReturnType<typeof enterpriseExchangeRequest>, epoch: number, identity: string) {
    if (!this.current(epoch, identity)) return;
    try { const value = operation.pending(); this.setData({ busy: false, pending: Boolean(value), closing: Boolean(value?.closureKey) }); }
    catch (error) { this.setData({ busy: false, pending: true, error: describeError(error).message }); }
  },
  async load(): Promise<void> {
    if (!this.visible || this.data.busy) return;
    this.invalidate();
    if (!this.orderId || !isSignedIn()) { this.setData({ loading: false, error: "请先登录当前商户并核对原订单" }); return; }
    const epoch = this.epoch, lifecycle = this.lifecycle, identity = this.identity(), customerId = currentSession()?.customer.customerId;
    try {
      if (this.serviceCode && this.serviceCode !== currentServiceCode()) {
        const ok = await ensureServiceForOrder(this.serviceCode);
        // Service rotation invalidates the operation epoch; hide/reopen still cancels this continuation.
        if (!this.visible || this.lifecycle !== lifecycle || currentSession()?.customer.customerId !== customerId) return;
        if (!ok || currentServiceCode() !== this.serviceCode) { this.setData({ loading: false, error: "原订单所属服务尚未切换，不能申请" }); return; }
        return this.load();
      }
      const operation = enterpriseExchangeRequest(this.orderId, () => { if (!this.current(epoch, identity)) throw new Error("原订单页面已变化"); });
      this.operation = operation; this.finish(operation, epoch, identity);
      const order = await fetchOrder(this.orderId); operation.current();
      if (order.id !== this.orderId) throw new Error("原订单引用不一致");
      this.setData({ loading: false, order });
    } catch (error) { if (this.current(epoch, identity)) this.setData({ loading: false, error: describeError(error).message }); }
  },
  async readChoices(selectedAllocationId?: string, selectedReplacementId?: string) {
    const allocationId = selectedAllocationId ?? this.data.allocationId, replacementId = selectedReplacementId ?? this.data.replacementId;
    const operation = this.operation, epoch = this.epoch, identity = this.identity();
    if (!operation || this.data.busy || this.data.pending || this.data.order?.status !== "renting") return;
    const sequence = ++this.choiceSequence;
    this.setData({ busy: true, error: "", choices: null, canRequest: false, assetId: "", pricingId: "", assetIndex: -1, pricingIndex: -1 });
    try {
      operation.current(); if (operation.pending()) throw new Error("须先核对原申请");
      const value = await fetchEnterpriseExchangeChoices(this.orderId, { ...(allocationId ? { allocationId } : {}), ...(replacementId ? { replacementItemGroupId: replacementId } : {}) });
      operation.current(); if (sequence !== this.choiceSequence) return;
      if (value.orderId !== this.orderId || value.applicantCustomerId !== currentSession()?.customer.customerId || !value.workspaceId || value.reservation !== "not_reserved"
        || value.selectedAllocationId !== (allocationId || undefined) || value.selectedReplacementItemGroupId !== (replacementId || undefined)
        || !Number.isFinite(Date.parse(value.expectedOrderUpdatedAt))) throw new Error("原候选与本人订单不匹配");
      const replacement = value.replacements.find(row => row.itemGroupId === replacementId);
      this.setData({ choices: value, lineLabels: value.lines.map(row => `${row.itemGroupName} × ${row.quantity}${row.assetNo ? ` · ${row.assetNo}` : ""}`),
        replacementLabels: value.replacements.map(row => row.name), assetLabels: value.assets.map(row => row.assetNo), pricingLabels: ["由原服务选择", ...(replacement?.pricingGroups.map(row => row.name) ?? [])],
        lineIndex: value.lines.findIndex(row => row.allocationId === allocationId), replacementIndex: value.replacements.findIndex(row => row.itemGroupId === replacementId),
        allocationId, replacementId, serialized: replacement?.inventoryMode === "serialized", pricingIndex: 0, canRequest: Boolean(replacement && allocationId && replacement.inventoryMode === "quantity") });
    } catch (error) { if (this.current(epoch, identity)) this.setData({ error: describeError(error).message }); }
    finally { this.finish(operation, epoch, identity); }
  },
  onReadChoices() { void this.readChoices(); },
  onLine(event: WechatMiniprogram.PickerChange) {
    if (this.data.busy || this.data.pending) return;
    const row = this.data.choices?.lines[Number(event.detail.value)]; if (!row) return;
    this.setData({ replacementId: "", replacementIndex: -1 }); void this.readChoices(row.allocationId, "");
  },
  onReplacement(event: WechatMiniprogram.PickerChange) {
    if (this.data.busy || this.data.pending) return;
    const row = this.data.choices?.replacements[Number(event.detail.value)]; if (row) void this.readChoices(this.data.allocationId, row.itemGroupId);
  },
  onAsset(event: WechatMiniprogram.PickerChange) {
    if (this.data.busy || this.data.pending) return;
    const index = Number(event.detail.value), row = this.data.choices?.assets[index]; if (row) this.setData({ assetIndex: index, assetId: row.assetId, canRequest: true });
  },
  onPricing(event: WechatMiniprogram.PickerChange) {
    if (this.data.busy || this.data.pending) return;
    const index = Number(event.detail.value), row = this.data.choices?.replacements.find(row => row.itemGroupId === this.data.replacementId)?.pricingGroups[index - 1];
    if (index === 0 || row) this.setData({ pricingIndex: index, pricingId: row?.id ?? "" });
  },
  onPrice(event: WechatMiniprogram.PickerChange) { if (!this.data.busy && !this.data.pending && [0, 1].includes(Number(event.detail.value))) this.setData({ priceIndex: Number(event.detail.value) }); },
  onReason(event: WechatMiniprogram.Input) { if (!this.data.busy && !this.data.pending) this.setData({ reason: String(event.detail.value ?? "").slice(0, 500) }); },
  onClosureReason(event: WechatMiniprogram.Input) { if (!this.data.busy && !this.data.closing) this.setData({ closureReason: String(event.detail.value ?? "").slice(0, 500) }); },
  observed(value: EnterpriseExchangeRequestOriginalResult | undefined) {
    if (!value || value.state === "not_recorded") throw new Error("原申请仍待核对，不能重新发送");
    const stateLabel = value.state === "observed" ? ({ pending: "待企业批准", approved: "已批准，仍须本人确认费用", rejected: "已拒绝", withdrawn: "已撤回", expired: "已失效" }[value.approval.state]) : "";
    this.resetChoices(); this.setData({ closureReason: "", notice: value.state === "closed" ? "原申请键已永久封闭，未取消任何已成立换货或支付" : `原费用申请已核对：${stateLabel}；批准不等于换货执行` });
  },
  async onRequest() {
    const operation = this.operation, value = this.data.choices, epoch = this.epoch, identity = this.identity(), reason = this.data.reason.trim();
    if (!operation || !value || !this.data.canRequest || !reason || this.data.error || this.data.busy || this.data.pending || this.data.order?.status !== "renting") return;
    this.setData({ busy: true, error: "" });
    try {
      operation.current(); const line = value.lines.find(row => row.allocationId === this.data.allocationId), replacement = value.replacements.find(row => row.itemGroupId === this.data.replacementId);
      if (!line || !replacement || value.selectedAllocationId !== this.data.allocationId || value.selectedReplacementItemGroupId !== this.data.replacementId
        || replacement.inventoryMode === "serialized" && !value.assets.some(row => row.assetId === this.data.assetId)
        || replacement.inventoryMode === "quantity" && this.data.assetId
        || this.data.pricingId && !replacement.pricingGroups.some(row => row.id === this.data.pricingId)) throw new Error("须重新核对本次候选");
      const exchange: EnterpriseExchangeIntent = { orderLineId: line.orderLineId, allocationId: line.allocationId, replacementItemGroupId: replacement.itemGroupId,
        priceBasis: this.data.priceIndex === 1 ? "replacement_current_price" : "original_order_price", ...(this.data.assetId ? { replacementAssetId: this.data.assetId } : {}), ...(this.data.pricingId ? { replacementPricingGroupId: this.data.pricingId } : {}) };
      const result = await operation.request({ orderId: this.orderId, expectedRevision: 0, expectedOrderUpdatedAt: value.expectedOrderUpdatedAt, exchange, reason }); operation.current(); this.observed(result);
    } catch (error) { if (this.current(epoch, identity)) this.setData({ error: describeError(error).message }); }
    finally { this.finish(operation, epoch, identity); }
  },
  async onRecover() {
    const operation = this.operation, epoch = this.epoch, identity = this.identity(); if (!operation || this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try { const result = await operation.recover(); operation.current(); this.observed(result); }
    catch (error) { if (this.current(epoch, identity)) this.setData({ error: describeError(error).message }); }
    finally { this.finish(operation, epoch, identity); }
  },
  async onCloseRequest() {
    const operation = this.operation, epoch = this.epoch, identity = this.identity(), reason = this.data.closureReason.trim();
    if (!operation || this.data.busy || !this.data.pending || this.data.closing || !reason) return;
    this.setData({ busy: true, error: "" });
    try {
      operation.current(); const answer = await wx.showModal({ title: "独立结束原申请", content: "若申请未成立则永久封闭原键；若已成立只恢复，不撤回、不取消换货或退款。", confirmText: "结束原申请" });
      operation.current(); if (!answer.confirm) return;
      const result = await operation.close(reason); operation.current(); this.observed(result);
    } catch (error) { if (this.current(epoch, identity)) this.setData({ error: describeError(error).message }); }
    finally { this.finish(operation, epoch, identity); }
  }
});
