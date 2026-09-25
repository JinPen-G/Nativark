import type { SharedCustomerProfile } from "@rental-os/shared";
import { getCustomer } from "../../api/customers";
import { listOrders } from "../../api/orders";
import { orderStatusLabel } from "../../core/labels";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { initialOf, maskPhone } from "../../core/presenters";
import { cachedContext } from "../../core/context";
import { formatBusinessDate } from "../../core/time";
import { can, canTenant, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, callPhone, navigate, relaunch, toast } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", tab: "info", name: "", initial: "", phoneMasked: "", identityNoMasked: "", email: "", type: "", typeBadge: "", status: "", registeredAt: "", corporateName: "", address: "", canEdit: false, canCreateOrder: false, cooperationCount: 0, orders: [] as Array<{ id: string; orderNo: string; status: string }> },
  customer: undefined as SharedCustomerProfile | undefined,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  async load() {
    if (!canTenant("rental-os:member:view", "rental-os:member:manage")) { this.setData({ view: blockedState("无客户查看权限", "请联系租户管理员", "联系管理员", "contact") }); return; }
    if (!this.data.id) { this.setData({ view: blockedState("缺少客户编号", "请从客户列表重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const customer = await getCustomer(this.data.id);
      this.customer = customer;
      const orders = await listOrders().catch(() => []);
      const customerOrders = orders.filter((order) => order.customerId === customer.id);
      this.setData({ view: readyState(), name: customer.name, initial: initialOf(customer.name), phoneMasked: customer.phoneMasked || maskPhone(customer.phone), identityNoMasked: customer.identityNoMasked ?? "", email: customer.email ?? "", type: customer.customerType === "corporate" ? "企业客户" : "个人客户", typeBadge: customer.customerType === "corporate" ? "企业客户" : "普通客户", status: customer.status === "active" ? "正常" : "已停用", registeredAt: formatBusinessDate(customer.createdAt, cachedContext()?.locations[0]?.timezone ?? "Asia/Shanghai"), corporateName: customer.corporateName ?? "", address: customer.region ?? "", canEdit: canTenant(customer.customerType === "corporate" ? "rental-os:corporate:manage" : "rental-os:member:manage"), canCreateOrder: can("rental-os:order:create"), cooperationCount: customerOrders.length, orders: customerOrders.slice(0, 5).map((order) => ({ id: order.id, orderNo: order.orderNo, status: orderStatusLabel(order.status) })) });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onCall() {
    const phone = this.customer?.phone;
    // 无解密权限时服务端已把 phone 脱敏成含 * 的串（如 138****1234），无法直接拨号；提示而非静默失败。
    if (!phone || /[^\d+\-\s]/.test(phone)) { toast("该客户号码已脱敏，需在后台解密后再联系"); return; }
    callPhone(phone);
  },
  onTab(event: WechatMiniprogram.TouchEvent) { this.setData({ tab: String(event.currentTarget.dataset.tab ?? "info") }); },
  onNewOrder() { if (this.data.canCreateOrder) navigate(ROUTES.orderNew); },
  onEdit() { if (this.data.canEdit) navigate(buildUrl(ROUTES.customerEdit, { id: this.data.id })); },
  onOrder(event: WechatMiniprogram.TouchEvent) { navigate(buildUrl(ROUTES.order, { id: String(event.currentTarget.dataset.id ?? "") })); },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.customer, { id: this.data.id }) })) void this.load(); }
});
