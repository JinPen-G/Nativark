import type { SharedCustomerProfile } from "@rental-os/shared";
import { createCustomer, getCustomer, updateCorporateCustomer, updatePersonalCustomer } from "../../api/customers";
import { describeError } from "../../core/errors";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { canTenant, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, relaunch, toast } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", customerType: "personal" as "personal" | "corporate", types: ["个人", "企业"], name: "", phone: "", phoneHint: "", email: "", corporateName: "", region: "", busy: false, error: "" },
  customer: undefined as SharedCustomerProfile | undefined,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } if (this.data.view.status !== "ready") void this.load(); },
  async load() {
    this.setData({ view: loadingState() });
    try {
      if (this.data.id) {
        const customer = await getCustomer(this.data.id);
        if (!canTenant(customer.customerType === "corporate" ? "rental-os:corporate:manage" : "rental-os:member:manage")) { this.setData({ view: blockedState("无编辑权限", "请联系租户管理员") }); return; }
        this.customer = customer;
        this.setData({ view: readyState(), customerType: customer.customerType, name: customer.name, phone: "", phoneHint: customer.phoneMasked, email: customer.email ?? "", corporateName: customer.corporateName ?? "", region: customer.region ?? "", error: "" });
      } else {
        if (!canTenant("rental-os:member:manage")) { this.setData({ view: blockedState("无新增权限", "请联系租户管理员") }); return; }
        this.setData({ view: readyState() });
      }
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onType(event: WechatMiniprogram.PickerChange) { if (!this.data.id) this.setData({ customerType: Number(event.detail.value) === 1 ? "corporate" : "personal", error: "" }); },
  onInput(event: WechatMiniprogram.Input) { this.setData({ [String(event.currentTarget.dataset.field)]: String(event.detail.value ?? ""), error: "" }); },
  async onSave() {
    if (this.data.busy) return;
    const name = this.data.name.trim(); const phone = this.data.phone.trim(); const email = this.data.email.trim(); const corporateName = this.data.corporateName.trim();
    if (!name || (!this.data.id && !phone) || (this.data.customerType === "corporate" && !corporateName)) { this.setData({ error: "请填写姓名、联系电话及必填的企业名称" }); return; }
    if (phone && !/^\+?[0-9 -]{6,20}$/.test(phone)) { this.setData({ error: "联系电话格式不正确" }); return; }
    // 新增客户：服务端 POST /platform/customers 只要 member:manage（个人/企业同一入口）；
    // 编辑既有企业客户才需要 corporate:manage（与加载时的编辑门控一致）。
    if (!this.data.id) {
      if (!canTenant("rental-os:member:manage")) { this.setData({ error: "无客户新增权限" }); return; }
    } else if (this.data.customerType === "personal" && !canTenant("rental-os:member:manage")) { this.setData({ error: "无个人客户管理权限" }); return; }
    else if (this.data.customerType === "corporate" && !canTenant("rental-os:corporate:manage")) { this.setData({ error: "无企业客户管理权限" }); return; }
    this.setData({ busy: true, error: "" });
    try {
      let id = this.data.id;
      if (!id) {
        const created = await createCustomer({ customerType: this.data.customerType, name, phone, email: email || undefined, corporateName: this.data.customerType === "corporate" ? corporateName : undefined, region: this.data.customerType === "personal" ? this.data.region.trim() || undefined : undefined });
        id = created.id;
      } else if (this.data.customerType === "personal") {
        await updatePersonalCustomer(id, { name, phone: phone || undefined, email, region: this.data.region.trim() });
      } else {
        await updateCorporateCustomer({ id, name, phone: phone || undefined, email, corporateName });
      }
      toast("客户资料已保存", { icon: "success" }); relaunch(buildUrl(ROUTES.customer, { id }));
    } catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.customerEdit, { id: this.data.id }) })) void this.load(); }
});
