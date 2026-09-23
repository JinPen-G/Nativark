import { logout } from "../../api/auth";
import { cachedContext, contextEvents, currentLocationLabel, loadContext, type WorkspaceContext } from "../../core/context";
import { initialOf } from "../../core/presenters";
import { can, canTenant, currentSession, currentWorkspace, isSignedIn, sessionEvents } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, confirmDialog, navigate, relaunch, toast } from "../../core/ui";

/**
 * S13 我的：头像/姓名/角色 → 当前工作区（切换）→ 三个快捷卡（按权限）→ 个人信息 / 修改密码 / 操作记录 / 帮助 / 关于 → 退出登录。
 */
interface QuickCard {
  key: string;
  label: string;
  hint: string;
  icon: string;
  color: string;
}

interface MeData {
  displayName: string;
  initial: string;
  account: string;
  roleLabel: string;
  tenantName: string;
  workspaceName: string;
  locationLabel: string;
  cards: QuickCard[];
  context?: WorkspaceContext;
}

Page({
  behaviors: [themeBehavior],
  data: { displayName: "", initial: "·", account: "", roleLabel: "", tenantName: "", workspaceName: "", locationLabel: "", cards: [] } as MeData,
  offContext: undefined as (() => void) | undefined,
  offSession: undefined as (() => void) | undefined,

  onLoad() {
    this.offContext = contextEvents.on(() => this.render());
    this.offSession = sessionEvents.on(() => this.render());
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
    this.render();
    loadContext().then(() => this.render()).catch(() => undefined);
  },

  render() {
    const session = currentSession();
    if (!session) return;
    const context = cachedContext();
    const t = context?.terminology;
    const cards: QuickCard[] = [];
    if (can("rental-os:order:pickup", "rental-os:order:return")) cards.push({ key: "assets", label: `${t?.assetLabel ?? "物品"}操作`, hint: "可出入库/盘点", icon: "box", color: "" });
    if (can("rental-os:order:view")) cards.push({ key: "orders", label: "订单处理", hint: "可取还/核对", icon: "orders", color: "green" });
    if (can("rental-core:maintenance:view")) cards.push({ key: "workOrders", label: "工单处理", hint: "可创建/处理", icon: "tool", color: "purple" });
    this.setData({
      displayName: session.user.displayName,
      initial: initialOf(session.user.displayName),
      account: session.user.account,
      roleLabel: session.user.isTenantAdmin ? "管理员" : session.user.roleNames[0] ?? "员工",
      tenantName: session.tenant.tenantName,
      workspaceName: currentWorkspace()?.name ?? "",
      locationLabel: currentLocationLabel(),
      cards,
      context
    });
  },

  onSwitchWorkspace() {
    navigate(buildUrl(ROUTES.workspace, { redirect: ROUTES.me }));
  },

  onCard(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? "");
    if (key === "assets") navigate(ROUTES.assets);
    else if (key === "orders") wx.switchTab({ url: ROUTES.orders });
    else if (key === "workOrders") navigate(ROUTES.workOrders);
  },

  onProfile() {
    const session = currentSession();
    if (!session) return;
    const scope = canTenant("rental-os:member:view") ? "含租户级客户查看" : "仅当前空间";
    wx.showModal({ title: "个人信息", content: `账号：${session.user.account}\n姓名：${session.user.displayName}\n角色：${session.user.roleNames.join("、") || "—"}\n租户：${session.tenant.tenantName}\n权限范围：${scope}`, showCancel: false, confirmText: "知道了" });
  },

  onPassword() {
    navigate(ROUTES.password);
  },

  onHistory() {
    navigate(ROUTES.history);
  },

  onHelp() {
    navigate(buildUrl(ROUTES.about, { section: "help" }));
  },

  onAbout() {
    navigate(ROUTES.about);
  },

  async onLogout() {
    const confirmed = await confirmDialog({ title: "退出登录", content: "退出后会清除本机的登录状态、扫码记录与未提交草稿。", confirmText: "退出", danger: true });
    if (!confirmed) return;
    await logout();
    toast("已退出登录");
    relaunch(ROUTES.login);
  }
});
