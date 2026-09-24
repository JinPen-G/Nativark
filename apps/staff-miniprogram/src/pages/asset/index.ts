import type { RentalAsset, RentalAssetStatusHistory, RentalOrder } from "@rental-os/shared";
import { listItemGroups } from "../../api/context";
import { assetStatusHistory, getAsset } from "../../api/assets";
import { listOrders } from "../../api/orders";
import { loadContext, terms } from "../../core/context";
import { assetStatusLabel, assetStatusTone, orderStatusLabel } from "../../core/labels";
import { resolveImage } from "../../core/images";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, isSignedIn } from "../../core/session";
import { itemGroupCover } from "../../core/presenters";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessDateTime, formatBusinessRange } from "../../core/time";
import { ROUTES, buildUrl, copyText, navigate, relaunch, toast } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", title: "", imagePath: "", assetLabel: "物品", serialLabel: "序列号", assetNo: "", serialNo: "", status: "", tone: "neutral", location: "", fields: [] as Array<{ label: string; value: string }>, history: [] as Array<{ id: string; action: string; detail: string; date: string }>, orders: [] as Array<{ id: string; no: string; status: string; customer: string; period: string }>, canManage: false },
  asset: undefined as RentalAsset | undefined,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  async load() {
    if (!this.data.id) { this.setData({ view: blockedState("缺少编号", "请从列表重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const context = await loadContext();
      const asset = await getAsset(this.data.id);
      if (!asset) { this.setData({ view: blockedState("未找到记录", "该物品不在当前经营空间或已被移除") }); return; }
      this.asset = asset;
      const [history, orders, groups] = await Promise.all([assetStatusHistory(asset.id).catch(() => [] as RentalAssetStatusHistory[]), listOrders().catch(() => [] as RentalOrder[]), listItemGroups().catch(() => [])]);
      const fields = context.assetFields.filter((f) => f.scope === "asset" && f.code !== "serialNo").map((f) => ({ label: f.label, value: String(asset.attributes[f.code] ?? "").trim() })).filter((row) => row.value);
      const timeZone = context.locations.find((row) => row.id === asset.locationId)?.timezone ?? "Asia/Shanghai";
      this.setData({ view: readyState(), title: asset.itemGroupName, imagePath: "", assetLabel: terms().assetLabel, serialLabel: terms().serialLabel, assetNo: asset.assetNo, serialNo: asset.serialNo ?? "", status: assetStatusLabel(asset.status), tone: assetStatusTone(asset.status), location: asset.locationName, fields, canManage: can("rental-core:asset:manage"), history: history.slice(0, 6).map((row) => ({ id: row.id, action: `${assetStatusLabel(row.fromStatus ?? "")} → ${assetStatusLabel(row.toStatus)}`, detail: row.reason, date: formatBusinessDateTime(row.createdAt, timeZone) })), orders: orders.filter((order) => order.allocations.some((a) => a.assetId === asset.id)).slice(0, 5).map((order) => ({ id: order.id, no: order.orderNo, status: orderStatusLabel(order.status), customer: order.customerName, period: formatBusinessRange(order.startAt, order.effectiveEndAt ?? order.endAt, timeZone) })) });
      const cover = itemGroupCover(groups.find((row) => row.id === asset.itemGroupId));
      if (cover) void resolveImage(cover).then((path) => { if (path && this.data.id === asset.id) this.setData({ imagePath: path }); });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onCopy() { if (this.data.assetNo) copyText(this.data.assetNo); },
  onEdit() { if (this.data.canManage) navigate(buildUrl(ROUTES.assetNew, { id: this.data.id })); },
  onLedger() { if (this.asset) navigate(buildUrl(ROUTES.assetLedger, { itemGroupId: this.asset.itemGroupId })); },
  onScrollToRental() {
    if (!this.data.orders.length) { toast("暂无租赁历史"); return; }
    wx.pageScrollTo({ selector: "#asset-rental-history", duration: 240 });
  },
  onOrder(event: WechatMiniprogram.TouchEvent) { navigate(buildUrl(ROUTES.order, { id: String(event.currentTarget.dataset.id ?? "") })); },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.asset, { id: this.data.id }) })) void this.load(); }
});
