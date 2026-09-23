import type { RentalOrder } from "@rental-os/shared";
import { listItemGroups } from "../../api/context";
import { listOrders } from "../../api/orders";
import { cachedContext, categoryIcon, loadContext, terms } from "../../core/context";
import { describeError } from "../../core/errors";
import { resolveImage } from "../../core/images";
import { assetStatusLabel, assetStatusTone, inventoryModeLabel, orderStatusLabel, orderStatusTone, workOrderStatusLabel, workOrderStatusTone, workOrderTypeLabel, type Tone } from "../../core/labels";
import { errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { itemGroupCover, maskPhone } from "../../core/presenters";
import { rememberScan, resolveScan, type ScanResult } from "../../core/scan";
import { can, contextVersion, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessDate } from "../../core/time";
import { ROUTES, buildUrl, navigate, redirect, relaunch, toast } from "../../core/ui";

/**
 * S06 扫码结果：按识别到的对象类型（资产/订单/型号/工单）展示信息卡与快捷操作。
 * 快捷操作只做“定位 + 跳转”，真正的出库/入库仍在订单交接页里由服务端校验完成。
 * 品类名词全部经 terms()；操作按权限码门控，无权限不显示。
 */
interface KeyValue {
  label: string;
  value: string;
  tone?: Tone;
  tag?: boolean;
}

interface QuickAction {
  key: "pickup" | "return" | "bind" | "detail" | "order" | "assets" | "workOrder";
  title: string;
  desc: string;
  icon: string;
  color: string;
}

interface ScanResultData {
  view: ViewState;
  code: string;
  kind: ScanResult["kind"];
  kindLabel: string;
  title: string;
  subtitle: string;
  failReason: string;
  imageSource: string;
  imagePath: string;
  fallbackIcon: string;
  /** 信息卡主体行（编号/SN/客户等）。 */
  rows: KeyValue[];
  /** 信息卡底部两格（状态 | 地点）。 */
  cells: KeyValue[];
  actions: QuickAction[];
  busy: boolean;
}

const DEFAULT_ZONE = "Asia/Shanghai";
const PENDING_PICKUP = new Set<string>(["reserved", "ready_for_pickup", "pickup_overdue"]);

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    code: "",
    kind: "unknown",
    kindLabel: "",
    title: "",
    subtitle: "",
    failReason: "",
    imageSource: "",
    imagePath: "",
    fallbackIcon: "box",
    rows: [],
    cells: [],
    actions: [],
    busy: false
  } as ScanResultData,
  result: undefined as ScanResult | undefined,

  onLoad(query: Record<string, string>) {
    let code = String(query.code ?? "");
    try {
      code = decodeURIComponent(code);
    } catch {
      // 保持原样
    }
    this.setData({ code: code.trim() });
  },

  onShow() {
    if (!isSignedIn()) {
      relaunch(ROUTES.login);
      return;
    }
    if (!this.result) void this.load();
  },

  async load() {
    const code = this.data.code;
    if (!code) {
      this.setData({ view: readyState(), kind: "unknown", failReason: "没有收到任何码值" });
      return;
    }
    this.setData({ view: loadingState() });
    const version = contextVersion();
    try {
      await loadContext().catch(() => undefined);
      const result = await resolveScan(code);
      if (version !== contextVersion()) return;
      this.result = result;
      this.present(result);
    } catch (error) {
      this.setData({ view: errorState(error) });
    }
  },

  present(result: ScanResult) {
    const t = terms();
    const timeZone = cachedContext()?.locations[0]?.timezone ?? DEFAULT_ZONE;
    const fallbackIcon = categoryIcon();
    const rows: KeyValue[] = [];
    const cells: KeyValue[] = [];
    const actions: QuickAction[] = [];
    let kindLabel = "";
    let imageSource = result.imageSource ?? "";

    if (result.kind === "asset" && result.asset) {
      const asset = result.asset;
      kindLabel = t.assetLabel;
      rows.push({ label: t.identifierLabel, value: asset.assetNo });
      if (asset.serialNo) rows.push({ label: "序列号", value: asset.serialNo });
      cells.push({ label: `${t.assetLabel}状态`, value: assetStatusLabel(asset.status), tone: assetStatusTone(asset.status), tag: true });
      cells.push({ label: `所在${t.fulfillmentLabel}`, value: asset.locationName || "—" });
      if (can("rental-os:order:pickup")) actions.push({ key: "pickup", title: "出库", desc: `办理${t.assetLabel}出库`, icon: "box-out", color: "primary" });
      if (can("rental-os:order:return")) actions.push({ key: "return", title: "入库", desc: `办理${t.assetLabel}归还入库`, icon: "box-in", color: "green" });
      if (can("rental-os:order:pickup", "rental-os:order:allocate", "rental-os:order:write")) actions.push({ key: "bind", title: "绑定订单", desc: "关联到租赁订单", icon: "link", color: "purple" });
      actions.push({ key: "detail", title: "查看详情", desc: `查看${t.assetLabel}完整信息`, icon: "eye", color: "orange" });
      // 型号封面需从型号目录取；找不到用品类图标。
      if (!imageSource) {
        listItemGroups()
          .then((groups) => itemGroupCover(groups.find((row) => row.id === asset.itemGroupId)))
          .then((source) => {
            if (source && this.result === result) this.loadImage(source);
          })
          .catch(() => undefined);
      }
    } else if (result.kind === "order" && result.order) {
      const order = result.order;
      kindLabel = "订单";
      const period = `${formatBusinessDate(order.startAt, timeZone)} ~ ${formatBusinessDate(order.effectiveEndAt ?? order.endAt, timeZone)}`;
      const names = (order.lines ?? []).map((line) => line.itemGroupName);
      rows.push({ label: "客户", value: `${order.customerName}${order.contactPhone ? ` ${maskPhone(order.contactPhone)}` : ""}` });
      rows.push({ label: "租期", value: period });
      rows.push({ label: t.fulfillmentLabel, value: order.fulfillmentLocationName || "—" });
      rows.push({ label: t.itemLabel, value: names.length > 1 ? `${names[0]} 等 ${names.length} 种` : names[0] ?? "—" });
      cells.push({ label: "订单状态", value: orderStatusLabel(order.status), tone: orderStatusTone(order.status), tag: true });
      cells.push({ label: "订单号", value: order.orderNo });
      if (PENDING_PICKUP.has(order.status) && can("rental-os:order:pickup")) actions.push({ key: "pickup", title: "出库登记", desc: `办理本单${t.pickupLabel}交付`, icon: "box-out", color: "primary" });
      if (order.status === "renting" && can("rental-os:order:return")) actions.push({ key: "return", title: "归还验收", desc: `办理本单${t.returnLabel}入库`, icon: "box-in", color: "green" });
      actions.push({ key: "order", title: "查看订单详情", desc: "查看订单完整信息", icon: "orders", color: "orange" });
    } else if (result.kind === "itemGroup" && result.itemGroup) {
      const group = result.itemGroup;
      kindLabel = t.itemGroupLabel;
      imageSource = imageSource || itemGroupCover(group);
      rows.push({ label: `${t.itemGroupLabel}编码`, value: group.code });
      rows.push({ label: "库存模式", value: inventoryModeLabel(group.inventoryMode) });
      cells.push({ label: "状态", value: group.status === "enabled" ? "已启用" : "已停用", tone: group.status === "enabled" ? "success" : "neutral", tag: true });
      cells.push({ label: "单位", value: group.unit || "—" });
      actions.push({ key: "assets", title: `查看${t.assetLabel}列表`, desc: `查看该${t.itemGroupLabel}下的${t.assetLabel}`, icon: "layers", color: "primary" });
    } else if (result.kind === "workOrder" && result.workOrder) {
      const workOrder = result.workOrder;
      kindLabel = "工单";
      rows.push({ label: "类型", value: workOrderTypeLabel(workOrder.type) });
      rows.push({ label: "原因", value: workOrder.reason || "—" });
      cells.push({ label: "工单状态", value: workOrderStatusLabel(workOrder.status), tone: workOrderStatusTone(workOrder.status), tag: true });
      cells.push({ label: "工单号", value: workOrder.workNo });
      actions.push({ key: "workOrder", title: "查看工单", desc: "查看工单详情并处理", icon: "tool", color: "purple" });
    }

    this.setData({
      view: readyState(),
      kind: result.kind,
      kindLabel,
      title: result.title,
      subtitle: result.subtitle,
      failReason: result.kind === "unknown" ? result.subtitle : "",
      imageSource,
      imagePath: "",
      fallbackIcon,
      rows,
      cells,
      actions
    });
    if (imageSource) this.loadImage(imageSource);
  },

  loadImage(source: string) {
    const version = contextVersion();
    resolveImage(source).then((path) => {
      if (path && version === contextVersion()) this.setData({ imageSource: source, imagePath: path });
    });
  },

  remember(action: string) {
    const result = this.result;
    if (!result || result.kind === "unknown") return;
    rememberScan({ code: result.code, kind: result.kind, id: result.id, title: result.title, subtitle: result.subtitle, action, imageSource: this.data.imageSource || result.imageSource });
  },

  async onAction(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? "") as QuickAction["key"];
    const result = this.result;
    if (!result || this.data.busy) return;
    const t = terms();
    switch (key) {
      case "detail":
        this.remember("查看");
        navigate(buildUrl(ROUTES.asset, { id: result.id }));
        return;
      case "order":
        this.remember("查看");
        navigate(buildUrl(ROUTES.order, { id: result.id }));
        return;
      case "assets":
        this.remember("查看");
        navigate(buildUrl(ROUTES.assets, { itemGroupId: result.id }));
        return;
      case "workOrder":
        this.remember("查看");
        navigate(buildUrl(ROUTES.workOrder, { id: result.id }));
        return;
      case "bind":
        this.remember("绑定订单");
        toast("请在待取货订单详情内为该订单配货", { duration: 3000 });
        navigate(buildUrl(ROUTES.orders, { tab: "pending_pickup" }));
        return;
      case "pickup":
      case "return": {
        if (result.kind === "order") {
          this.remember(key === "pickup" ? "出库" : "入库");
          navigate(buildUrl(key === "pickup" ? ROUTES.pickup : ROUTES.return, { id: result.id }));
          return;
        }
        const order = await this.findOrderForAsset(result.id, key);
        if (!order) {
          toast(key === "pickup" ? `该${t.assetLabel}没有待出库的订单` : `该${t.assetLabel}没有使用中的订单`, { duration: 3000 });
          return;
        }
        this.remember(key === "pickup" ? "出库" : "入库");
        navigate(buildUrl(key === "pickup" ? ROUTES.pickup : ROUTES.return, { id: order.id }));
        return;
      }
      default:
        return;
    }
  },

  /** 在授权范围内找含该资产分配的订单：出库看待取货态，入库看使用中。 */
  async findOrderForAsset(assetId: string, stage: "pickup" | "return"): Promise<RentalOrder | undefined> {
    this.setData({ busy: true });
    wx.showLoading({ title: "查找订单…", mask: true });
    try {
      const orders = await listOrders();
      const holds = (order: RentalOrder) => (order.allocations ?? []).some((row) => row.assetId === assetId && row.status !== "released" && row.status !== "returned");
      const matched = orders.filter((order) => holds(order) && (stage === "pickup" ? PENDING_PICKUP.has(order.status) : order.status === "renting"));
      matched.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
      return matched[0];
    } catch (error) {
      toast(describeError(error).message, { duration: 3000 });
      return undefined;
    } finally {
      wx.hideLoading();
      this.setData({ busy: false });
    }
  },

  onRescan() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ["barCode", "qrCode", "datamatrix", "pdf417"],
      success: (res) => {
        const code = String(res.result ?? "").trim();
        if (!code) {
          toast("没有识别到内容");
          return;
        }
        redirect(buildUrl(ROUTES.scanResult, { code }));
      },
      fail: (error) => {
        const message = String((error as { errMsg?: string }).errMsg ?? "");
        if (!/cancel/i.test(message)) toast("未能打开扫码，请检查摄像头权限");
      },
      complete: () => this.setData({ busy: false })
    });
  },

  onManual() {
    navigate(buildUrl(ROUTES.scanManual, { code: this.data.code }));
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.scanResult, { code: this.data.code }) })) return;
    void this.load();
  }
});
