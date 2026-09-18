import type { ClientCatalogLocation } from "@rental-os/shared";
import { loadCatalog } from "../../core/catalogStore";
import { isApiError } from "../../core/http";
import { cachedMerchant, findService, resolveServiceCode } from "../../core/merchant";
import { emptyState, errorState, handleCommonViewAction, loadingState, readyState } from "../../core/page";
import { currentServiceCode, isSignedIn, lastServiceCode } from "../../core/session";
import { ROUTES, buildUrl, callPhone } from "../../core/ui";

/** 常用服务点：当前服务的门店/取还地点，含地址、营业时段、电话与取还能力。距离与导航属后续（需定位授权）。 */
interface LocationRow extends ClientCatalogLocation {
  capabilityText: string;
}

Page({
  data: { view: loadingState(), rows: [] as LocationRow[], serviceName: "", servicePhone: "" },
  serviceCode: "" as string,

  onLoad(options: Record<string, string | undefined>) {
    const merchant = cachedMerchant();
    this.serviceCode = options.service || (isSignedIn() ? currentServiceCode() : lastServiceCode()) || resolveServiceCode(merchant) || "";
    this.setData({ serviceName: findService(merchant, this.serviceCode)?.name ?? "", servicePhone: merchant?.servicePhone ?? "" });
  },

  onShow() {
    void this.load();
  },

  async load() {
    if (!this.serviceCode) {
      this.setData({ view: emptyState("请先选择服务", "回到首页选择要租用的服务。", "回首页", "", "none") });
      return;
    }
    try {
      const catalog = await loadCatalog(this.serviceCode, false);
      const rows = catalog.locations.filter((row) => row.status === "enabled").map((row): LocationRow => ({
        ...row,
        capabilityText: row.capabilities ? [row.capabilities.includes("pickup") ? "可领取" : "", row.capabilities.includes("return") ? "可归还" : "", row.capabilities.includes("delivery") ? "支持配送" : ""].filter(Boolean).join(" · ") : ""
      }));
      this.setData({ rows, view: rows.length ? readyState() : emptyState("暂无服务点", "商户尚未在该服务下发布门店。", "", "", "none") });
    } catch (error) {
      if (isApiError(error, "STALE_CONTEXT")) return;
      if (!isSignedIn() && isApiError(error) && (error.code === "UNAVAILABLE" || error.code === "AUTH_REQUIRED")) {
        this.setData({ view: emptyState("登录后查看服务点", "商户尚未开放游客浏览。", "去登录", "", "login") });
        return;
      }
      this.setData({ view: errorState(error) });
    }
  },

  onCall(event: WechatMiniprogram.TouchEvent) {
    const phone = String(event.currentTarget.dataset.phone ?? "") || this.data.servicePhone;
    callPhone(phone);
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.locations, { service: this.serviceCode }) })) return;
    if (this.data.view.actionText === "回首页") wx.switchTab({ url: ROUTES.home });
    else void this.load();
  }
});
