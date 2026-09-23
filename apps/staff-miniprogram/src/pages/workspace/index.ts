import { switchWorkspace } from "../../api/auth";
import { categoryIcon, loadContext, setCurrentLocation, type WorkspaceContext } from "../../core/context";
import { describeError } from "../../core/errors";
import { errorState, loadingState, readyState, type ViewState } from "../../core/page";
import { currentSession, currentWorkspaceId, isSignedIn, type SessionWorkspace } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, relaunch, safeRoute, toast } from "../../core/ui";

/**
 * S02 选择工作范围：先选经营空间（服务端换发令牌），再选履约地点（本机筛选范围，"" = 全部）。
 * 只有一个空间时登录页已直接进入；本页也可从“我的 → 切换”进入。
 */
interface WorkspaceRow extends SessionWorkspace {
  icon: string;
  current: boolean;
  runModeLabel: string;
}

interface WorkspaceData {
  view: ViewState;
  workspaces: WorkspaceRow[];
  selectedId: string;
  switching: boolean;
  context?: WorkspaceContext;
  locationId: string;
  redirect: string;
  tenantName: string;
}

const RUN_MODE: Record<string, string> = { production: "", development: "开发空间", demo: "演示空间" };

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState(), workspaces: [], selectedId: "", switching: false, locationId: "", redirect: "", tenantName: "" } as WorkspaceData,

  onLoad(query: Record<string, string>) {
    if (!isSignedIn()) {
      relaunch(ROUTES.login);
      return;
    }
    this.setData({ redirect: safeRoute(query.redirect, ROUTES.workbench) });
    this.render();
  },

  render() {
    const session = currentSession();
    if (!session) return;
    const current = currentWorkspaceId();
    const workspaces: WorkspaceRow[] = session.workspaces.map((row) => ({ ...row, icon: categoryIcon(row.categoryCode), current: row.id === current, runModeLabel: RUN_MODE[row.runMode ?? ""] ?? "" }));
    this.setData({ view: readyState(), workspaces, tenantName: session.tenant.tenantName, selectedId: current });
    if (current) void this.loadLocations();
  },

  async loadLocations() {
    try {
      const context = await loadContext(true);
      this.setData({ context, locationId: context.currentLocationId });
    } catch (error) {
      this.setData({ view: errorState(error) });
    }
  },

  async onPickWorkspace(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    if (!id || this.data.switching) return;
    if (id === currentWorkspaceId()) {
      this.setData({ selectedId: id });
      return;
    }
    this.setData({ switching: true, selectedId: id, context: undefined });
    try {
      await switchWorkspace(id);
      const context = await loadContext(true);
      this.setData({ context, locationId: context.currentLocationId, workspaces: this.data.workspaces.map((row) => ({ ...row, current: row.id === id })) });
    } catch (error) {
      toast(describeError(error).message, { duration: 3000 });
      this.setData({ selectedId: currentWorkspaceId() });
    } finally {
      this.setData({ switching: false });
    }
  },

  onPickLocation(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    this.setData({ locationId: id });
  },

  onEnter() {
    if (!this.data.selectedId || this.data.switching) return;
    if (!this.data.context) {
      toast("正在加载经营空间信息，请稍候");
      return;
    }
    setCurrentLocation(this.data.locationId);
    relaunch(this.data.redirect || ROUTES.workbench);
  },

  onViewAction() {
    this.render();
  }
});
