import { themeBehavior } from "../../core/theme-behavior";
import type { ClientProfileView } from "@rental-os/shared";
import { changePassword } from "../../api/auth";
import { fetchProfile, updateProfile } from "../../api/profile";
import { PUBLIC_CONFIG } from "../../config/public";
import { describeError } from "../../core/errors";
import { ApiError } from "../../core/http";
import { type FieldErrors, blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { cachedMerchant } from "../../core/merchant";
import { contextVersion, currentService, currentSession, sessionEvents } from "../../core/session";
import { ROUTES, callPhone, requireSignIn, toast } from "../../core/ui";
import { currentTheme, setThemePreference, themePreference } from "../../core/theme";

/**
 * P13 个人资料与账号设置（需求 §5.3）：姓名、邮箱可改；手机号/证件脱敏只读；修改密码。
 * 只消费当前账号、服务及可见页面的应答；隐藏或身份变化撤回资料与输入。
 * 保存/改密仍走原接口，未知应答不重发；首期换绑手机号仍联系商户。
 */
interface ProfileData {
  view: ViewState;
  profile: ClientProfileView | null;
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
  darkMode: boolean;
  themeModeHint: string;
}

interface ProfileLifetime {
  visible: boolean;
  disposed: boolean;
  generation: number;
  binding: string;
  initialized: boolean;
  reading: boolean;
  write: { kind: "profile" | "password" } | null;
  unsubscribe?: () => void;
}
const lifetimes = new WeakMap<object, ProfileLifetime>();
const editableFields = new Set(["name", "email", "currentPassword", "newPassword", "newPasswordConfirm"]);
const loginView = () => blockedState("需要登录", "请先登录后查看本人资料。", "去登录", "login");

function profileBinding(): string {
  const session = currentSession(), service = currentService();
  if (!session?.accessToken || !service) return "";
  // Token refresh alone does not discard human edits. Sign-out/re-login and
  // scope changes advance the original context; membership is checked too.
  return JSON.stringify([PUBLIC_CONFIG.tenantCode, contextVersion(), session.customer.customerId,
    session.customer.customerType, session.serviceCode, service.categoryCode, service.membershipStatus]);
}
function matchesCurrentProfile(profile: ClientProfileView): boolean {
  const session = currentSession(), service = currentService();
  return !!session && !!service && profile?.customerId === session.customer.customerId
    && profile.customerType === session.customer.customerType && profile.workspace?.workspaceCode === service.code
    && profile.workspace.categoryCode === service.categoryCode && profile.workspace.membershipStatus === service.membershipStatus;
}
function accessChanged(error: unknown): boolean {
  return ["AUTH_REQUIRED", "AUTH_EXPIRED", "UNAUTHENTICATED", "FORBIDDEN", "STALE_CONTEXT"].includes(describeError(error).code);
}
function uncertainWrite(error: unknown): boolean {
  return ["NETWORK", "TIMEOUT", "SERVER", "INVALID_RESPONSE", "UNKNOWN"].includes(describeError(error).code);
}

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    profile: null,
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
    passwordError: "",
    darkMode: currentTheme() === "dark",
    themeModeHint: themePreference() === "system" ? "跟随系统" : currentTheme() === "dark" ? "已固定为深色模式" : "已固定为浅色模式"
  } as ProfileData,

  onLoad() {
    lifetimes.set(this, { visible: true, disposed: false, generation: 0, binding: profileBinding(),
      initialized: false, reading: false, write: null });
    this.syncThemePreference();
    this.setData({ servicePhone: cachedMerchant()?.servicePhone ?? "" });
    if (!requireSignIn(ROUTES.profile)) this.withdrawProfile(loginView());
  },

  onShow() {
    const lifetime = lifetimes.get(this);
    if (!lifetime || lifetime.disposed) return;
    lifetime.visible = true;
    if (lifetime.binding !== profileBinding()) this.withdrawProfile();
    lifetime.unsubscribe?.();
    lifetime.unsubscribe = sessionEvents.on(() => {
      if (lifetimes.get(this) !== lifetime || !lifetime.visible || lifetime.disposed) return;
      if (lifetime.binding !== profileBinding()) this.withdrawProfile(profileBinding()
        ? blockedState("本人资料已撤回", "当前账号或服务已变化，请重新读取。", "重新读取", "refresh") : loginView());
    });
    this.syncThemePreference();
    if (!requireSignIn(ROUTES.profile)) { this.withdrawProfile(loginView()); return; }
    if (lifetime.write) {
      this.setData({ view: blockedState("原资料操作待核对", "请等待当前请求结束后重新读取，不重复提交。", "重新读取", "refresh"),
        saving: lifetime.write.kind === "profile", passwordSaving: lifetime.write.kind === "password" });
      return;
    }
    void this.load();
  },

  onHide() {
    const lifetime = lifetimes.get(this);
    if (!lifetime) return;
    lifetime.visible = false;
    lifetime.unsubscribe?.(); lifetime.unsubscribe = undefined;
    this.withdrawProfile();
  },

  onUnload() {
    const lifetime = lifetimes.get(this);
    if (!lifetime) return;
    lifetime.visible = false;
    lifetime.unsubscribe?.(); lifetime.unsubscribe = undefined;
    this.withdrawProfile();
    lifetime.disposed = true;
    lifetimes.delete(this);
  },

  withdrawProfile(view: ViewState = loadingState()) {
    const lifetime = lifetimes.get(this);
    if (!lifetime || lifetime.disposed) return;
    lifetime.generation++; lifetime.binding = profileBinding(); lifetime.reading = false; lifetime.initialized = false;
    this.setData({ view, profile: null, name: "", email: "", errors: {}, formError: "", saving: false,
      showPassword: false, currentPassword: "", newPassword: "", newPasswordConfirm: "", passwordError: "", passwordSaving: false });
  },

  profileCurrent(generation: number, binding: string): boolean {
    const lifetime = lifetimes.get(this);
    if (!lifetime || lifetime.disposed || !lifetime.visible || lifetime.generation !== generation) return false;
    if (!binding || profileBinding() !== binding) {
      this.withdrawProfile(profileBinding()
        ? blockedState("本人资料已撤回", "当前账号或服务已变化，请重新读取。", "重新读取", "refresh") : loginView());
      return false;
    }
    return true;
  },

  syncThemePreference() {
    const preference = themePreference();
    const darkMode = currentTheme() === "dark";
    this.setData({
      darkMode,
      themeModeHint: preference === "system" ? "跟随系统" : darkMode ? "已固定为深色模式" : "已固定为浅色模式"
    });
  },

  onThemeModeChange(event: WechatMiniprogram.SwitchChange) {
    const darkMode = Boolean(event.detail.value);
    setThemePreference(darkMode ? "dark" : "light");
    this.setData({ darkMode, themeModeHint: darkMode ? "已固定为深色模式" : "已固定为浅色模式" });
  },

  async load() {
    const lifetime = lifetimes.get(this), binding = profileBinding();
    if (!lifetime || lifetime.disposed || !lifetime.visible) return;
    if (lifetime.binding !== binding) this.withdrawProfile();
    if (!binding) { this.withdrawProfile(loginView()); return; }
    if (lifetime.reading || lifetime.write) return;
    const generation = lifetime.generation;
    lifetime.reading = true;
    this.setData({ view: loadingState(), profile: null });
    try {
      const profile = await fetchProfile();
      if (!this.profileCurrent(generation, binding)) return;
      if (!matchesCurrentProfile(profile)) throw new ApiError("STALE_CONTEXT", "返回资料与当前账号或服务不一致。");
      // Same-owner refresh replaces only read facts. Human edits survive the
      // refresh; a hidden or retired owner has already cleared those inputs.
      const first = !lifetime.initialized;
      lifetime.initialized = true;
      this.setData({ view: readyState(), profile, ...(first ? { name: profile.name, email: profile.email ?? "" } : {}) });
    } catch (error) {
      if (!this.profileCurrent(generation, binding)) return;
      if (accessChanged(error)) this.withdrawProfile(errorState(error));
      else {
        const view = errorState(error);
        if (describeError(error).code === "NETWORK") view.message = "本人资料未能重新读取，请检查网络后重试。";
        this.setData({ view, profile: null, showPassword: false, currentPassword: "", newPassword: "", newPasswordConfirm: "", passwordError: "" });
      }
    } finally {
      if (lifetimes.get(this) === lifetime && lifetime.generation === generation) lifetime.reading = false;
    }
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field);
    const lifetime = lifetimes.get(this);
    if (!lifetime || lifetime.write || this.data.view.status !== "ready" || !this.data.profile
      || !editableFields.has(field) || !this.profileCurrent(lifetime.generation, lifetime.binding)) return;
    this.setData({ [field]: String(event.detail.value ?? ""), [`errors.${field}`]: "", formError: "", passwordError: "" });
  },

  async onSave() {
    const lifetime = lifetimes.get(this);
    if (!lifetime || lifetime.write || lifetime.reading || !this.data.profile || this.data.view.status !== "ready"
      || !this.profileCurrent(lifetime.generation, lifetime.binding)) return;
    const generation = lifetime.generation, binding = lifetime.binding;
    const errors: FieldErrors = {};
    const name = this.data.name.trim();
    const email = this.data.email.trim();
    if (!name) errors.name = "姓名不能为空";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "邮箱格式不正确";
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    const write = { kind: "profile" as const }; lifetime.write = write;
    this.setData({ saving: true, formError: "" });
    try {
      const profile = await updateProfile({ name, email: email || null });
      if (!this.profileCurrent(generation, binding)) return;
      if (!matchesCurrentProfile(profile)) throw new ApiError("STALE_CONTEXT", "返回资料与当前账号或服务不一致。");
      this.setData({ profile, name: profile.name, email: profile.email ?? "" });
      toast("已保存", { icon: "success" });
    } catch (error) {
      if (!this.profileCurrent(generation, binding)) return;
      if (accessChanged(error)) this.withdrawProfile(errorState(error));
      else if (uncertainWrite(error)) this.setData({ profile: null, view: blockedState("资料保存结果待核对",
        "请重新读取本人资料或联系商户，不要重复提交。", "核对本人资料", "refresh"),
        showPassword: false, currentPassword: "", newPassword: "", newPasswordConfirm: "", passwordError: "" });
      else this.setData({ formError: describeError(error).message });
    } finally {
      if (lifetime.write === write) {
        lifetime.write = null;
        if (lifetimes.get(this) === lifetime && lifetime.visible && !lifetime.disposed) this.setData({ saving: false });
      }
    }
  },

  onTogglePassword() {
    const lifetime = lifetimes.get(this);
    if (!lifetime || lifetime.write || !this.data.profile || this.data.view.status !== "ready"
      || !this.profileCurrent(lifetime.generation, lifetime.binding)) return;
    this.setData({ showPassword: !this.data.showPassword, passwordError: "" });
  },

  async onChangePassword() {
    const lifetime = lifetimes.get(this);
    if (!lifetime || lifetime.write || lifetime.reading || !this.data.profile || this.data.view.status !== "ready"
      || !this.profileCurrent(lifetime.generation, lifetime.binding)) return;
    const generation = lifetime.generation, binding = lifetime.binding;
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
    const write = { kind: "password" as const }; lifetime.write = write;
    this.setData({ passwordSaving: true, passwordError: "" });
    try {
      await changePassword(currentPassword, newPassword);
      if (!this.profileCurrent(generation, binding)) return;
      this.setData({ showPassword: false, currentPassword: "", newPassword: "", newPasswordConfirm: "" });
      toast("密码已更新", { icon: "success" });
    } catch (error) {
      if (!this.profileCurrent(generation, binding)) return;
      const presented = describeError(error);
      if (accessChanged(error) && presented.code !== "UNAUTHENTICATED") this.withdrawProfile(errorState(error));
      else if (uncertainWrite(error)) this.setData({ profile: null, view: blockedState("改密结果待核对",
        "请通过原登录流程或联系商户核对，不要重复提交。", "联系商户", "contact"),
        showPassword: false, currentPassword: "", newPassword: "", newPasswordConfirm: "", passwordError: "" });
      else this.setData({ passwordError: presented.code === "UNAUTHENTICATED" ? "当前密码不正确" : presented.message,
        currentPassword: "", newPassword: "", newPasswordConfirm: "" });
    } finally {
      if (lifetime.write === write) {
        lifetime.write = null;
        if (lifetimes.get(this) === lifetime && lifetime.visible && !lifetime.disposed) this.setData({ passwordSaving: false });
      }
    }
  },

  onContact() {
    callPhone(this.data.servicePhone);
  },

  onViewAction() {
    const lifetime = lifetimes.get(this);
    if (!lifetime || !lifetime.visible || lifetime.disposed) return;
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.profile, servicePhone: this.data.servicePhone })) return;
    void this.load();
  }
});
