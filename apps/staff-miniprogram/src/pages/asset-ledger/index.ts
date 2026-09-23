import type { RentalStockLedgerEntry } from "@rental-os/shared";
import { listStockLedger } from "../../api/assets";
import { currentLocation, loadContext, terms } from "../../core/context";
import { emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessDateTime } from "../../core/time";
import { ROUTES, buildUrl, relaunch } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, itemGroupId: "", assetLabel: "物品", tab: "all", rows: [] as Array<{ id: string; name: string; action: string; location: string; date: string; quantity: string; reason: string }> },
  all: [] as RentalStockLedgerEntry[],
  onLoad(query: Record<string, string>) { this.setData({ itemGroupId: query.itemGroupId ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  async load() {
    this.setData({ view: loadingState() });
    try { await loadContext(); const rows = await listStockLedger({ itemGroupId: this.data.itemGroupId || undefined, locationId: currentLocation()?.id, limit: 100 }); this.all = rows; this.setData({ assetLabel: terms().assetLabel }); this.filter(); }
    catch (error) { this.setData({ view: errorState(error) }); }
  },
  filter() {
    const timeZone = currentLocation()?.timezone ?? "Asia/Shanghai";
    const rows = this.all.filter((row) => this.data.tab === "all" || (this.data.tab === "in" ? row.quantityDelta > 0 : row.quantityDelta < 0)).map((row) => ({ id: row.id, name: row.itemGroupName, action: row.operationType, location: row.locationName, date: formatBusinessDateTime(row.createdAt, timeZone), quantity: `${row.quantityDelta > 0 ? "+" : ""}${row.quantityDelta}`, reason: row.reason }));
    this.setData({ rows, view: rows.length ? readyState() : emptyState("暂无出入库记录", "调整筛选条件或稍后再试") });
  },
  onTab(event: WechatMiniprogram.TouchEvent) { this.setData({ tab: String(event.currentTarget.dataset.tab ?? "all") }); this.filter(); },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.assetLedger, { itemGroupId: this.data.itemGroupId }) })) void this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); }
});
