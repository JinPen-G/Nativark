import { cachedContext, contextEvents, currentLocationLabel, loadContext, setCurrentLocation, type WorkspaceContext } from "../../core/context";
import { isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, navigate, relaunch, toast } from "../../core/ui";

interface ScanEntryData {
  context?: WorkspaceContext;
  assetLabel: string;
  scanning: boolean;
  tips: string[];
  locationLabel: string;
  showLocationSheet: boolean;
}

/** 扫码 Tab 一级入口：开始扫码、手动输入、扫码记录与使用指引。 */
Page({
  behaviors: [themeBehavior],
  data: { assetLabel: "物品", scanning: false, tips: [], locationLabel: "", showLocationSheet: false } as ScanEntryData,
  offContext: undefined as (() => void) | undefined,

  onLoad() {
    this.offContext = contextEvents.on(() => this.applyContext());
  },

  onUnload() {
    this.offContext?.();
  },

  onShow() {
    if (!isSignedIn()) {
      relaunch(ROUTES.login);
      return;
    }
    this.setData({ scanning: false });
    loadContext().then(() => this.applyContext()).catch(() => this.applyContext());
  },

  applyContext() {
    const context = cachedContext();
    const assetLabel = context?.terminology.assetLabel ?? "物品";
    this.setData({
      context,
      assetLabel,
      locationLabel: currentLocationLabel(),
      tips: [
        `支持扫描${assetLabel}条码、二维码、订单码与工单码`,
        "请保持光线充足，并将条码完整放入识别框",
        `识别后查看${assetLabel}信息，可办理${context?.terminology.pickupLabel ?? "领取"}、${context?.terminology.returnLabel ?? "归还"}或绑定订单`
      ]
    });
  },

  onStartScan() {
    if (this.data.scanning) return;
    this.setData({ scanning: true });
    navigate(ROUTES.scanner);
  },

  onManual() {
    navigate(ROUTES.scanManual);
  },

  onHistory() {
    navigate(`${ROUTES.scanManual}?tab=history`);
  },

  onOpenLocation() {
    if (!this.data.context?.locations.length) {
      toast(`当前空间还没有可选的${this.data.context?.terminology.fulfillmentLabel ?? "门店"}`);
      return;
    }
    this.setData({ showLocationSheet: true });
  },

  onCloseLocation() {
    this.setData({ showLocationSheet: false });
  },

  onPickLocation(event: WechatMiniprogram.TouchEvent) {
    setCurrentLocation(String(event.currentTarget.dataset.id ?? ""));
    this.setData({ showLocationSheet: false, locationLabel: currentLocationLabel() });
  }
});
