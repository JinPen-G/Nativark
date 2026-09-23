import type { RentalOrder } from "@rental-os/shared";
import { listItemGroups } from "../../api/context";
import { listOrders } from "../../api/orders";
import { cachedContext, contextEvents, currentLocationLabel, inCurrentLocation, loadContext, setCurrentLocation, type WorkspaceContext } from "../../core/context";
import { resolveImage } from "../../core/images";
import { ORDER_TABS, orderTabMatches, type OrderTabKey } from "../../core/labels";
import { emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { indexItemGroups, orderCardOf, type OrderCard } from "../../core/presenters";
import { can, contextVersion, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, navigate, relaunch } from "../../core/ui";

/**
 * 订单列表（Tab）：页签（全部/待取货/使用中/待归还/已完成）+ 关键字搜索 + 当前地点范围。
 * 列表由服务端整空间返回，页签与地点在本机过滤；关键字走服务端搜索（订单号/客户名/型号）。
 */
interface OrdersData {
  view: ViewState;
  tabs: typeof ORDER_TABS;
  tab: OrderTabKey;
  keyword: string;
  cards: OrderCard[];
  total: number;
  canCreate: boolean;
  locationLabel: string;
  context?: WorkspaceContext;
  showLocationSheet: boolean;
  todoFilter: string;
}

const DEFAULT_ZONE = "Asia/Shanghai";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState(), tabs: ORDER_TABS, tab: "all", keyword: "", cards: [], total: 0, canCreate: false, locationLabel: "", showLocationSheet: false, todoFilter: "" } as OrdersData,
  all: [] as RentalOrder[],
  offContext: undefined as (() => void) | undefined,
  searchTimer: undefined as number | undefined,
  requestVersion: 0,

  onLoad(query: Record<string, string>) {
    const tab = ORDER_TABS.some((row) => row.key === query.tab) ? (query.tab as OrderTabKey) : "all";
    this.setData({ tab, todoFilter: query.todo ?? "" });
    this.offContext = contextEvents.on(() => this.setData({ context: cachedContext(), locationLabel: currentLocationLabel() }));
  },

  onUnload() {
    this.offContext?.();
  },

  onShow() {
    if (!isSignedIn()) {
      relaunch(ROUTES.login);
      return;
    }
    void this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    const token = ++this.requestVersion;
    const version = contextVersion();
    if (!this.all.length) this.setData({ view: loadingState() });
    try {
      const context = await loadContext();
      this.setData({ context, locationLabel: currentLocationLabel(), canCreate: can("rental-os:order:create") });
      const [orders, groups] = await Promise.all([listOrders({ keyword: this.data.keyword.trim() || undefined }), listItemGroups().catch(() => [])]);
      if (token !== this.requestVersion || version !== contextVersion()) return;
      this.all = orders;
      this.groups = indexItemGroups(groups);
      this.applyFilter();
    } catch (error) {
      if (token !== this.requestVersion) return;
      this.setData({ view: errorState(error) });
    }
  },

  groups: new Map(),

  applyFilter() {
    const now = Date.now();
    const timeZone = this.data.context?.locations[0]?.timezone ?? DEFAULT_ZONE;
    const filtered = this.all
      .filter((order) => inCurrentLocation(order.fulfillmentLocationId, order.returnLocationId))
      .filter((order) => orderTabMatches(this.data.tab, order, now))
      .filter((order) => this.matchesTodo(order))
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    const cards = filtered.map((order) => {
      const previous = this.data.cards.find((row) => row.id === order.id);
      const card = orderCardOf(order, timeZone, this.groups as Map<string, never>);
      return { ...card, imagePath: previous?.imagePath ?? "" };
    });
    const t = this.data.context?.terminology;
    this.setData({
      cards,
      total: cards.length,
      view: cards.length ? readyState() : emptyState("没有符合条件的订单", this.data.keyword ? "换个关键字试试" : `当前${t?.fulfillmentLabel ?? "门店"}范围内暂无此类订单`)
    });
    const version = contextVersion();
    cards.forEach((card, index) => {
      if (!card.imageSource || card.imagePath) return;
      resolveImage(card.imageSource).then((path) => {
        if (path && contextVersion() === version && this.data.cards[index]?.id === card.id) this.setData({ [`cards[${index}].imagePath`]: path });
      });
    });
  },

  /** 工作台待办类型跳转过来时的附加筛选（费用复核 / 退款 / 通知失败）。 */
  matchesTodo(order: RentalOrder): boolean {
    switch (this.data.todoFilter) {
      case "fee_review":
        return (order.feeReviews ?? []).some((row) => (row as { status?: string }).status === "pending");
      default:
        return true;
    }
  },

  onTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.key ?? "all") as OrderTabKey;
    if (tab === this.data.tab) return;
    this.setData({ tab, todoFilter: "" });
    this.applyFilter();
  },

  onKeyword(event: WechatMiniprogram.Input) {
    const keyword = String(event.detail.value ?? "");
    this.setData({ keyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(), 400) as unknown as number;
  },

  onSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    void this.load();
  },

  onClearKeyword() {
    this.setData({ keyword: "" });
    void this.load();
  },

  onOpenLocation() {
    if (!this.data.context?.locations.length) return;
    this.setData({ showLocationSheet: true });
  },

  onCloseLocation() {
    this.setData({ showLocationSheet: false });
  },

  onPickLocation(event: WechatMiniprogram.TouchEvent) {
    setCurrentLocation(String(event.currentTarget.dataset.id ?? ""));
    this.setData({ showLocationSheet: false, locationLabel: currentLocationLabel() });
    this.applyFilter();
  },

  onOrder(event: WechatMiniprogram.TouchEvent) {
    navigate(buildUrl(ROUTES.order, { id: String(event.currentTarget.dataset.id ?? "") }));
  },

  onCreate() { if (this.data.canCreate) navigate(ROUTES.orderNew); },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.orders })) return;
    void this.load();
  }
});
