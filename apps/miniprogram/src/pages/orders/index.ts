import { themeBehavior } from "../../core/theme-behavior";
import type { MyOrderIndex } from "@rental-os/shared";
import { fetchMyOrders, fetchOrder } from "../../api/orders";
import { CartLocked, addLine, clearCart, getCart } from "../../core/cart";
import { cachedCatalog, loadCatalog } from "../../core/catalogStore";
import { serverNow } from "../../core/clock";
import { describeError } from "../../core/errors";
import { ensureServiceForOrder } from "../../core/flow";
import { isApiError } from "../../core/http";
import { resolveImage } from "../../core/images";
import { categoryIcon } from "../../core/labels";
import { emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { ORDER_FILTERS, matchesFilter, presentOrder, type OrderFilterKey, type OrderPresentation } from "../../core/status";
import { currentServiceCode, isSignedIn, sessionEvents } from "../../core/session";
import { formatBusinessDateTime } from "../../core/time";
import { ROUTES, buildUrl, confirmDialog, navigate, toast } from "../../core/ui";
import { ensureCurrentZone, zoneOf } from "../../core/zones";

/**
 * P07 我的订单（V2 设计稿）：Tab 全部/待支付/待取货/租赁中/已完成；卡片含缩略图、名称、状态、单号、租期、金额、
 * “查看详情 / 再次下单”。索引只含本人订单，不跨币种合计。
 * 缩略图只在订单属于当前服务时从目录缓存解析（图片接口按当前空间鉴权），其他服务显示品类图标。
 */
interface OrderRow {
  orderId: string;
  orderNo: string;
  serviceCode: string;
  serviceName: string;
  icon: string;
  itemName: string;
  itemExtra: string;
  firstItemGroupId: string;
  imagePath: string;
  period: string;
  amount: number;
  currency: string;
  presentation: OrderPresentation;
  canReorder: boolean;
}

interface OrdersData {
  view: ViewState;
  filters: typeof ORDER_FILTERS;
  filter: OrderFilterKey;
  rows: OrderRow[];
  visible: OrderRow[];
  page: number;
  hasMore: boolean;
  loadingMore: boolean;
  signedIn: boolean;
}

const PAGE_SIZE = 20;

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState(), filters: ORDER_FILTERS, filter: "all", rows: [], visible: [], page: 0, hasMore: false, loadingMore: false, signedIn: false } as OrdersData,
  unsubscribe: undefined as (() => void) | undefined,
  loadVersion: 0,
  busy: false,

  onLoad(options: Record<string, string | undefined>) {
    const filter = String(options.filter ?? "all") as OrderFilterKey;
    if (ORDER_FILTERS.some((row) => row.key === filter)) this.setData({ filter });
    this.unsubscribe = sessionEvents.on((event) => {
      if (event.type === "signed-in" || event.type === "signed-out") {
        this.setData({ rows: [], visible: [], page: 0 });
        void this.load(true);
      }
    });
  },

  onUnload() {
    this.unsubscribe?.();
  },

  onShow() {
    this.setData({ signedIn: isSignedIn() });
    void this.load(true);
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) void this.loadMore();
  },

  async load(reset: boolean) {
    if (!isSignedIn()) {
      this.setData({ view: emptyState("登录后查看订单", "你在本商户所有服务的订单都会显示在这里。", "去登录", "", "login"), rows: [], visible: [] });
      return;
    }
    const token = ++this.loadVersion;
    if (reset && !this.data.rows.length) this.setData({ view: loadingState() });
    try {
      const [response] = await Promise.all([fetchMyOrders(1, PAGE_SIZE), ensureCurrentZone()]);
      if (token !== this.loadVersion) return;
      const rows = response.items.map((item) => this.toRow(item));
      this.setData({ rows, page: 1, hasMore: response.total > rows.length });
      this.applyFilter();
      this.hydrate(rows);
    } catch (error) {
      if (token !== this.loadVersion || isApiError(error, "STALE_CONTEXT")) return;
      if (!this.data.rows.length) this.setData({ view: errorState(error) });
      else toast("刷新失败，已保留之前加载的订单");
    }
  },

  async loadMore() {
    this.setData({ loadingMore: true });
    const token = this.loadVersion;
    try {
      const next = this.data.page + 1;
      const response = await fetchMyOrders(next, PAGE_SIZE);
      if (token !== this.loadVersion) return;
      const existing = new Set(this.data.rows.map((row) => row.orderId));
      const added = response.items.filter((item) => !existing.has(item.orderId)).map((item) => this.toRow(item));
      const rows = [...this.data.rows, ...added];
      this.setData({ rows, page: next, hasMore: response.total > rows.length });
      this.applyFilter();
      this.hydrate(added);
    } catch {
      toast("加载更多失败，请稍后再试");
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  toRow(item: MyOrderIndex): OrderRow {
    const zone = zoneOf(item.workspaceCode) ?? zoneOf(currentServiceCode()) ?? "Asia/Shanghai";
    const presentation = presentOrder({ status: item.status, startAt: item.startAt, endAt: item.endAt, effectiveEndAt: item.effectiveEndAt, currency: item.currency, now: serverNow() });
    const summary = item.itemSummary;
    const previous = this.data.rows.find((row) => row.orderId === item.orderId);
    return {
      orderId: item.orderId,
      orderNo: item.orderNo,
      serviceCode: item.workspaceCode,
      serviceName: item.workspaceName,
      icon: categoryIcon(item.categoryCode),
      itemName: summary?.firstItemName ?? item.workspaceName,
      itemExtra: summary ? (summary.itemCount > 1 ? `等 ${summary.itemCount} 种 · 共 ${summary.totalQuantity} 件` : summary.totalQuantity > 1 ? `共 ${summary.totalQuantity} 件` : "") : "",
      firstItemGroupId: summary?.firstItemGroupId ?? "",
      imagePath: previous?.imagePath ?? "",
      period: `${formatBusinessDateTime(item.startAt, zone)} - ${formatBusinessDateTime(item.effectiveEndAt ?? item.endAt, zone)}`,
      amount: item.finalPayableAmount,
      currency: item.currency,
      presentation,
      canReorder: Boolean(summary)
    };
  },

  /** 缩略图：仅当前服务的订单能读目录图片；其他服务保留品类图标。 */
  hydrate(rows: OrderRow[]) {
    const serviceCode = currentServiceCode();
    const catalog = cachedCatalog(serviceCode);
    const resolveFromCatalog = (catalogToUse: NonNullable<typeof catalog>) => {
      for (const row of rows) {
        if (row.serviceCode !== serviceCode || row.imagePath || !row.firstItemGroupId) continue;
        const image = catalogToUse.items.find((item) => item.id === row.firstItemGroupId)?.images?.[0]?.url;
        if (!image) continue;
        resolveImage(image).then((path) => {
          const index = this.data.rows.findIndex((current) => current.orderId === row.orderId);
          if (!path || index < 0) return;
          this.setData({ [`rows[${index}].imagePath`]: path });
          this.applyFilter();
        });
      }
    };
    if (catalog) resolveFromCatalog(catalog);
    else if (serviceCode) loadCatalog(serviceCode, false).then(resolveFromCatalog).catch(() => undefined);
  },

  applyFilter() {
    const visible = this.data.rows.filter((row) => matchesFilter(row.presentation, this.data.filter));
    this.setData({
      visible,
      view: visible.length ? readyState() : this.data.rows.length ? emptyState("该分类下没有订单", "", "查看全部", "", "none") : emptyState("还没有订单", "去挑选要租的设备吧。", "去租设备", "", "none")
    });
  },

  onFilterTap(event: WechatMiniprogram.TouchEvent) {
    const filter = String(event.currentTarget.dataset.key ?? "all") as OrderFilterKey;
    this.setData({ filter });
    this.applyFilter();
  },

  async onOpen(event: WechatMiniprogram.TouchEvent) {
    if (this.busy) return;
    const id = String(event.currentTarget.dataset.id ?? "");
    const row = this.data.rows.find((item) => item.orderId === id);
    if (!row) return;
    this.busy = true;
    try {
      const ok = await ensureServiceForOrder(row.serviceCode, row.serviceName);
      if (!ok) return;
      navigate(buildUrl(ROUTES.order, { id, service: row.serviceCode }));
    } catch (error) {
      toast(isApiError(error) ? error.message : "无法打开该订单，请稍后重试或联系商户", { duration: 3000 });
    } finally {
      this.busy = false;
    }
  },

  /** 再次下单：只复制商品与数量的选择意图，价格、优惠券与租期由本次报价重新决定。 */
  async onReorder(event: WechatMiniprogram.TouchEvent) {
    if (this.busy) return;
    const id = String(event.currentTarget.dataset.id ?? "");
    const row = this.data.rows.find((item) => item.orderId === id);
    if (!row) return;
    this.busy = true;
    try {
      const ok = await ensureServiceForOrder(row.serviceCode, row.serviceName);
      if (!ok) return;
      const [order, catalog] = await Promise.all([fetchOrder(id), loadCatalog(row.serviceCode, false)]);
      const existing = getCart();
      if (existing && existing.lines.length > 0) {
        const replace = await confirmDialog({ title: "再次下单", content: "本次租赁清单里已有设备，是否清空后按该订单重新选择？", confirmText: "清空并重选", cancelText: "取消", danger: true });
        if (!replace) return;
        clearCart();
      }
      let added = 0;
      const skipped: string[] = [];
      for (const line of order.lines) {
        const item = catalog.items.find((candidate) => candidate.id === line.itemGroupId);
        const option = line.pricingGroupId ? catalog.pricingGroups.find((group) => group.id === line.pricingGroupId && group.enabled) : undefined;
        if (!item || (line.pricingGroupId && !option)) {
          skipped.push(line.itemGroupName);
          continue;
        }
        addLine(row.serviceCode, row.serviceName, { itemGroupId: item.id, itemName: item.name, pricingGroupId: option?.id, pricingGroupName: option?.name, inventoryMode: item.inventoryMode, imageSource: item.images?.[0]?.url ?? "" }, line.quantity);
        added += 1;
      }
      if (!added) {
        toast("该订单中的设备已下架，无法再次下单", { duration: 3000 });
        return;
      }
      if (skipped.length) toast(`${skipped.join("、")} 已下架，未加入`, { duration: 3000 });
      navigate(ROUTES.checkout);
    } catch (error) {
      toast(error instanceof CartLocked ? error.message : describeError(error).message, { duration: 3000 });
    } finally {
      this.busy = false;
    }
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.orders })) return;
    if (this.data.view.actionText === "查看全部") {
      this.setData({ filter: "all" });
      this.applyFilter();
    } else if (this.data.view.actionText === "去租设备") wx.switchTab({ url: ROUTES.home });
    else void this.load(true);
  }
});
