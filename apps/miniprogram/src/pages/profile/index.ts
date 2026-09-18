import type { ClientProfileView } from "@rental-os/shared";
import { changePassword } from "../../api/auth";
import { fetchProfile, updateProfile } from "../../api/profile";
import { describeError } from "../../core/errors";
import { type FieldErrors, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { cachedMerchant } from "../../core/merchant";
import { ROUTES, callPhone, requireSignIn, toast } from "../../core/ui";

/**
 * P13 个人资料与账号设置（需求 §5.3）：姓名、邮箱可改；手机号/证件脱敏只读；修改密码。
 * 首期无自助换绑手机号，提供联系商户说明。
 */
interface ProfileData {
  view: ViewState;
  profile?: ClientProfileView;
  name: string;
  email: string;
  saving: boolean;
  errors: FieldErrors;
  formError: string;
  servicePhone: string;
  showPassword: boolean;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirm: string;
  passwordSaving: boolean;
  passwordError: string;
}

Page({
  data: {
    view: loadingState(),
    name: "",
    email: "",
    saving: false,
    errors: {},
    formError: "",
    servicePhone: "",
    showPassword: false,
    currentPassword: "",
    newPassword: "",
    newPasswordConfirm: "",
    passwordSaving: false,
    passwordError: ""
  } as ProfileData,

  onLoad() {
    this.setData({ servicePhone: cachedMerchant()?.servicePhone ?? "" });
    if (!requireSignIn(ROUTES.profile)) return;
  },

  onShow() {
    void this.load();
  },

  async load() {
    try {
      const profile = await fetchProfile();
      this.setData({ view: readyState(), profile, name: profile.name, email: profile.email ?? "" });
    } catch (error) {
      this.setData({ view: errorState(error) });
    }
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field);
    this.setData({ [field]: String(event.detail.value ?? ""), [`errors.${field}`]: "", formError: "", passwordError: "" });
  },

  async onSave() {
    if (this.data.saving) return;
    const errors: FieldErrors = {};
    const name = this.data.name.trim();
    const email = this.data.email.trim();
    if (!name) errors.name = "姓名不能为空";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "邮箱格式不正确";
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    this.setData({ saving: true, formError: "" });
    try {
      const profile = await updateProfile({ name, email: email || null });
      this.setData({ profile, name: profile.name, email: profile.email ?? "" });
      toast("已保存", { icon: "success" });
    } catch (error) {
      this.setData({ formError: describeError(error).message });
    } finally {
      this.setData({ saving: false });
    }
  },

  onTogglePassword() {
    this.setData({ showPassword: !this.data.showPassword, passwordError: "" });
  },

  async onChangePassword() {
    if (this.data.passwordSaving) return;
    const { currentPassword, newPassword, newPasswordConfirm } = this.data;
    if (!currentPassword) {
      this.setData({ passwordError: "请输入当前密码" });
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      this.setData({ passwordError: "新密码需 8-128 位，且同时包含字母和数字" });
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      this.setData({ passwordError: "两次输入的新密码不一致" });
      return;
    }
    this.setData({ passwordSaving: true, passwordError: "" });
    try {
      await changePassword(currentPassword, newPassword);
      this.setData({ showPassword: false, currentPassword: "", newPassword: "", newPasswordConfirm: "" });
      toast("密码已更新", { icon: "success" });
    } catch (error) {
      const presented = describeError(error);
      this.setData({ passwordError: presented.code === "UNAUTHENTICATED" ? "当前密码不正确" : presented.message });
    } finally {
      this.setData({ passwordSaving: false });
    }
  },

  onContact() {
    callPhone(this.data.servicePhone);
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.profile, servicePhone: this.data.servicePhone })) return;
    void this.load();
  }
});
