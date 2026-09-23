import type { SharedCustomerProfile } from "@rental-os/shared";
import { getCustomer } from "../../api/customers";
import { listOrders } from "../../api/orders";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { initialOf, maskPhone } from "../../core/presenters";
import { canTenant, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, callPhone, navigate, relaunch } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", name: "", initial: "", phoneMasked: "", type: "", status: "", corporateName: "", address: "", canEdit: false, orders: [] as Array<{ id: string; orderNo: string; status: string }> },
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
      this.setData({ view: readyState(), name: customer.name, initial: initialOf(customer.name), phoneMasked: customer.phoneMasked || maskPhone(customer.phone), type: customer.customerType === "corporate" ? "企业客户" : "个人客户", status: customer.status === "active" ? "正常" : "已停用", corporateName: customer.corporateName ?? "", address: customer.region ?? "", canEdit: canTenant(customer.customerType === "corporate" ? "rental-os:corporate:manage" : "rental-os:member:manage"), orders: orders.filter((order) => order.customerId === customer.id).slice(0, 5).map((order) => ({ id: order.id, orderNo: order.orderNo, status: order.status })) });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onCall() { callPhone(this.customer?.phone); },
  onEdit() { if (this.data.canEdit) navigate(buildUrl(ROUTES.customerEdit, { id: this.data.id })); },
  onOrder(event: WechatMiniprogram.TouchEvent) { navigate(buildUrl(ROUTES.order, { id: String(event.currentTarget.dataset.id ?? "") })); },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.customer, { id: this.data.id }) })) void this.load(); }
});
