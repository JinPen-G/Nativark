import { describeError } from "../../core/errors";
import { terms } from "../../core/context";
import { navMetrics } from "../../core/nav";
import { rememberScan, resolveScan } from "../../core/scan";
import { isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, back, buildUrl, redirect, relaunch, toast } from "../../core/ui";

/** 自定义扫码取景页。桌面模拟器或相机受限时仍可使用微信系统扫码。 */
Page({
  behaviors: [themeBehavior],
  data: { statusBarHeight: 20, torch: false, busy: false, cameraError: "", assetLabel: "物品" },
  onLoad() { this.setData({ statusBarHeight: navMetrics().statusBarHeight }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } this.setData({ assetLabel: terms().assetLabel }); },
  onBack() { back(ROUTES.scan); },
  onToggleTorch() { this.setData({ torch: !this.data.torch }); },
  onManual() { redirect(ROUTES.scanManual); },
  onCameraError(_event: WechatMiniprogram.CameraError) {
    this.setData({ cameraError: "摄像头暂不可用，请使用下方系统扫码或手动输入" });
  },
  onCameraScan(event: WechatMiniprogram.CameraScanCode) {
    const detail = event.detail as { result?: string };
    void this.handleCode(detail?.result ?? "");
  },
  onSystemScan() {
    if (this.data.busy) return;
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ["barCode", "qrCode", "datamatrix", "pdf417"],
      success: (result) => void this.handleCode(result.result),
      fail: (error) => {
        const message = String((error as { errMsg?: string }).errMsg ?? "");
        if (!/cancel/i.test(message)) toast("系统扫码未能打开，请检查摄像头权限");
      }
    });
  },
  async handleCode(code: string) {
    const value = code.trim();
    if (!value || this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: "识别中…", mask: true });
    try {
      const result = await resolveScan(value);
      if (result.kind !== "unknown") rememberScan({ code: result.code, kind: result.kind, id: result.id, title: result.title, subtitle: result.subtitle, action: "查看", imageSource: result.imageSource });
      redirect(buildUrl(ROUTES.scanResult, { code: value }));
    } catch (error) {
      toast(describeError(error).message, { duration: 3000 });
      this.setData({ busy: false });
    } finally {
      wx.hideLoading();
    }
  }
});
