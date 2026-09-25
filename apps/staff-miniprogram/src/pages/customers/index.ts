import type { SharedCustomerProfile } from "@rental-os/shared";
import { listCustomers, matchCustomer } from "../../api/customers";
import { blockedState, emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { canTenant, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, navigate, relaunch } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, keyword: "", canCreate: false, rows: [] as Array<{ id: string; name: string; phone: string; type: string; status: string }> },
  all: [] as SharedCustomerProfile[],
  onShow() {
    if (!isSignedIn()) { relaunch(ROUTES.login); return; }
    if (!canTenant("rental-os:member:view", "rental-os:member:manage")) { this.setData({ view: blockedState("无客户查看权限", "请联系租户管理员授权租户级客户查看权限", "联系管理员", "contact") }); return; }
    this.setData({ canCreate: canTenant("rental-os:member:manage") });
    void this.load();
  },
  async load() {
    if (!this.all.length) this.setData({ view: loadingState() });
    try { this.all = await listCustomers(); this.filter(); }
    catch (error) { this.setData({ view: errorState(error) }); }
  },
  filter() {
    const rows = this.all.filter((row) => matchCustomer(row, this.data.keyword)).map((row) => ({ id: row.id, name: row.name, phone: row.phoneMasked, type: row.customerType === "corporate" ? "企业客户" : "个人客户", status: row.status === "active" ? "正常" : "已停用" }));
    this.setData({ rows, view: rows.length ? readyState() : emptyState("没有找到客户", this.data.keyword ? "换个关键字试试" : "当前租户暂无客户") });
  },
  onKeyword(event: WechatMiniprogram.Input) { this.setData({ keyword: String(event.detail.value ?? "") }); this.filter(); },
  onClear() { this.setData({ keyword: "" }); this.filter(); },
  onOpen(event: WechatMiniprogram.TouchEvent) { navigate(buildUrl(ROUTES.customer, { id: String(event.currentTarget.dataset.id ?? "") })); },
  onCreate() { if (this.data.canCreate) navigate(ROUTES.customerEdit); },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: ROUTES.customers })) void this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); }
});
