import { cachedContext, contextEvents, currentLocationLabel, loadContext, setCurrentLocation, type WorkspaceContext } from "../../core/context";
import { rememberScan, resolveScan, scanHistory, type ScanHistoryEntry } from "../../core/scan";
import { isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, navigate, relaunch, toast } from "../../core/ui";
import { describeError } from "../../core/errors";

/**
 * S04 扫码（Tab 一级页）：开始扫码（相机/相册）→ 服务端范围内解析 → 扫码结果页；手动输入与扫码记录入口；小贴士。
 * 支持的码类型按品类术语提示（{identifierLabel} 条码 / 二维码 / 订单码 / 工单码）。
 */
interface ScanData {
  context?: WorkspaceContext;
  scanning: boolean;
  recent: ScanHistoryEntry[];
  tips: string[];
  locationLabel: string;
  showLocationSheet: boolean;
}

Page({
  behaviors: [themeBehavior],
  data: { scanning: false, recent: [], tips: [], locationLabel: "", showLocationSheet: false } as ScanData,
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
    loadContext().then(() => this.applyContext()).catch(() => this.applyContext());
    this.setData({ recent: scanHistory().slice(0, 3) });
  },

  applyContext() {
    const context = cachedContext();
    const t = context?.terminology;
    this.setData({
      context,
      locationLabel: currentLocationLabel(),
      tips: [
        `支持扫描${t?.assetLabel ?? "物品"}条码、二维码、订单码与工单码`,
        "请保持光线充足、对准条码",
        `扫描后自动识别${t?.assetLabel ?? "物品"}信息，可直接办理出库、入库或绑定订单`
      ]
    });
  },

  onStartScan() {
    if (this.data.scanning) return;
    navigate(ROUTES.scanner);
  },

  async handleCode(code: string) {
    const text = (code ?? "").trim();
    if (!text) {
      this.setData({ scanning: false });
      toast("没有识别到内容");
      return;
    }
    wx.showLoading({ title: "识别中…", mask: true });
    try {
      const result = await resolveScan(text);
      if (result.kind !== "unknown") rememberScan({ code: result.code, kind: result.kind, id: result.id, title: result.title, subtitle: result.subtitle, action: "查看", imageSource: result.imageSource });
      navigate(buildUrl(ROUTES.scanResult, { code: text }));
    } catch (error) {
      toast(describeError(error).message, { duration: 3000 });
    } finally {
      wx.hideLoading();
      this.setData({ scanning: false });
    }
  },

  onManual() {
    navigate(ROUTES.scanManual);
  },

  onHistory() {
    navigate(buildUrl(ROUTES.scanManual, { tab: "history" }));
  },

  onRecent(event: WechatMiniprogram.TouchEvent) {
    navigate(buildUrl(ROUTES.scanResult, { code: String(event.currentTarget.dataset.code ?? "") }));
  },

  onOpenLocation() {
    if (this.data.context?.locations.length) this.setData({ showLocationSheet: true });
  },

  onCloseLocation() {
    this.setData({ showLocationSheet: false });
  },

  onPickLocation(event: WechatMiniprogram.TouchEvent) {
    setCurrentLocation(String(event.currentTarget.dataset.id ?? ""));
    this.setData({ showLocationSheet: false, locationLabel: currentLocationLabel() });
  }
});
