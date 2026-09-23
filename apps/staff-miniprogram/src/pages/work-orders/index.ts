import type { RentalWorkOrder } from "@rental-os/shared";
import { listWorkOrders } from "../../api/workOrders";
import { currentLocationLabel, inCurrentLocation, loadContext, type WorkspaceContext } from "../../core/context";
import { workOrderStatusLabel, workOrderStatusTone, workOrderTypeLabel } from "../../core/labels";
import { blockedState, emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, contextVersion, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, navigate, relaunch } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, tab: "open", locationLabel: "", rows: [] as Array<{ id: string; workNo: string; type: string; status: string; tone: string; reason: string; location: string }> },
  all: [] as RentalWorkOrder[],
  context: undefined as WorkspaceContext | undefined,
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  async load() {
    if (!can("rental-core:maintenance:view")) { this.setData({ view: blockedState("无工单查看权限", "请联系租户管理员", "联系管理员", "contact") }); return; }
    this.setData({ view: loadingState() });
    const version = contextVersion();
    try {
      this.context = await loadContext();
      const rows = await listWorkOrders();
      if (version !== contextVersion()) return;
      this.all = rows;
      this.filter();
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  filter() {
    const rows = this.all.filter((row) => inCurrentLocation(row.locationId)).filter((row) => this.data.tab === "all" || (this.data.tab === "open" ? !["completed", "cancelled"].includes(row.status) : row.status === "completed"))
      .map((row) => ({ id: row.id, workNo: row.workNo, type: workOrderTypeLabel(row.type), status: workOrderStatusLabel(row.status), tone: workOrderStatusTone(row.status), reason: row.reason, location: this.context?.locations.find((location) => location.id === row.locationId)?.name ?? "未知地点" }));
    this.setData({ rows, locationLabel: currentLocationLabel(), view: rows.length ? readyState() : emptyState("暂无对应工单", "切换页签或下拉刷新试试") });
  },
  onTab(event: WechatMiniprogram.TouchEvent) { this.setData({ tab: String(event.currentTarget.dataset.tab ?? "open") }); this.filter(); },
  onOpen(event: WechatMiniprogram.TouchEvent) { navigate(buildUrl(ROUTES.workOrder, { id: String(event.currentTarget.dataset.id ?? "") })); },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: ROUTES.workOrders })) void this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); }
});
