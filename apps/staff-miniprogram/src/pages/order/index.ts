import type { RentalOrder } from "@rental-os/shared";
import { listItemGroups } from "../../api/context";
import { autoAllocate, cancelOrder, confirmOrder, getOrder } from "../../api/orders";
import { loadContext, terms } from "../../core/context";
import { describeError } from "../../core/errors";
import { resolveImage } from "../../core/images";
import { actionKey, releaseActionKey } from "../../core/keys";
import { fulfillmentModeLabel, orderStatusLabel, orderStatusTone } from "../../core/labels";
import { formatMoney } from "../../core/money";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { itemGroupCover, maskPhone } from "../../core/presenters";
import { can, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessRange } from "../../core/time";
import { ROUTES, buildUrl, callPhone, confirmDialog, copyText, navigate, promptDialog, relaunch, toast } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", orderNo: "", status: "", tone: "neutral", customer: "", phone: "", period: "", pickupLocation: "", returnLocation: "", mode: "", itemLabel: "物品", lines: [] as Array<{ id: string; name: string; quantity: number; unitPrice: string; imagePath: string }>, allocations: [] as Array<{ id: string; name: string; quantity: number; status: string }>, amount: "", deposit: "", canConfirm: false, canAllocate: false, canPickup: false, canReturn: false, canCancel: false, busy: false, error: "" },
  order: undefined as RentalOrder | undefined,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (!this.data.id) { this.setData({ view: blockedState("缺少订单编号", "请从订单列表重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const [order, context, groups] = await Promise.all([getOrder(this.data.id), loadContext(), listItemGroups().catch(() => [])]);
      this.order = order;
      const operate = can("rental-os:order:operate");
      this.setData({
        view: readyState(), orderNo: order.orderNo, status: orderStatusLabel(order.status), tone: orderStatusTone(order.status), customer: order.customerName,
        phone: maskPhone(order.contactPhone), period: formatBusinessRange(order.startAt, order.effectiveEndAt ?? order.endAt, context.locations.find((row) => row.id === order.fulfillmentLocationId)?.timezone ?? "Asia/Shanghai"),
        pickupLocation: order.fulfillmentLocationName, returnLocation: order.returnLocationName ?? order.fulfillmentLocationName, mode: fulfillmentModeLabel(order.fulfillmentMode),
        itemLabel: terms().itemLabel,
        lines: order.lines.map((line) => ({ id: line.id, name: line.itemGroupName, quantity: line.quantity - (line.cancelledQuantity ?? 0), unitPrice: formatMoney(line.unitPrice, order.currency), imagePath: "" })),
        allocations: order.allocations.filter((row) => row.status !== "released").map((row) => ({ id: row.id, name: row.assetNo || order.lines.find((line) => line.id === row.orderLineId)?.itemGroupName || row.itemGroupId || "", quantity: row.quantity, status: row.status })),
        amount: formatMoney(order.finalPayableAmount, order.currency), deposit: formatMoney(order.depositAmount, order.currency),
        canConfirm: order.status === "draft" && operate,
        canAllocate: order.status === "reserved" && operate,
        canPickup: order.status === "ready_for_pickup" && (operate || can("rental-os:order:pickup")),
        canReturn: order.status === "renting" && (operate || can("rental-os:order:return")),
        canCancel: ["draft", "reserved", "ready_for_pickup", "pickup_overdue"].includes(order.status) && (operate || can("rental-os:order:cancel"))
      });
      order.lines.forEach((line, index) => {
        const source = itemGroupCover(groups.find((group) => group.id === line.itemGroupId));
        if (source) void resolveImage(source).then((path) => { if (path && this.data.id === order.id && this.data.lines[index]?.id === line.id) this.setData({ [`lines[${index}].imagePath`]: path }); });
      });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onCopy() { if (this.order) copyText(this.order.orderNo); },
  onCall() { callPhone(this.order?.contactPhone); },
  onCustomer() { if (this.order?.customerId) navigate(buildUrl(ROUTES.customer, { id: this.order.customerId })); },
  onPickup() { navigate(buildUrl(ROUTES.pickup, { id: this.data.id })); },
  onReturn() { navigate(buildUrl(ROUTES.return, { id: this.data.id })); },
  async onConfirm() {
    if (!this.data.canConfirm || this.data.busy || !await confirmDialog({ title: "确认订单", content: "确认前请核对资金、客户资格和服务时间。" })) return;
    this.setData({ busy: true, error: "" });
    try { await confirmOrder(this.data.id); toast("订单已确认", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  async onAllocate() {
    if (!this.data.canAllocate || this.data.busy || !await confirmDialog({ title: "自动配货", content: "系统将按当前库存与订单规则分配并锁定资源。" })) return;
    this.setData({ busy: true, error: "" });
    try { await autoAllocate(this.data.id); toast("配货已完成", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  async onCancel() {
    if (!this.data.canCancel || this.data.busy) return;
    const reason = await promptDialog({ title: "取消订单", placeholder: "请填写取消原因", danger: true });
    if (reason === undefined) return;
    if (!reason) { this.setData({ error: "取消原因不能为空" }); return; }
    const key = actionKey("order.cancel", this.data.id, reason);
    this.setData({ busy: true, error: "" });
    try { await cancelOrder(this.data.id, { reason }, key); releaseActionKey("order.cancel", this.data.id); toast("订单已取消", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.order, { id: this.data.id }) })) void this.load(); }
});
