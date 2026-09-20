import type { ClientCatalogLocation } from "@rental-os/shared";
import { loadCatalog } from "../../core/catalogStore";
import { cachedUserLocation, distanceMeters, formatDistance, openLocationOnMap, requestUserLocation, type GeoPoint } from "../../core/geo";
import { isApiError } from "../../core/http";
import { cachedMerchant, findService, resolveServiceCode } from "../../core/merchant";
import { emptyState, errorState, handleCommonViewAction, loadingState, readyState } from "../../core/page";
import { currentServiceCode, isSignedIn, lastServiceCode } from "../../core/session";
import { ROUTES, buildUrl, callPhone } from "../../core/ui";

/** 常用服务点：当前服务的门店/取还地点。授权定位后按直线距离排序并支持地图导航；未授权/无坐标时退回列表顺序、不显示距离。 */
interface LocationRow extends ClientCatalogLocation {
  capabilityText: string;
  distanceText: string;
  hasCoord: boolean;
}

Page({
  data: { view: loadingState(), rows: [] as LocationRow[], serviceName: "", servicePhone: "", locating: false, locationDenied: false, anyCoord: false },
  serviceCode: "" as string,
  raw: [] as ClientCatalogLocation[],

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
      this.raw = catalog.locations.filter((row) => row.status === "enabled");
      this.render(cachedUserLocation());
      this.setData({ view: this.raw.length ? readyState() : emptyState("暂无服务点", "商户尚未在该服务下发布门店。", "", "", "none") });
    } catch (error) {
      if (isApiError(error, "STALE_CONTEXT")) return;
      if (!isSignedIn() && isApiError(error) && (error.code === "UNAVAILABLE" || error.code === "AUTH_REQUIRED")) {
        this.setData({ view: emptyState("登录后查看服务点", "商户尚未开放游客浏览。", "去登录", "", "login") });
        return;
      }
      this.setData({ view: errorState(error) });
    }
  },

  /** 组合视图：有位置时按距离升序（有坐标的在前），并计算“约 x km”。 */
  render(point: GeoPoint | undefined) {
    const anyCoord = this.raw.some((row) => typeof row.latitude === "number" && typeof row.longitude === "number");
    const rows = this.raw.map((row): LocationRow => {
      const hasCoord = typeof row.latitude === "number" && typeof row.longitude === "number";
      const meters = hasCoord && point ? distanceMeters(point, { latitude: row.latitude!, longitude: row.longitude! }) : undefined;
      return {
        ...row,
        capabilityText: row.capabilities ? [row.capabilities.includes("pickup") ? "可领取" : "", row.capabilities.includes("return") ? "可归还" : "", row.capabilities.includes("delivery") ? "支持配送" : ""].filter(Boolean).join(" · ") : "",
        distanceText: formatDistance(meters),
        hasCoord
      };
    });
    if (point) {
      rows.sort((a, b) => {
        const da = a.hasCoord ? distanceMeters(point, { latitude: a.latitude!, longitude: a.longitude! }) ?? Infinity : Infinity;
        const db = b.hasCoord ? distanceMeters(point, { latitude: b.latitude!, longitude: b.longitude! }) ?? Infinity : Infinity;
        return da - db;
      });
    }
    this.setData({ rows, anyCoord });
  },

  /** 用户主动点“按距离排序/查看附近”才请求定位；拒绝后标记 denied，不再自动弹。 */
  async onLocate() {
    if (this.data.locating) return;
    this.setData({ locating: true });
    const point = await requestUserLocation();
    this.setData({ locating: false, locationDenied: !point });
    if (point) this.render(point);
  },

  onNavigate(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const row = this.raw.find((r) => r.id === id);
    if (!row) return;
    openLocationOnMap(typeof row.latitude === "number" && typeof row.longitude === "number" ? { latitude: row.latitude, longitude: row.longitude } : undefined, row.name, row.address);
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
