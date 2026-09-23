import { cachedContext, categoryIcon, contextEvents, loadContext, type WorkspaceContext } from "../../core/context";
import { resolveImage } from "../../core/images";
import { relativeDay } from "../../core/presenters";
import { clearScanHistory, scanHistory, type ScanHistoryEntry } from "../../core/scan";
import { isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, confirmDialog, navigate, relaunch, toast } from "../../core/ui";

/**
 * S05 手动输入 / 历史记录：输入编号或订单号直接查询（复用扫码结果页解析），
 * 以及本机最近 50 条扫码记录（按账号隔离，退出登录即清）。
 */
type TabKey = "manual" | "history";

interface HistoryRow extends ScanHistoryEntry {
  timeText: string;
  icon: string;
  imagePath: string;
  actionTone: string;
}

interface ScanManualData {
  context?: WorkspaceContext;
  tab: TabKey;
  keyword: string;
  recent: HistoryRow[];
  history: HistoryRow[];
  scanning: boolean;
}

const DEFAULT_ZONE = "Asia/Shanghai";
const ACTION_TONE: Record<string, string> = { 出库: "info", 入库: "success", 绑定订单: "warning", 查看: "neutral" };

Page({
  behaviors: [themeBehavior],
  data: { tab: "manual", keyword: "", recent: [], history: [], scanning: false } as ScanManualData,
  offContext: undefined as (() => void) | undefined,

  onLoad(query: Record<string, string>) {
    let code = String(query.code ?? "");
    try {
      code = decodeURIComponent(code);
    } catch {
      // 保持原样
    }
    this.setData({ tab: query.tab === "history" ? "history" : "manual", keyword: code.trim() });
    this.offContext = contextEvents.on(() => this.setData({ context: cachedContext() }));
  },

  onUnload() {
    this.offContext?.();
  },

  onShow() {
    if (!isSignedIn()) {
      relaunch(ROUTES.login);
      return;
    }
    loadContext().then(() => this.setData({ context: cachedContext() })).catch(() => undefined);
    this.refreshHistory();
  },

  refreshHistory() {
    const timeZone = cachedContext()?.locations[0]?.timezone ?? DEFAULT_ZONE;
    const icon = categoryIcon();
    const previous = new Map<string, string>();
    for (const row of this.data.history) if (row.imagePath) previous.set(row.imageSource ?? "", row.imagePath);
    const history: HistoryRow[] = scanHistory().map((entry) => ({
      ...entry,
      timeText: relativeDay(new Date(entry.at).toISOString(), timeZone),
      icon: entry.kind === "order" ? "orders" : entry.kind === "workOrder" ? "tool" : icon,
      imagePath: entry.imageSource ? previous.get(entry.imageSource) ?? "" : "",
      actionTone: ACTION_TONE[entry.action] ?? "neutral"
    }));
    this.setData({ history, recent: history.slice(0, 5) });
    history.forEach((row, index) => {
      if (!row.imageSource || row.imagePath) return;
      resolveImage(row.imageSource).then((path) => {
        if (!path || this.data.history[index]?.code !== row.code) return;
        const patch: Record<string, string> = { [`history[${index}].imagePath`]: path };
        if (index < 5) patch[`recent[${index}].imagePath`] = path;
        this.setData(patch);
      });
    });
  },

  onTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.key ?? "manual") as TabKey;
    if (tab !== this.data.tab) this.setData({ tab });
  },

  onKeyword(event: WechatMiniprogram.Input) {
    this.setData({ keyword: String(event.detail.value ?? "") });
  },

  onClearKeyword() {
    this.setData({ keyword: "" });
  },

  onQuery() {
    const code = this.data.keyword.trim();
    if (!code) {
      toast(`请输入${this.data.context?.terminology.identifierLabel ?? "编号"}、序列号或订单号`);
      return;
    }
    navigate(buildUrl(ROUTES.scanResult, { code }));
  },

  /** 输入框右侧的小扫码按钮：把扫到的码填进输入框，由用户确认后查询。 */
  onScanFill() {
    if (this.data.scanning) return;
    this.setData({ scanning: true });
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ["barCode", "qrCode", "datamatrix", "pdf417"],
      success: (res) => {
        const code = String(res.result ?? "").trim();
        if (!code) {
          toast("没有识别到内容");
          return;
        }
        this.setData({ keyword: code });
      },
      fail: (error) => {
        const message = String((error as { errMsg?: string }).errMsg ?? "");
        if (!/cancel/i.test(message)) toast("未能打开扫码，请检查摄像头权限");
      },
      complete: () => this.setData({ scanning: false })
    });
  },

  onEntry(event: WechatMiniprogram.TouchEvent) {
    const code = String(event.currentTarget.dataset.code ?? "");
    if (!code) return;
    navigate(buildUrl(ROUTES.scanResult, { code }));
  },

  async onClear() {
    if (!this.data.history.length) return;
    const ok = await confirmDialog({ title: "清空扫码记录", content: "只清除本机保存的扫码记录，不影响服务端数据。", confirmText: "清空", danger: true });
    if (!ok) return;
    clearScanHistory();
    this.refreshHistory();
    toast("已清空");
  },

  onGoScan() {
    navigate(ROUTES.scan);
  }
});
