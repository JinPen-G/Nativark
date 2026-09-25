import { themeBehavior } from "../../core/theme-behavior";
import type { ClientDeliveryAddressView } from "@rental-os/shared";
import { deleteAddress, listAddresses, saveAddress } from "../../api/addresses";
import { describeError } from "../../core/errors";
import { errorState, handleCommonViewAction, loadingState, readyState, type FieldErrors, type ViewState } from "../../core/page";
import { ROUTES, confirmDialog, requireSignIn, toast } from "../../core/ui";

/**
 * MP-06 收货地址簿：本人在本租户内共享的配送地址（不是联系人）。支持新增/编辑/删除/设为默认。
 * 服务端按本人归属校验并做并发版本控制；这里只做基本必填校验，金额与快照不在客户端产生。
 */
interface AddressForm {
  recipient: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  isDefault: boolean;
}

interface AddressData {
  view: ViewState;
  items: ClientDeliveryAddressView[];
  showForm: boolean;
  editing: boolean;
  form: AddressForm;
  errors: FieldErrors;
  submitting: boolean;
  formError: string;
  deletingId: string;
}

const EMPTY_FORM: AddressForm = { recipient: "", phone: "", province: "", city: "", district: "", detail: "", isDefault: false };

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    items: [],
    showForm: false,
    editing: false,
    form: { ...EMPTY_FORM },
    errors: {},
    submitting: false,
    formError: "",
    deletingId: ""
  } as AddressData,

  editingId: "" as string,
  editingRevision: 0 as number,

  onLoad() {
    if (!requireSignIn(ROUTES.addresses)) return;
    void this.load();
  },

  async load() {
    this.setData({ view: loadingState() });
    try {
      const items = await listAddresses();
      this.setData({ view: readyState(), items });
    } catch (error) {
      this.setData({ view: errorState(error) });
    }
  },

  onAdd() {
    this.editingId = "";
    this.editingRevision = 0;
    this.setData({ showForm: true, editing: false, form: { ...EMPTY_FORM, isDefault: this.data.items.length === 0 }, errors: {}, formError: "" });
  },

  onEdit(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const item = this.data.items.find((row) => row.id === id);
    if (!item) return;
    this.editingId = item.id;
    this.editingRevision = item.revision;
    this.setData({
      showForm: true,
      editing: true,
      errors: {},
      formError: "",
      form: { recipient: item.recipient, phone: "", province: item.province, city: item.city, district: item.district ?? "", detail: item.detail, isDefault: item.isDefault }
    });
  },

  onCloseForm() {
    if (this.data.submitting) return;
    this.setData({ showForm: false });
  },

  onFormInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field);
    this.setData({ [`form.${field}`]: String(event.detail.value ?? ""), [`errors.${field}`]: "", formError: "" });
  },

  onDefaultToggle(event: WechatMiniprogram.SwitchChange) {
    this.setData({ "form.isDefault": Boolean(event.detail.value) });
  },

  validate(): boolean {
    const errors: FieldErrors = {};
    const form = this.data.form;
    if (!form.recipient.trim()) errors.recipient = "请填写收货人";
    const phone = form.phone.trim().replace(/[\s-]/g, "");
    if (!/^\+?[0-9]{6,20}$/.test(phone)) errors.phone = "请输入正确的联系电话";
    if (!form.province.trim()) errors.province = "请填写省份";
    if (!form.city.trim()) errors.city = "请填写城市";
    if (!form.detail.trim()) errors.detail = "请填写详细地址";
    this.setData({ errors });
    return Object.keys(errors).length === 0;
  },

  async onSubmitForm() {
    if (this.data.submitting) return;
    if (!this.validate()) return;
    const form = this.data.form;
    const phone = form.phone.trim().replace(/[\s-]/g, "");
    this.setData({ submitting: true, formError: "" });
    try {
      await saveAddress({
        id: this.editingId || undefined,
        revision: this.editingId ? this.editingRevision : undefined,
        recipient: form.recipient.trim(),
        phone,
        province: form.province.trim(),
        city: form.city.trim(),
        district: form.district.trim() || undefined,
        detail: form.detail.trim(),
        isDefault: form.isDefault
      });
      this.setData({ showForm: false });
      toast(this.data.editing ? "已保存地址" : "已新增地址", { icon: "success" });
      await this.load();
    } catch (error) {
      const presented = describeError(error);
      if (presented.code === "CONFLICT") {
        this.setData({ formError: "地址已被其他操作更新，请返回列表刷新后重试。" });
        void this.load();
      } else {
        this.setData({ formError: presented.message });
      }
    } finally {
      this.setData({ submitting: false });
    }
  },

  /** 设为默认需重新验证收货信息（服务端要求带电话），因此打开编辑表单并预置为默认，由用户确认保存。 */
  onSetDefault(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const item = this.data.items.find((row) => row.id === id);
    if (!item || item.isDefault) return;
    this.editingId = item.id;
    this.editingRevision = item.revision;
    this.setData({
      showForm: true,
      editing: true,
      errors: {},
      formError: "",
      form: { recipient: item.recipient, phone: "", province: item.province, city: item.city, district: item.district ?? "", detail: item.detail, isDefault: true }
    });
  },

  async onDelete(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const item = this.data.items.find((row) => row.id === id);
    if (!item || this.data.deletingId) return;
    const confirmed = await confirmDialog({ title: "删除地址", content: `确认删除“${item.recipient}·${item.city}${item.detail}”吗？已提交订单上的收货地址不受影响。`, confirmText: "删除", danger: true });
    if (!confirmed) return;
    this.setData({ deletingId: id });
    try {
      await deleteAddress(item.id);
      await this.load();
      toast("已删除");
    } catch (error) {
      toast(describeError(error).message, { duration: 3000 });
    } finally {
      this.setData({ deletingId: "" });
    }
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.addresses })) return;
    void this.load();
  }
});
