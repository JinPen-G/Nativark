import { cachedContext, categoryIcon, loadContext, terms } from "../../core/context";
import { clearScanHistory, scanHistory, type ScanHistoryEntry } from "../../core/scan";
import { isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessDate, formatBusinessTime, zonedParts } from "../../core/time";
import { ROUTES, buildUrl, confirmDialog, navigate, relaunch, toast } from "../../core/ui";

/**
 * 操作记录（本期 = 本机记录）：扫码与随后动作（出库/入库/绑定订单/查看）按日期分组的时间线。
 * 服务端操作审计在 Web 后台查看；这里只读本机最近 50 条，按账号隔离。
 */
interface HistoryItem extends ScanHistoryEntry {
  timeText: string;
  icon: string;
  actionTone: string;
}

interface DayGroup {
  key: string;
  label: string;
  items: HistoryItem[];
}

interface HistoryData {
  groups: DayGroup[];
  total: number;
  note: string;
  pickupLabel: string;
  returnLabel: string;
}

const DEFAULT_ZONE = "Asia/Shanghai";
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
/** 历史动作角标色：取还动作随品类术语解析，其余保留固定词（含历史遗留的“出库/入库”）。 */
const ACTION_TONE: Record<string, string> = { 出库: "info", 入库: "success", 绑定订单: "warning", 查看: "neutral" };
function actionTone(action: string): string {
  const t = terms();
  if (action === t.pickupLabel) return "info";
  if (action === t.returnLabel) return "success";
  return ACTION_TONE[action] ?? "neutral";
}

Page({
  behaviors: [themeBehavior],
  data: { groups: [], total: 0, note: "服务端操作审计在 Web 后台查看；这里是本机最近 50 条扫码与操作记录。", pickupLabel: "领取", returnLabel: "归还" } as HistoryData,

  onShow() {
    if (!isSignedIn()) {
      relaunch(ROUTES.login);
      return;
    }
    loadContext().then(() => this.refresh()).catch(() => this.refresh());
    this.refresh();
  },

  refresh() {
    const timeZone = cachedContext()?.locations[0]?.timezone ?? DEFAULT_ZONE;
    const icon = categoryIcon();
    const today = formatBusinessDate(new Date().toISOString(), timeZone);
    const yesterday = formatBusinessDate(new Date(Date.now() - 86400000).toISOString(), timeZone);
    const groups: DayGroup[] = [];
    let total = 0;
    for (const entry of scanHistory()) {
      const iso = new Date(entry.at).toISOString();
      const day = formatBusinessDate(iso, timeZone);
      const parts = zonedParts(new Date(entry.at), timeZone);
      const label = day === today ? "今天" : day === yesterday ? "昨天" : `${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${WEEKDAYS[parts.weekday]}`;
      let group = groups[groups.length - 1];
      if (!group || group.key !== day) {
        group = { key: day, label, items: [] };
        groups.push(group);
      }
      group.items.push({
        ...entry,
        timeText: formatBusinessTime(iso, timeZone),
        icon: entry.kind === "order" ? "orders" : entry.kind === "workOrder" ? "tool" : icon,
        actionTone: actionTone(entry.action)
      });
      total += 1;
    }
    this.setData({ groups, total, pickupLabel: terms().pickupLabel, returnLabel: terms().returnLabel });
  },

  onEntry(event: WechatMiniprogram.TouchEvent) {
    const code = String(event.currentTarget.dataset.code ?? "");
    if (!code) return;
    navigate(buildUrl(ROUTES.scanResult, { code }));
  },

  async onClear() {
    if (!this.data.total) return;
    const ok = await confirmDialog({ title: "清空本机记录", content: "只清除本机保存的扫码与操作记录，不影响服务端审计。", confirmText: "清空", danger: true });
    if (!ok) return;
    clearScanHistory();
    this.refresh();
    toast("已清空");
  },

  onGoScan() {
    navigate(ROUTES.scan);
  }
});
