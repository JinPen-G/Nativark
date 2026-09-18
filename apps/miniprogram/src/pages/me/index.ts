import type { ClientMembershipStatusResponse } from "@rental-os/shared";
import { logout, membershipStatus as fetchStatus } from "../../api/auth";
import { fetchMembershipBenefits } from "../../api/profile";
import { listFavorites } from "../../core/favorites";
import { membershipLabel, reviewLabel } from "../../core/labels";
import { cachedMerchant, loadMerchant } from "../../core/merchant";
import { errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { currentSession, sessionEvents } from "../../core/session";
import { ROUTES, alertDialog, buildUrl, callPhone, confirmDialog, navigate, toast } from "../../core/ui";

/**
 * P12 我的（V2 设计稿）：头像/手机号 → 会员横幅 → 我的订单/我的收藏/优惠券 → 实名认证/常用服务点/帮助与客服/设置。
 * 会员横幅只展示已授予的方案与状态，入口是“查看权益”；付费升级不在本期范围，不放“立即升级”空壳按钮。
 */
interface MeData {
  view: ViewState;
  signedIn: boolean;
  servicePhone: string;
  displayName: string;
  avatarInitial: string;
  phoneMasked: string;
  membershipStatus: string;
  membershipLabel: string;
  membershipTone: string;
  planName: string;
  planHint: string;
  reviewText: string;
  qualificationSummary: string;
  favoriteCount: number;
  /** 会员横幅标题：已登录显示方案名（无方案时显示会员状态），未登录显示入口文案。 */
  memberTitle: string;
}

Page({
  data: {
    view: readyState(),
    signedIn: false,
    servicePhone: "",
    displayName: "",
    avatarInitial: "·",
    phoneMasked: "",
    membershipStatus: "",
    membershipLabel: "",
    membershipTone: "neutral",
    planName: "",
    planHint: "",
    reviewText: "",
    qualificationSummary: "",
    favoriteCount: 0,
    memberTitle: "会员权益"
  } as MeData,
  unsubscribe: undefined as (() => void) | undefined,

  onLoad() {
    this.unsubscribe = sessionEvents.on((event) => {
      if (event.type !== "refreshed") this.refresh();
    });
    const merchant = cachedMerchant();
    this.setData({ servicePhone: merchant?.servicePhone ?? "" });
    loadMerchant(false).then((info) => this.setData({ servicePhone: info.servicePhone ?? "" })).catch(() => undefined);
  },

  onUnload() {
    this.unsubscribe?.();
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const session = currentSession();
    const displayName = session?.customer.displayName ?? "";
    this.setData({ signedIn: Boolean(session), displayName, avatarInitial: displayName.trim().charAt(0) || "·", phoneMasked: session?.customer.loginIdentifierMasked ?? "", favoriteCount: listFavorites().length });
    this.syncMemberTitle();
    if (session) void this.loadStatus();
  },

  syncMemberTitle() {
    const { signedIn, planName, membershipLabel: label } = this.data;
    this.setData({ memberTitle: signedIn ? planName || label || "会员" : "会员权益" });
  },

  async loadStatus() {
    this.setData({ view: loadingState() });
    try {
      const [status, benefits] = await Promise.all([fetchStatus(), fetchMembershipBenefits().catch(() => undefined)]);
      this.apply(status);
      const plan = benefits?.personal;
      this.setData({ planName: plan?.planName ?? "", planHint: plan ? "查看在各服务的适用权益" : "商户授予方案后自动享受权益" });
      this.syncMemberTitle();
    } catch (error) {
      this.setData({ view: errorState(error) });
    }
  },

  apply(status: ClientMembershipStatusResponse) {
    const membership = status.workspace?.membershipStatus ?? status.workspaces[0]?.membershipStatus ?? "";
    const latestReview = status.reviews[0];
    const qualifications = status.qualifications;
    const pendingCount = qualifications.filter((row) => row.status === "pending").length;
    const problemCount = qualifications.filter((row) => row.status === "rejected" || row.status === "expired" || row.status === "revoked").length;
    const approved = qualifications.filter((row) => row.status === "approved").length;
    this.setData({
      view: readyState(),
      displayName: status.displayName,
      avatarInitial: status.displayName.trim().charAt(0) || "·",
      phoneMasked: status.phoneMasked,
      membershipStatus: membership,
      membershipLabel: membershipLabel(membership),
      membershipTone: membership === "active" ? "success" : membership === "pending_activation" ? "warning" : "danger",
      reviewText: latestReview && latestReview.status !== "approved" ? `注册审核：${reviewLabel(latestReview.status)}${latestReview.reason ? `（${latestReview.reason}）` : ""}` : "",
      qualificationSummary: qualifications.length ? (problemCount ? `${problemCount} 项需处理` : pendingCount ? `${pendingCount} 项审核中` : `${approved} 项已通过`) : "未提交"
    });
  },

  onLogin() {
    navigate(buildUrl(ROUTES.login, { redirect: ROUTES.me }));
  },

  /** 头像区：已登录进资料页，未登录进登录页。 */
  onProfileTap() {
    if (this.data.signedIn) this.onProfile();
    else this.onLogin();
  },

  onProfile() {
    navigate(ROUTES.profile);
  },

  onOrders() {
    wx.switchTab({ url: ROUTES.orders });
  },

  onFavorites() {
    navigate(ROUTES.favorites);
  },

  onCoupons() {
    if (!this.data.signedIn) {
      this.onLogin();
      return;
    }
    navigate(ROUTES.coupons);
  },

  onQualifications() {
    if (!this.data.signedIn) {
      this.onLogin();
      return;
    }
    navigate(ROUTES.qualifications);
  },

  onBenefits() {
    if (!this.data.signedIn) {
      this.onLogin();
      return;
    }
    navigate(ROUTES.benefits);
  },

  onLocations() {
    navigate(ROUTES.locations);
  },

  onHelp() {
    navigate(buildUrl(ROUTES.legal, { doc: "help" }));
  },

  onSettings() {
    if (!this.data.signedIn) {
      this.onLogin();
      return;
    }
    navigate(ROUTES.profile);
  },

  onContact() {
    callPhone(this.data.servicePhone);
  },

  async onLogout() {
    const confirmed = await confirmDialog({ title: "退出登录", content: "退出后会清除本机的登录状态与未提交的租赁清单；已提交的订单不受影响。", confirmText: "退出" });
    if (!confirmed) return;
    await logout();
    toast("已退出登录");
    this.refresh();
  },

  onCloseAccount() {
    void alertDialog("注销账号", "在线注销尚未开通。注销前商户需要核对你在所有服务的在途订单、押金与待退款，请联系商户办理。");
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.me, servicePhone: this.data.servicePhone })) return;
    void this.loadStatus();
  }
});
