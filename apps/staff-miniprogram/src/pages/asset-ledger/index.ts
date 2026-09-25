import type { RentalStockLedgerEntry, RentalWorkOrder } from "@rental-os/shared";
import { listStockLedger } from "../../api/assets";
import { listItemGroups } from "../../api/context";
import { listWorkOrders } from "../../api/workOrders";
import { currentLocation, currentLocationLabel, loadContext, terms } from "../../core/context";
import { workOrderStatusLabel, workOrderTypeLabel } from "../../core/labels";
import { emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { splitInstant } from "../../core/time";
import { ROUTES, buildUrl, relaunch } from "../../core/ui";

interface LedgerRow { id: string; name: string; action: string; tone: string; location: string; date: string; time: string; quantity: string; reason: string; operator: string; sortAt: number; }

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, itemGroupId: "", assetLabel: "物品", locationLabel: "", tab: "all", canMaintenance: false, rows: [] as LedgerRow[] },
  all: [] as RentalStockLedgerEntry[],
  workOrders: [] as RentalWorkOrder[],
  onLoad(query: Record<string, string>) { this.setData({ itemGroupId: query.itemGroupId ?? "", tab: ["all", "out", "in", "transfer", "maintenance"].includes(query.tab ?? "") ? query.tab : "all" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  async load() {
    if (!this.data.rows.length) this.setData({ view: loadingState() });
    try {
      const context = await loadContext();
      const canMaintenance = can("rental-core:maintenance:view");
      const [rows, workOrders, groups] = await Promise.all([
        listStockLedger({ itemGroupId: this.data.itemGroupId || undefined, locationId: currentLocation()?.id, limit: 100 }),
        canMaintenance ? listWorkOrders().catch(() => [] as RentalWorkOrder[]) : Promise.resolve([] as RentalWorkOrder[]),
        listItemGroups().catch(() => [])
      ]);
      this.all = rows;
      const groupNames = new Map(groups.map((row) => [row.id, row.name]));
      const locationIds = new Set(context.currentLocationId ? [context.currentLocationId] : []);
      this.workOrders = workOrders.filter((row) => (!this.data.itemGroupId || row.itemGroupId === this.data.itemGroupId) && (!locationIds.size || locationIds.has(row.locationId)));
      this.setData({ assetLabel: terms().assetLabel, canMaintenance, locationLabel: currentLocationLabel() });
      this.groupNames = groupNames;
      this.filter();
    }
    catch (error) { this.setData({ view: errorState(error) }); }
  },
  groupNames: new Map<string, string>(),
  filter() {
    const timeZone = currentLocation()?.timezone ?? "Asia/Shanghai";
    const stockRows = this.all.filter((row) => {
      if (this.data.tab === "maintenance") return false;
      if (this.data.tab === "all") return true;
      if (this.data.tab === "transfer") return row.operationType === "transfer";
      if (this.data.tab === "out") return row.quantityDelta < 0 && row.operationType !== "transfer";
      return row.quantityDelta > 0 && row.operationType !== "transfer";
    }).map((row) => {
      const { date, time } = splitInstant(row.createdAt, timeZone);
      const labels: Record<RentalStockLedgerEntry["operationType"], string> = { receive: "入库", count_adjustment: "盘点调整", transfer: "转移", consume: "领用", scrap: "报损", retire: "退役", return_transfer: "归还回库", maintenance_quarantine: "维修隔离", maintenance_release: "维修解除", maintenance_write_off: "维修核销" };
      const tone = row.operationType === "transfer" ? "warning" : row.quantityDelta > 0 ? "success" : "danger";
      return { id: row.id, name: row.itemGroupName, action: labels[row.operationType], tone, location: row.locationName, date, time, quantity: `${row.quantityDelta > 0 ? "+" : ""}${row.quantityDelta}`, reason: row.reason, operator: row.operator, sortAt: Date.parse(row.createdAt) || 0 };
    });
    const maintenanceRows: LedgerRow[] = this.data.canMaintenance && ["all", "maintenance"].includes(this.data.tab) ? this.workOrders.map((row) => {
      const location = currentLocation();
      const { date, time } = splitInstant(row.createdAt, location?.timezone ?? "Asia/Shanghai");
      return { id: `work-order-${row.id}`, name: this.groupNames.get(row.itemGroupId) ?? this.data.assetLabel, action: workOrderTypeLabel(row.type), tone: row.status === "completed" ? "success" : "warning", location: location?.name ?? this.data.locationLabel, date, time, quantity: `×${row.quantity}`, reason: `${workOrderStatusLabel(row.status)} · ${row.reason}`, operator: row.assigneeName ?? "", sortAt: Date.parse(row.createdAt) || 0 };
    }) : [];
    const rows = [...stockRows, ...maintenanceRows].sort((a, b) => b.sortAt - a.sortAt);
    const emptyTitle = this.data.tab === "maintenance" ? "暂无维护记录" : "暂无出入库记录";
    this.setData({ rows, view: rows.length ? readyState() : emptyState(emptyTitle, "调整筛选条件或稍后再试") });
  },
  onTab(event: WechatMiniprogram.TouchEvent) { const tab = String(event.currentTarget.dataset.tab ?? "all"); if (tab === "maintenance" && !this.data.canMaintenance) return; this.setData({ tab }); this.filter(); },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.assetLedger, { itemGroupId: this.data.itemGroupId, tab: this.data.tab }) })) void this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); }
});
