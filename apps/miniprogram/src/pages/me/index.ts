import type { ClientMembershipStatusResponse } from "@rental-os/shared";
import { logout, membershipStatus as fetchStatus } from "../../api/auth";
import { fetchMembershipBenefits } from "../../api/profile";
import { listFavorites } from "../../core/favorites";
import { membershipLabel, reviewLabel } from "../../core/labels";
import { cachedMerchant, loadMerchant } from "../../core/merchant";
import { describeError } from "../../core/errors";
import { errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { currentSession, isWechatBound, sessionEvents } from "../../core/session";
import { ROUTES, buildUrl, callPhone, confirmDialog, navigate, toast } from "../../core/ui";
import { bindWechatIdentity } from "../../core/wechat";

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
  wechatBound: boolean;
  bindingWechat: boolean;
  /** 商户已配置小程序渠道且微信支付可用时才显示绑定入口（渠道启动 capabilities.wechatPay）。 */
  wechatPayAvailable: boolean;
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
    memberTitle: "会员权益",
    wechatBound: false,
    bindingWechat: false,
    wechatPayAvailable: false
  } as MeData,
  unsubscribe: undefined as (() => void) | undefined,

  onLoad() {
    this.unsubscribe = sessionEvents.on((event) => {
      if (event.type !== "refreshed") this.refresh();
    });
    const merchant = cachedMerchant();
    this.setData({ servicePhone: merchant?.servicePhone ?? "", wechatPayAvailable: Boolean(merchant?.capabilities.wechatPay) });
    loadMerchant(false).then((info) => this.setData({ servicePhone: info.servicePhone ?? "", wechatPayAvailable: Boolean(info.capabilities.wechatPay) })).catch(() => undefined);
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
    this.setData({ signedIn: Boolean(session), displayName, avatarInitial: displayName.trim().charAt(0) || "·", phoneMasked: session?.customer.loginIdentifierMasked ?? "", favoriteCount: listFavorites().length, wechatBound: isWechatBound() });
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

  onAddresses() {
    if (!this.data.signedIn) {
      this.onLogin();
      return;
    }
    navigate(ROUTES.addresses);
  },

  /** MP-02A：提前绑定微信身份，供小程序内微信支付使用（不必等到付款时）。 */
  async onBindWechat() {
    if (!this.data.signedIn) {
      this.onLogin();
      return;
    }
    if (this.data.wechatBound || this.data.bindingWechat) return;
    this.setData({ bindingWechat: true });
    try {
      await bindWechatIdentity();
      this.setData({ wechatBound: true });
      toast("已绑定微信，可用于小程序内微信支付", { icon: "success" });
    } catch (error) {
      toast(describeError(error).message, { duration: 3000 });
    } finally {
      this.setData({ bindingWechat: false });
    }
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
    if (!this.data.signedIn) {
      this.onLogin();
      return;
    }
    navigate(ROUTES.closure);
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.me, servicePhone: this.data.servicePhone })) return;
    void this.loadStatus();
  }
});
