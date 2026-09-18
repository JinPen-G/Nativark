import { configProblem } from "../../config/public";
import { cachedCatalog, hydrateImages, loadCatalog, primaryLocation, searchItems, setPendingSearch, toItemCard, type ItemCard } from "../../core/catalogStore";
import { isApiError } from "../../core/http";
import { categoryIcon } from "../../core/labels";
import { cachedMerchant, findService, loadMerchant, merchantEvents, resolveServiceCode, type MerchantInfo } from "../../core/merchant";
import { blockedState, emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { contextVersion, isSignedIn, sessionEvents } from "../../core/session";
import { switchService } from "../../core/flow";
import { ROUTES, buildUrl, callPhone, navigate } from "../../core/ui";

/**
 * P01 首页（V2 设计稿）：搜索 → 主题横幅 → 品类入口 → 热门推荐 → 附近服务点。
 * 商户身份由打包配置决定，页面不显示商户名称；品类入口 = 商户已发布的服务，点击切换服务并进入分类页。
 */
interface HomeData {
  query: string;
  services: Array<{ code: string; name: string; icon: string; active: boolean; paused: boolean }>;
  cards: ItemCard[];
  view: ViewState;
  merchantView: ViewState;
  servicePhone: string;
  store?: { id: string; name: string; address: string; hours: string; phone: string };
  signedIn: boolean;
  serviceName: string;
}

const HOT_LIMIT = 6;

Page({
  data: {
    query: "",
    services: [],
    cards: [],
    view: loadingState(),
    merchantView: loadingState(),
    servicePhone: "",
    signedIn: false,
    serviceName: ""
  } as HomeData,

  serviceCode: "" as string,
  /** 分享/深链接带来的服务编码：商户信息就绪后按它选择服务（只接受已发布的服务）。 */
  requestedServiceCode: "" as string,
  unsubscribe: [] as Array<() => void>,
  loadVersion: 0,

  onLoad(options: Record<string, string | undefined>) {
    this.requestedServiceCode = String(options.service ?? "").slice(0, 64);
    this.unsubscribe = [
      sessionEvents.on((event) => {
        if (event.type === "refreshed") return;
        this.setData({ signedIn: isSignedIn() });
        this.serviceCode = "";
        void this.bootstrap(false);
      }),
      merchantEvents.on((info) => this.applyMerchant(info))
    ];
  },

  onShow() {
    this.setData({ signedIn: isSignedIn() });
    void this.bootstrap(false);
  },

  onUnload() {
    for (const off of this.unsubscribe) off();
  },

  onPullDownRefresh() {
    Promise.all([this.bootstrap(true), this.loadItems(true)]).finally(() => wx.stopPullDownRefresh());
  },

  onShareAppMessage() {
    // 分享只带公开的服务标识，不带任何令牌或个人信息。
    return { title: this.data.serviceName ? `${this.data.serviceName} · 租设备` : "Rental OS 租设备", path: buildUrl(ROUTES.home, { service: this.serviceCode }) };
  },

  async bootstrap(force: boolean) {
    const problem = configProblem();
    if (problem) {
      this.setData({ merchantView: blockedState("小程序尚未配置", `${problem}。请在 src/config/public.ts 配置商户编码与 API 地址后重新打包；本页不会显示演示数据。`, "", "none"), view: readyState() });
      return;
    }
    const cached = cachedMerchant();
    if (cached && !force) this.applyMerchant(cached);
    try {
      const info = await loadMerchant(force);
      this.applyMerchant(info);
    } catch (error) {
      if (!cached) this.setData({ merchantView: errorState(error, "联系商户") });
    }
  },

  applyMerchant(info: MerchantInfo) {
    if (this.requestedServiceCode) {
      const requested = findService(info, this.requestedServiceCode);
      this.requestedServiceCode = "";
      if (requested && requested.status !== "paused" && resolveServiceCode(info) !== requested.code) {
        switchService(requested.code, requested.name)
          .then((switched) => {
            if (switched) {
              this.serviceCode = "";
              this.applyMerchant(cachedMerchant() ?? info);
            }
          })
          .catch(() => undefined);
      }
    }
    const resolved = resolveServiceCode(info);
    const service = findService(info, resolved);
    const services = info.services.map((row) => ({ code: row.code, name: row.name, icon: categoryIcon(row.categoryCode), active: row.code === resolved, paused: row.status === "paused" }));
    this.setData({
      servicePhone: info.servicePhone ?? "",
      services,
      serviceName: service?.name ?? "",
      merchantView: services.length ? readyState() : blockedState("商户暂未开放服务", "当前没有可租用的服务，请稍后再来或联系商户。", info.servicePhone ? "联系商户" : "", "contact")
    });
    if (!resolved) {
      this.setData({ view: readyState(), cards: [] });
      return;
    }
    if (resolved !== this.serviceCode) {
      this.serviceCode = resolved;
      void this.loadItems(false);
    }
  },

  async loadItems(force: boolean) {
    const serviceCode = this.serviceCode;
    if (!serviceCode) return;
    const version = contextVersion();
    const token = ++this.loadVersion;
    const cached = cachedCatalog(serviceCode);
    if (!cached) this.setData({ view: loadingState() });
    try {
      const catalog = await loadCatalog(serviceCode, force);
      if (token !== this.loadVersion || version !== contextVersion()) return;
      const items = searchItems(catalog.items, "", "").slice(0, HOT_LIMIT);
      const cards = items.map(toItemCard);
      const store = primaryLocation(catalog);
      this.setData({
        cards,
        store: store ? { id: store.id, name: store.name, address: store.address ?? "", hours: store.businessHours ?? "", phone: store.contactPhone ?? "" } : undefined,
        view: cards.length ? readyState() : emptyState("当前服务暂无设备", "商户还没有在此服务上架设备。", "", "", "none")
      });
      hydrateImages(cards, (index, path) => {
        if (version !== contextVersion() || this.data.cards[index]?.id !== cards[index].id) return;
        this.setData({ [`cards[${index}].imagePath`]: path });
      });
    } catch (error) {
      if (token !== this.loadVersion || version !== contextVersion() || isApiError(error, "STALE_CONTEXT")) return;
      if (!isSignedIn() && isApiError(error) && (error.code === "UNAVAILABLE" || error.code === "AUTH_REQUIRED")) {
        this.setData({ view: emptyState("登录后查看设备", "商户尚未开放游客浏览，登录后即可查看设备与价格。", "去登录", "", "login"), cards: [] });
        return;
      }
      this.setData({ view: errorState(error), cards: [] });
    }
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    this.setData({ query: String(event.detail.value ?? "").slice(0, 50) });
  },

  onSearchConfirm() {
    setPendingSearch(this.data.query);
    this.setData({ query: "" });
    wx.switchTab({ url: ROUTES.catalog });
  },

  onBannerTap() {
    wx.switchTab({ url: ROUTES.catalog });
  },

  async onServiceTap(event: WechatMiniprogram.TouchEvent) {
    const code = String(event.currentTarget.dataset.code ?? "");
    const target = this.data.services.find((row) => row.code === code);
    if (!target) return;
    if (target.paused) {
      wx.showToast({ title: "该服务暂停新租，历史订单可在“订单”查看", icon: "none" });
      return;
    }
    try {
      const switched = code === this.serviceCode ? true : await switchService(code, target.name);
      if (!switched) return;
      this.serviceCode = "";
      this.applyMerchant(cachedMerchant()!);
      wx.switchTab({ url: ROUTES.catalog });
    } catch (error) {
      this.setData({ view: errorState(error) });
    }
  },

  onMore() {
    wx.switchTab({ url: ROUTES.catalog });
  },

  onItemTap(event: WechatMiniprogram.TouchEvent) {
    navigate(buildUrl(ROUTES.item, { id: String(event.currentTarget.dataset.id ?? ""), service: this.serviceCode }));
  },

  onStoreTap() {
    navigate(buildUrl(ROUTES.locations, { service: this.serviceCode }));
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.home, servicePhone: this.data.servicePhone })) return;
    if (this.data.view.next === "retry" || this.data.view.next === "refresh") void this.loadItems(true);
  },

  onMerchantAction() {
    if (this.data.merchantView.next === "contact") callPhone(this.data.servicePhone);
    else void this.bootstrap(true);
  },

  onMerchantSecondary() {
    callPhone(this.data.servicePhone);
  }
});
