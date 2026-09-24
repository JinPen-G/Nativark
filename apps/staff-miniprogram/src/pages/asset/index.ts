import type { RentalAsset, RentalAssetStatus, RentalAssetStatusHistory, RentalOrder } from "@rental-os/shared";
import { assetStatusHistory, getAsset, saveAsset } from "../../api/assets";
import { itemGroupImagePath, listItemGroups } from "../../api/context";
import { listOrders } from "../../api/orders";
import { categoryIcon, loadContext, terms } from "../../core/context";
import { describeError } from "../../core/errors";
import { resolveImage } from "../../core/images";
import { assetStatusLabel, assetStatusTone, orderStatusLabel, orderStatusTone } from "../../core/labels";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessDate, formatBusinessDateTime } from "../../core/time";
import { ROUTES, buildUrl, confirmDialog, copyText, navigate, relaunch, toast } from "../../core/ui";

/** 属性值展示：布尔转“是/否”，数值带上品类声明的单位；空值由调用方过滤掉。 */
function attrText(field: { type: string; unit?: string }, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (field.type === "boolean") return raw ? "是" : "否";
  const text = String(raw).trim();
  if (!text) return "";
  return field.unit ? `${text} ${field.unit}` : text;
}

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState() as ViewState,
    id: "",
    screenPad: "screen--flat",
    title: "",
    categoryName: "",
    status: "",
    tone: "neutral",
    images: [] as string[],
    imageCount: 0,
    imageLabel: "",
    albumLoop: false,
    placeholderIcon: "box",
    assetLabel: "物品",
    identifierLabel: "编号",
    serialLabel: "序列号",
    fulfillmentLabel: "",
    itemGroupLabel: "",
    assetNo: "",
    serialNo: "",
    locationName: "",
    entryTime: "",
    fields: [] as Array<{ label: string; value: string }>,
    modelFields: [] as Array<{ label: string; value: string }>,
    modelOpen: false,
    modelIcon: "chevron-right",
    orders: [] as Array<{ id: string; no: string; status: string; tone: string; customer: string; period: string }>,
    ordersMore: false,
    history: [] as Array<{ id: string; action: string; detail: string; date: string }>,
    canManage: false,
    canLedger: false,
    canWorkOrders: false,
    canScan: false,
    statusTarget: "",
    statusActionLabel: "",
    showBottomBar: false
  },
  asset: undefined as RentalAsset | undefined,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  async load() {
    if (!this.data.id) { this.setData({ view: blockedState("缺少编号", "请从列表重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const context = await loadContext();
      const asset = await getAsset(this.data.id);
      if (!asset) { this.setData({ view: blockedState("未找到记录", "该记录不在当前经营空间或已被移除") }); return; }
      this.asset = asset;
      const [history, orders, groups] = await Promise.all([
        assetStatusHistory(asset.id).catch(() => [] as RentalAssetStatusHistory[]),
        listOrders().catch(() => [] as RentalOrder[]),
        listItemGroups().catch(() => [])
      ]);
      const t = terms();
      const group = groups.find((row) => row.id === asset.itemGroupId);
      const timeZone = context.locations.find((row) => row.id === asset.locationId)?.timezone ?? "Asia/Shanghai";
      // 资产字段动态渲染：scope=asset 直接落在资产上；scope=item_group 是型号参数，读型号主档属性。
      const fields = context.assetFields.filter((f) => f.scope === "asset" && f.code !== "serialNo").map((f) => ({ label: f.label, value: attrText(f, asset.attributes[f.code]) })).filter((row) => row.value);
      const modelFields = context.assetFields.filter((f) => f.scope === "item_group").map((f) => ({ label: f.label, value: attrText(f, group?.attributes[f.code]) })).filter((row) => row.value);
      const matched = orders.filter((order) => order.allocations.some((a) => a.assetId === asset.id));
      const statusValue: string = asset.status;
      const canManage = can("rental-core:asset:manage");
      // 状态切换只开放非租用中的安全流转（占用中的资产必须走订单取还，不在此手工翻转）。
      let statusTarget = "";
      let statusActionLabel = "";
      if (canManage) {
        if (statusValue === "available") { statusTarget = "maintenance"; statusActionLabel = "转为维护"; }
        else if (statusValue === "maintenance" || statusValue === "disabled" || statusValue === "inspection") { statusTarget = "available"; statusActionLabel = "转为闲置"; }
      }
      const canScan = can("rental-os:order:pickup", "rental-os:order:operate");
      this.setData({
        view: readyState(),
        screenPad: statusTarget || canScan ? "" : "screen--flat",
        title: asset.itemGroupName,
        categoryName: context.categoryName,
        status: assetStatusLabel(asset.status),
        tone: assetStatusTone(asset.status),
        images: [], imageCount: 0, imageLabel: "", albumLoop: false, placeholderIcon: categoryIcon(context.categoryCode),
        assetLabel: t.assetLabel, identifierLabel: t.identifierLabel, serialLabel: t.serialLabel, fulfillmentLabel: t.fulfillmentLabel, itemGroupLabel: t.itemGroupLabel,
        assetNo: asset.assetNo, serialNo: asset.serialNo ?? "", locationName: asset.locationName, entryTime: formatBusinessDateTime(asset.createdAt, timeZone),
        fields, modelFields, modelOpen: false, modelIcon: "chevron-right",
        orders: matched.slice(0, 5).map((order) => ({ id: order.id, no: order.orderNo, status: orderStatusLabel(order.status), tone: orderStatusTone(order.status), customer: order.customerName, period: `${formatBusinessDate(order.startAt, timeZone)} ~ ${formatBusinessDate(order.effectiveEndAt ?? order.endAt, timeZone)}` })),
        ordersMore: matched.length > 5,
        history: history.slice(0, 6).map((row) => ({ id: row.id, action: `${assetStatusLabel(row.fromStatus ?? "")} → ${assetStatusLabel(row.toStatus)}`, detail: row.reason, date: formatBusinessDateTime(row.createdAt, timeZone) })),
        canManage, canLedger: can("rental-core:asset:view", "rental-core:asset:manage"), canWorkOrders: can("rental-core:maintenance:view"), canScan,
        statusTarget, statusActionLabel, showBottomBar: Boolean(statusTarget) || canScan
      });
      // 相册：资产本身无独立图，取型号(itemGroup)的多图逐张解析；无图退化为品类图标占位。
      const sources = (group?.images ?? []).map((img) => img.url || itemGroupImagePath(group!.id, img.id));
      if (sources.length) {
        const paths = await Promise.all(sources.map((src) => resolveImage(src).catch(() => "")));
        const images = paths.filter((path) => Boolean(path));
        if (this.data.id === asset.id) this.setData({ images, imageCount: images.length, imageLabel: images.length > 1 ? `1/${images.length}` : "", albumLoop: images.length > 1 });
      }
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onSwiperChange(event: WechatMiniprogram.SwiperChange) {
    const current = Number(event.detail.current) || 0;
    this.setData({ imageLabel: this.data.imageCount > 1 ? `${current + 1}/${this.data.imageCount}` : "" });
  },
  onToggleModel() { const open = !this.data.modelOpen; this.setData({ modelOpen: open, modelIcon: open ? "chevron-down" : "chevron-right" }); },
  onCopy() { if (this.data.assetNo) copyText(this.data.assetNo); },
  onEdit() { if (this.data.canManage) navigate(buildUrl(ROUTES.assetNew, { id: this.data.id })); },
  onLedger() { if (this.asset) navigate(buildUrl(ROUTES.assetLedger, { itemGroupId: this.asset.itemGroupId })); },
  onWorkOrders() { if (this.data.canWorkOrders) navigate(ROUTES.workOrders); },
  onScan() { if (this.data.canScan) navigate(ROUTES.scanner); },
  onOrder(event: WechatMiniprogram.TouchEvent) { navigate(buildUrl(ROUTES.order, { id: String(event.currentTarget.dataset.id ?? "") })); },
  onViewMoreOrders() { navigate(ROUTES.orders); },
  async onStatusChange() {
    const target = this.data.statusTarget;
    if (!this.data.canManage || !target || !this.asset) return;
    const asset = this.asset;
    const confirmed = await confirmDialog({ title: this.data.statusActionLabel, content: `确认将当前${this.data.assetLabel}状态调整为「${assetStatusLabel(target)}」？` });
    if (!confirmed) return;
    try {
      await saveAsset({ id: asset.id, itemGroupId: asset.itemGroupId, assetNo: asset.assetNo, serialNo: asset.serialNo, locationId: asset.locationId, status: target as RentalAssetStatus, attributes: asset.attributes });
      toast("已更新", { icon: "success" });
      void this.load();
    } catch (error) { toast(describeError(error).message); }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.asset, { id: this.data.id }) })) void this.load(); }
});
