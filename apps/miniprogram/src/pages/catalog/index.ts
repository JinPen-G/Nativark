import { themeBehavior } from "../../core/theme-behavior";
import { cachedCatalog, facetsOf, loadCatalog, searchItems, takePendingSearch, toItemCard, type ItemCard } from "../../core/catalogStore";
import { switchService } from "../../core/flow";
import { isApiError } from "../../core/http";
import { cachedMerchant, loadMerchant, resolveServiceCode, type MerchantInfo } from "../../core/merchant";
import { emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { contextVersion, isSignedIn, sessionEvents } from "../../core/session";
import { ROUTES, buildUrl, navigate, toast } from "../../core/ui";

/**
 * P02 分类（Tab）：搜索 → 服务标签页（商户已发布的服务）→ 品牌/分类芯片 → 商品列表行。
 * 服务标签页切换 = 切换服务（有未提交清单时先确认）；列表价格来自服务端起价。
 */
interface CatalogData {
  query: string;
  services: Array<{ code: string; name: string; active: boolean; paused: boolean }>;
  facets: string[];
  activeFacet: string;
  cards: ItemCard[];
  view: ViewState;
  total: number;
}

Page({
  behaviors: [themeBehavior],
  data: { query: "", services: [], facets: [], activeFacet: "", cards: [], view: loadingState(), total: 0 } as CatalogData,
  serviceCode: "" as string,
  loadVersion: 0,
  unsubscribe: undefined as (() => void) | undefined,

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ query: (options.q ?? "").slice(0, 50), activeFacet: options.facet ?? "" });
    this.unsubscribe = sessionEvents.on((event) => {
      if (event.type === "refreshed") return;
      this.serviceCode = "";
      void this.load(false);
    });
  },

  onUnload() {
    this.unsubscribe?.();
  },

  onShow() {
    const pending = takePendingSearch();
    if (pending) this.setData({ query: pending });
    void this.load(false);
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh());
  },

  applyMerchant(info: MerchantInfo) {
    const resolved = resolveServiceCode(info);
    this.setData({ services: info.services.map((row) => ({ code: row.code, name: row.name, active: row.code === resolved, paused: row.status === "paused" })) });
    return resolved;
  },

  async load(force: boolean) {
    let info = cachedMerchant();
    if (!info || force) {
      try {
        info = await loadMerchant(force);
      } catch (error) {
        if (!info) {
          this.setData({ view: errorState(error) });
          return;
        }
      }
    }
    const resolved = this.applyMerchant(info);
    if (!resolved) {
      this.setData({ view: emptyState("商户暂未开放服务", "当前没有可租用的服务。", "", "", "none"), cards: [] });
      return;
    }
    this.serviceCode = resolved;
    const version = contextVersion();
    const token = ++this.loadVersion;
    if (!cachedCatalog(resolved)) this.setData({ view: loadingState() });
    try {
      const catalog = await loadCatalog(resolved, force);
      if (token !== this.loadVersion || version !== contextVersion()) return;
      const facets = facetsOf(catalog.items);
      this.setData({ facets, total: catalog.items.length, activeFacet: facets.includes(this.data.activeFacet) ? this.data.activeFacet : "" });
      this.render();
    } catch (error) {
      if (token !== this.loadVersion || version !== contextVersion() || isApiError(error, "STALE_CONTEXT")) return;
      if (!isSignedIn() && isApiError(error) && (error.code === "UNAVAILABLE" || error.code === "AUTH_REQUIRED")) {
        this.setData({ view: emptyState("登录后查看设备", "商户尚未开放游客浏览。", "去登录", "", "login"), cards: [] });
        return;
      }
      this.setData({ view: errorState(error), cards: [] });
    }
  },

  render() {
    const catalog = cachedCatalog(this.serviceCode);
    if (!catalog) return;
    const items = searchItems(catalog.items, this.data.query, this.data.activeFacet);
    const cards = items.map((item) => toItemCard(item, catalog));
    this.setData({
      cards,
      view: cards.length ? readyState() : catalog.items.length ? emptyState("没有匹配的设备", "换个关键词或分类试试。", "清除筛选", "", "none") : emptyState("当前服务暂无设备", "商户还没有上架设备。", "", "", "none")
    });
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    this.setData({ query: String(event.detail.value ?? "").slice(0, 50) });
    this.render();
  },

  onClear() {
    this.setData({ query: "", activeFacet: "" });
    this.render();
  },

  async onServiceTap(event: WechatMiniprogram.TouchEvent) {
    const code = String(event.currentTarget.dataset.code ?? "");
    const target = this.data.services.find((row) => row.code === code);
    if (!target || code === this.serviceCode) return;
    if (target.paused) {
      toast("该服务暂停新租，历史订单可在“订单”查看", { duration: 3000 });
      return;
    }
    try {
      const switched = await switchService(code, target.name);
      if (!switched) return;
      this.setData({ activeFacet: "" });
      this.serviceCode = "";
      await this.load(false);
    } catch (error) {
      toast(isApiError(error) ? error.message : "切换服务失败", { duration: 3000 });
    }
  },

  onFacetTap(event: WechatMiniprogram.TouchEvent) {
    const facet = String(event.currentTarget.dataset.facet ?? "");
    this.setData({ activeFacet: this.data.activeFacet === facet ? "" : facet });
    this.render();
  },

  onItemTap(event: WechatMiniprogram.TouchEvent) {
    navigate(buildUrl(ROUTES.item, { id: String(event.currentTarget.dataset.id ?? ""), service: this.serviceCode }));
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.catalog })) return;
    if (this.data.view.actionText === "清除筛选") this.onClear();
    else void this.load(true);
  }
});
