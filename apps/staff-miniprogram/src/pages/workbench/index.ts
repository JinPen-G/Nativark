import type { RentalOrder, RentalWorkbenchTodo } from "@rental-os/shared";
import { listItemGroups } from "../../api/context";
import { listOrders } from "../../api/orders";
import { listMembershipReviews } from "../../api/reviews";
import { workbenchTodos } from "../../api/workbench";
import { listStockDispositions, listWorkOrders } from "../../api/workOrders";
import { cachedContext, categoryArtwork, categoryIcon, contextEvents, currentLocationLabel, inCurrentLocation, loadContext, setCurrentLocation, type WorkspaceContext } from "../../core/context";
import { orderTabMatches, todoTypeIcon, todoTypeLabel } from "../../core/labels";
import { errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, canTenant, currentSession, isSignedIn, sessionEvents } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, navigate, relaunch, toast } from "../../core/ui";
import { describeError } from "../../core/errors";

/**
 * S03 工作台：英雄卡（当前空间/品类）→ 四个快捷入口 → 今日待办计数 → 待处理事项 → 常用功能。
 * 所有名词经 terms() 取（器材/装备/车辆…），入口按权限显示，计数按当前地点范围过滤。
 */
interface QuickAction {
  key: string;
  label: string;
  icon: string;
  color: string;
  hint?: string;
}

interface TodoRow {
  type: string;
  label: string;
  icon: string;
  color: string;
  count: number;
  /** 是否展示计数徽标；派生类型计数取失败时只给入口（chevron），不写假数字。 */
  showCount: boolean;
  orderId?: string;
}

/**
 * 待处理事项的展示优先级：服务端 todos 与客户端派生类型统一排序（越靠前越紧急）。
 * 派生类型（pending_confirm / review_task / pending_disposition）穿插在语义相邻的服务端类型之间。
 */
const TODO_ORDER = [
  "return_overdue",
  "no_show_confirmation",
  "no_show_notice",
  "pending_confirm",
  "offline_payment_pending",
  "fee_review",
  "review_task",
  "work_order",
  "pending_disposition",
  "pending_payment",
  "cancelled_refund_due",
  "refund",
  "notification_failure"
];

interface WorkbenchData {
  view: ViewState;
  context?: WorkspaceContext;
  heroTitle: string;
  heroLine: string;
  heroSubtitle: string;
  heroIcon: string;
  heroImage: string;
  locationLabel: string;
  quick: QuickAction[];
  common: QuickAction[];
  counts: { pickup: number; return: number; workOrders: number; total: number };
  todos: TodoRow[];
  showLocationSheet: boolean;
  refreshing: boolean;
}

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    heroTitle: "",
    heroLine: "",
    heroSubtitle: "",
    heroIcon: "box",
    heroImage: "",
    locationLabel: "",
    quick: [],
    common: [],
    counts: { pickup: 0, return: 0, workOrders: 0, total: 0 },
    todos: [],
    showLocationSheet: false,
    refreshing: false
  } as WorkbenchData,
  offContext: undefined as (() => void) | undefined,
  offSession: undefined as (() => void) | undefined,

  onLoad() {
    this.offContext = contextEvents.on(() => this.applyContext());
    this.offSession = sessionEvents.on((event) => {
      if (event.type === "signed-out") relaunch(ROUTES.login);
    });
  },

  onUnload() {
    this.offContext?.();
    this.offSession?.();
  },

  onShow() {
    if (!isSignedIn()) {
      relaunch(ROUTES.login);
      return;
    }
    void this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  /** 从上下文派生：英雄卡文案、快捷入口（按权限）。 */
  applyContext() {
    const context = cachedContext();
    const session = currentSession();
    if (!context || !session) return;
    const t = context.terminology;
    const quick: QuickAction[] = [{ key: "scan", label: "扫码登记", icon: "scan", color: "" }];
    if (can("rental-core:asset:manage")) quick.push({ key: "assetNew", label: `新建${t.assetLabel}`, icon: "plus-circle", color: "green" });
    if (can("rental-core:asset:view", "rental-core:asset:manage")) quick.push({ key: "assets", label: `${t.collectionLabel}查询`, icon: "layers", color: "orange" });
    if (can("rental-core:maintenance:view")) quick.push({ key: "workOrders", label: "工单处理", icon: "tool", color: "purple" });
    const common: QuickAction[] = [];
    if (canTenant("rental-os:member:view")) common.push({ key: "customers", label: "客户查询", icon: "user-search", color: "" });
    if (canTenant("rental-os:member:review", "rental-os:member:qualification-review")) common.push({ key: "reviews", label: "审核待办", icon: "shield", color: "purple" });
    if (can("rental-core:asset:view", "rental-core:asset:manage")) common.push({ key: "assets", label: `${t.assetLabel}管理`, icon: "box", color: "green" });
    if (can("rental-os:order:pickup", "rental-os:order:return")) common.push({ key: "ledger", label: `${t.pickupLabel}/${t.returnLabel}登记`, icon: "swap", color: "orange" });
    common.push({ key: "more", label: "更多功能", icon: "grid", color: "purple" });
    this.setData({
      context,
      // 英雄卡文案按品类术语组合，不写死某个品类（"专业设备"等摄影文案会在露营/车辆品类显错）。
      heroTitle: `${context.categoryName || t.itemLabel}履约`,
      heroLine: `${t.pickupLabel} · ${t.returnLabel} · 现场处理一步到位`,
      heroSubtitle: `${session.tenant.tenantName} · 高效管理每一次租赁`,
      heroIcon: categoryIcon(context.categoryCode),
      heroImage: categoryArtwork(context.categoryCode),
      locationLabel: currentLocationLabel(),
      quick,
      common
    });
  },

  async refresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    try {
      await loadContext();
      this.applyContext();
      const [orders, workOrders, todos, dispositions, reviewCount] = await Promise.all([
        can("rental-os:order:view") ? listOrders() : Promise.resolve([]),
        can("rental-core:maintenance:view") ? listWorkOrders() : Promise.resolve([]),
        can("rental-os:order:view", "rental-os:report:view", "rental-core:maintenance:view") ? workbenchTodos().catch(() => undefined) : Promise.resolve(undefined),
        // 归还处置计数：有养护查看权限时拉取，失败不影响工作台其它计数。
        can("rental-core:maintenance:view") ? listStockDispositions().catch(() => undefined) : Promise.resolve(undefined),
        // 审核待办计数（租户级）：仅有审核权限时拉取，失败则该行只给入口不写计数。
        canTenant("rental-os:member:review", "rental-os:member:qualification-review")
          ? listMembershipReviews({ status: "pending" }).then((rows) => rows.length).catch(() => undefined)
          : Promise.resolve(undefined)
      ]);
      // 型号目录预热（订单卡片缩略图用），失败不影响工作台。
      void listItemGroups().catch(() => undefined);
      const now = Date.now();
      const scoped = orders.filter((order) => inCurrentLocation(order.fulfillmentLocationId, order.returnLocationId));
      const pickup = scoped.filter((order) => orderTabMatches("pending_pickup", order, now)).length;
      const returned = scoped.filter((order) => orderTabMatches("pending_return", order, now)).length;
      const openWorkOrders = workOrders.filter((row) => inCurrentLocation(row.locationId) && (row.status === "pending" || row.status === "in_progress" || row.status === "pending_review")).length;
      // 归还入库后待清洁/待维修/待复核（未恢复可租）的资源即待处置；undefined 表示未取到计数。
      const dispositionCount = dispositions === undefined ? undefined : dispositions.filter((row) => inCurrentLocation(row.locationId) && row.status !== "restored").length;
      this.setData({
        view: readyState(),
        counts: { pickup, return: returned, workOrders: openWorkOrders, total: pickup + returned + openWorkOrders },
        todos: this.groupTodos(todos?.items ?? [], this.buildDerivedTodos(scoped, reviewCount, dispositionCount))
      });
    } catch (error) {
      this.setData({ view: errorState(error) });
    } finally {
      this.setData({ refreshing: false });
    }
  },

  groupTodos(items: RentalWorkbenchTodo[], derived: TodoRow[]): TodoRow[] {
    const counts = new Map<string, number>();
    const firstOrderId = new Map<string, string>();
    for (const item of items) {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
      if (item.orderId && !firstOrderId.has(item.type)) firstOrderId.set(item.type, item.orderId);
    }
    const serverRows: TodoRow[] = Array.from(counts.entries()).map(([type, count]) => ({ type, label: todoTypeLabel(type), ...todoTypeIcon(type), count, showCount: true, orderId: firstOrderId.get(type) }));
    const rank = (type: string) => (TODO_ORDER.indexOf(type) === -1 ? 99 : TODO_ORDER.indexOf(type));
    return [...serverRows, ...derived].sort((a, b) => rank(a.type) - rank(b.type));
  },

  /**
   * 客户端派生的待处理事项：服务端 workbenchTodos() 未直接给出、但能从已有数据可靠推导的类型。
   * 全部按权限/地点范围过滤；计数取不到时只给入口（showCount=false），绝不写假数字。
   * - pending_confirm：草稿态订单待商户确认（服务端仅在软占用超时后才给 pending_payment，不含普通待确认）。
   * - review_task：会员/证件审核（租户级）；计数取失败时只显示入口，点了跳审核页。
   * - pending_disposition：归还入库后待处置的资源；点了跳工单页的归还处置页签。
   */
  buildDerivedTodos(scopedOrders: RentalOrder[], reviewCount: number | undefined, dispositionCount: number | undefined): TodoRow[] {
    const rows: TodoRow[] = [];
    const pendingConfirm = scopedOrders.filter((order) => order.status === "draft").length;
    if (pendingConfirm > 0) rows.push({ type: "pending_confirm", label: "待确认订单", icon: "check-circle", color: "warning", count: pendingConfirm, showCount: true });
    if (canTenant("rental-os:member:review", "rental-os:member:qualification-review")) {
      if (reviewCount === undefined) rows.push({ type: "review_task", label: "审核待办", icon: "shield", color: "purple", count: 0, showCount: false });
      else if (reviewCount > 0) rows.push({ type: "review_task", label: "审核待办", icon: "shield", color: "purple", count: reviewCount, showCount: true });
    }
    if (can("rental-core:maintenance:view")) {
      if (dispositionCount === undefined) rows.push({ type: "pending_disposition", label: "待处置", icon: "box-in", color: "info", count: 0, showCount: false });
      else if (dispositionCount > 0) rows.push({ type: "pending_disposition", label: "待处置", icon: "box-in", color: "info", count: dispositionCount, showCount: true });
    }
    return rows;
  },

  /* ---------- 地点切换 ---------- */
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
    void this.refresh();
  },

  /* ---------- 入口 ---------- */
  onQuick(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? "");
    switch (key) {
      case "scan":
        wx.switchTab({ url: ROUTES.scan });
        return;
      case "assetNew":
        navigate(ROUTES.assetNew);
        return;
      case "assets":
        navigate(ROUTES.assets);
        return;
      case "workOrders":
        navigate(ROUTES.workOrders);
        return;
      case "customers":
        navigate(ROUTES.customers);
        return;
      case "reviews":
        navigate(ROUTES.reviews);
        return;
      case "ledger":
        navigate(ROUTES.assetLedger);
        return;
      case "more":
        wx.switchTab({ url: ROUTES.me });
        return;
      default:
        return;
    }
  },

  onTile(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? "");
    if (key === "workOrders") navigate(ROUTES.workOrders);
    else navigate(buildUrl(ROUTES.orders, { tab: key === "pickup" ? "pending_pickup" : "pending_return" }));
  },

  onAllTodos() {
    navigate(buildUrl(ROUTES.orders, { tab: "pending_pickup" }));
  },

  onTodo(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type ?? "");
    if (type === "work_order") {
      navigate(ROUTES.workOrders);
      return;
    }
    if (type === "offline_payment_pending") {
      const orderId = String(event.currentTarget.dataset.orderId ?? "");
      if (orderId) navigate(buildUrl(ROUTES.order, { id: orderId }));
      return;
    }
    if (type === "return_overdue") {
      navigate(buildUrl(ROUTES.orders, { tab: "pending_return" }));
      return;
    }
    if (type === "pending_confirm") {
      navigate(buildUrl(ROUTES.orders, { tab: "pending_pickup", todo: "pending_confirm" }));
      return;
    }
    if (type === "review_task") {
      navigate(ROUTES.reviews);
      return;
    }
    if (type === "pending_disposition") {
      navigate(buildUrl(ROUTES.workOrders, { seg: "dispositions" }));
      return;
    }
    if (type === "no_show_notice" || type === "no_show_confirmation" || type === "pending_payment") {
      navigate(buildUrl(ROUTES.orders, { tab: "pending_pickup" }));
      return;
    }
    // 费用复核、退款、通知失败：订单列表带待办筛选，详情页内按权限出现处理动作。
    navigate(buildUrl(ROUTES.orders, { tab: "all", todo: type }));
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.workbench })) return;
    void this.refresh();
  },

  onRetryHint(error: unknown) {
    toast(describeError(error).message);
  }
});
