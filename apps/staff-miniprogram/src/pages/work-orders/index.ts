import type { RentalStockDisposition, RentalWorkOrder } from "@rental-os/shared";
import { listStockDispositions, listWorkOrders, restoreStockDisposition } from "../../api/workOrders";
import { listItemGroups } from "../../api/context";
import { listAssets } from "../../api/assets";
import { currentLocationLabel, inCurrentLocation, loadContext, terms, type WorkspaceContext } from "../../core/context";
import { describeError } from "../../core/errors";
import { workOrderStatusLabel, workOrderStatusTone, workOrderTypeLabel, type Tone } from "../../core/labels";
import { blockedState, emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, contextVersion, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessDateTime } from "../../core/time";
import { ROUTES, buildUrl, confirmDialog, navigate, relaunch, toast } from "../../core/ui";

const DEFAULT_ZONE = "Asia/Shanghai";

/**
 * 归还处置状态文案（buffered/blocked/restored）与养护工单状态是两套，工单列表页内联维护；
 * 不写死品类词（型号/资产名经 terms() 取）。理想落点是 core/labels.ts —— 详见报告“共享层建议”。
 */
const DISPOSITION_STATUS: Record<string, { label: string; tone: Tone }> = {
  buffered: { label: "周转缓冲", tone: "info" },
  blocked: { label: "异常隔离", tone: "danger" },
  restored: { label: "已恢复可租", tone: "success" }
};

interface WorkOrderRow { id: string; workNo: string; type: string; status: string; tone: string; reason: string; location: string }
interface DispositionRow {
  id: string;
  resourceLabel: string;
  resourceValue: string;
  assetLine: string;
  quantityText: string;
  statusLabel: string;
  statusTone: string;
  reason: string;
  orderId: string;
  timeText: string;
  canRestore: boolean;
  restorable: boolean;
  actionLabel: string;
  restoredText: string;
}

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState() as ViewState,
    seg: "orders" as "orders" | "dispositions",
    tab: "open",
    locationLabel: "",
    rows: [] as WorkOrderRow[],
    dispRows: [] as DispositionRow[]
  },
  all: [] as RentalWorkOrder[],
  dispAll: [] as RentalStockDisposition[],
  context: undefined as WorkspaceContext | undefined,
  loaded: false,
  busy: false,
  groupNames: new Map<string, string>(),
  assetNos: new Map<string, string>(),
  onLoad(query: Record<string, string>) {
    // 工作台「待处置」跳转带 seg=dispositions，直接预选归还处置页签。
    if (query.seg === "dispositions") this.setData({ seg: "dispositions" });
  },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  async load() {
    if (!can("rental-core:maintenance:view")) { this.setData({ view: blockedState("无工单查看权限", "请联系租户管理员", "联系管理员", "contact") }); return; }
    if (!this.loaded) this.setData({ view: loadingState() });
    const version = contextVersion();
    try {
      this.context = await loadContext();
      const [orders, dispositions, groups] = await Promise.all([listWorkOrders(), listStockDispositions(), listItemGroups().catch(() => [])]);
      if (version !== contextVersion()) return;
      this.all = orders;
      this.dispAll = dispositions;
      this.groupNames = new Map(groups.map((group) => [group.id, group.name]));
      // 处置行的 itemGroupId/assetId 是内部 ID；解析成可读的型号名与资产编号（有资产查看权限时），取不到则退化展示。
      if (can("rental-core:asset:view", "rental-core:asset:manage")) {
        const assets = await listAssets().catch(() => []);
        if (version !== contextVersion()) return;
        this.assetNos = new Map(assets.map((asset) => [asset.id, asset.assetNo]));
      }
      this.loaded = true;
      this.render();
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  render() {
    if (this.data.seg === "dispositions") {
      const canReview = can("rental-core:maintenance:review");
      const now = Date.now();
      const dispRows = this.dispAll.filter((row) => inCurrentLocation(row.locationId)).map((row) => this.toDispositionRow(row, canReview, now));
      this.setData({ dispRows, locationLabel: currentLocationLabel(), view: dispRows.length ? readyState() : emptyState("暂无归还处置", "归还入库后待清洁/待维修/待复核的资源会出现在这里") });
      return;
    }
    const rows = this.all.filter((row) => inCurrentLocation(row.locationId)).filter((row) => this.data.tab === "all" || (this.data.tab === "open" ? !["completed", "cancelled"].includes(row.status) : row.status === "completed"))
      .map((row) => ({ id: row.id, workNo: row.workNo, type: workOrderTypeLabel(row.type), status: workOrderStatusLabel(row.status), tone: workOrderStatusTone(row.status), reason: row.reason, location: this.context?.locations.find((location) => location.id === row.locationId)?.name ?? "未知地点" }));
    this.setData({ rows, locationLabel: currentLocationLabel(), view: rows.length ? readyState() : emptyState("暂无对应工单", "切换页签或下拉刷新试试") });
  },
  toDispositionRow(row: RentalStockDisposition, canReview: boolean, now: number): DispositionRow {
    const t = terms();
    const meta = DISPOSITION_STATUS[row.status] ?? { label: String(row.status), tone: "neutral" as Tone };
    const timeZone = this.context?.locations.find((location) => location.id === row.locationId)?.timezone ?? DEFAULT_ZONE;
    const bufferPassed = Number.isFinite(Date.parse(row.bufferUntil)) && Date.parse(row.bufferUntil) <= now;
    const isRestored = row.status === "restored";
    const restorable = row.status === "buffered" && bufferPassed;
    let actionLabel = "恢复可租";
    if (row.status === "blocked") actionLabel = "待关联工单验收";
    else if (row.status === "buffered" && !bufferPassed) actionLabel = "周转缓冲中";
    return {
      id: row.id,
      resourceLabel: t.itemGroupLabel,
      resourceValue: this.groupNames.get(row.itemGroupId) ?? row.itemGroupId,
      assetLine: row.assetId ? (this.assetNos.get(row.assetId) ? `${t.identifierLabel} ${this.assetNos.get(row.assetId)}` : `已指定单台${t.assetLabel}`) : "",
      quantityText: `数量 ${row.quantity}`,
      statusLabel: meta.label,
      statusTone: meta.tone,
      reason: row.blockReason ?? "",
      orderId: row.orderId,
      timeText: formatBusinessDateTime(row.receivedAt, timeZone),
      canRestore: canReview && !isRestored,
      restorable,
      actionLabel,
      restoredText: isRestored ? (row.restoredAt ? `已于 ${formatBusinessDateTime(row.restoredAt, timeZone)} 恢复` : "已恢复可租") : ""
    };
  },
  onSeg(event: WechatMiniprogram.TouchEvent) {
    const seg = String(event.currentTarget.dataset.seg ?? "orders") === "dispositions" ? "dispositions" : "orders";
    if (seg === this.data.seg) return;
    this.setData({ seg });
    if (this.loaded) this.render();
    else { this.setData({ view: loadingState() }); void this.load(); }
  },
  onTab(event: WechatMiniprogram.TouchEvent) { this.setData({ tab: String(event.currentTarget.dataset.tab ?? "open") }); this.render(); },
  onOpen(event: WechatMiniprogram.TouchEvent) { navigate(buildUrl(ROUTES.workOrder, { id: String(event.currentTarget.dataset.id ?? "") })); },
  onOpenOrder(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.order ?? "");
    if (orderId) navigate(buildUrl(ROUTES.order, { id: orderId }));
  },
  async onRestore(event: WechatMiniprogram.TouchEvent) {
    if (this.busy) return;
    const id = String(event.currentTarget.dataset.id ?? "");
    if (!id) return;
    if (!can("rental-core:maintenance:review")) { toast("无恢复处置权限"); return; }
    const ok = await confirmDialog({ title: "恢复可租", content: `确认将该${terms().assetLabel}恢复为可出租状态？归还入库需复核确认后才能再次出租。`, confirmText: "恢复可租" });
    if (!ok) return;
    this.busy = true;
    const version = contextVersion();
    try {
      await restoreStockDisposition(id);
      if (version !== contextVersion()) return;
      toast("已恢复可租", { icon: "success" });
      await this.load();
    } catch (error) { toast(describeError(error).message); }
    finally { this.busy = false; }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: ROUTES.workOrders })) void this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); }
});
