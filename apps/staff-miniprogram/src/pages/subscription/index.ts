import { cachedContext, contextEvents, loadContext } from "../../core/context";
import { currentSession, currentWorkspace, isSignedIn } from "../../core/session";
import { staffFeatureRows } from "../../core/subscription-access";
import { cachedSubscription, loadSubscription, subscriptionEvents, subscriptionOwner, subscriptionSummary } from "../../core/subscription";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, alertDialog, relaunch } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { summary: subscriptionSummary(), features: staffFeatureRows(), workspaceName: "", categoryName: "", isAdmin: false, showPro: false },
  offSubscription: undefined as (() => void) | undefined,
  offContext: undefined as (() => void) | undefined,
  onLoad() {
    this.offSubscription = subscriptionEvents.on(() => this.renderSubscription());
    this.offContext = contextEvents.on(() => this.renderSubscription());
  },
  onUnload() { this.offSubscription?.(); this.offContext?.(); },
  onShow() {
    if (!isSignedIn()) { relaunch(ROUTES.login); return; }
    this.setData({ showPro: false });
    this.renderSubscription();
    void this.refresh();
  },
  async refresh() {
    const owner = subscriptionOwner();
    // A failed workspace refresh must not imply that the workspace is configured.
    await loadContext(true).catch(() => undefined);
    if (owner !== subscriptionOwner()) return;
    await loadSubscription(true).catch(() => undefined);
    this.renderSubscription();
  },
  renderSubscription() {
    this.setData({ summary: subscriptionSummary(), features: staffFeatureRows(), workspaceName: currentWorkspace()?.name ?? "未选择经营空间", categoryName: cachedContext()?.categoryName ?? "品类配置待确认", isAdmin: Boolean(currentSession()?.user.isTenantAdmin), showPro: Boolean(this.data.showPro && currentSession()?.user.isTenantAdmin && cachedSubscription()) });
  },
  onRetry() { void this.refresh(); },
  onPro() { if (currentSession()?.user.isTenantAdmin && cachedSubscription()) this.setData({ showPro: !this.data.showPro }); },
  onContact() {
    if (!currentSession()?.user.isTenantAdmin) return;
    void alertDialog("联系平台", "请使用租户 Web 后台的「版本与订阅」咨询入口联系平台。是否可启用以已发布目录、经营空间配置和员工权限为准；小程序不办理开通。");
  }
});
