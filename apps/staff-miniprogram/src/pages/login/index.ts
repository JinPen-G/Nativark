import { login } from "../../api/auth";
import { loadContext } from "../../core/context";
import { describeError } from "../../core/errors";
import { type FieldErrors } from "../../core/page";
import { currentSession, isSignedIn, lastTenantCode } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, relaunch, safeRoute, toast } from "../../core/ui";
import { configProblem } from "../../config/public";

/**
 * S01 登录：租户编码 + 运营账号 + 密码。一套小程序服务所有租户，租户编码由员工输入（记住上次输入，不记密码）。
 * 登录后：多个经营空间 → 选择工作范围页；一个空间 → 直接进工作台；需改密 → 修改密码页。
 */
interface LoginData {
  tenantCode: string;
  account: string;
  password: string;
  showPassword: boolean;
  submitting: boolean;
  errors: FieldErrors;
  formError: string;
  configError: string;
  redirect: string;
}

Page({
  behaviors: [themeBehavior],
  data: {
    tenantCode: "",
    account: "",
    password: "",
    showPassword: false,
    submitting: false,
    errors: {},
    formError: "",
    configError: "",
    redirect: ""
  } as LoginData,

  onLoad(query: Record<string, string>) {
    this.setData({ tenantCode: lastTenantCode(), configError: configProblem() ?? "", redirect: safeRoute(query.redirect, ROUTES.workbench) });
    // 已登录且会话有效时不重复登录（例如从深层页面被踢回来又恢复了）。
    if (isSignedIn() && !query.force) this.enter();
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field);
    this.setData({ [field]: String(event.detail.value ?? ""), [`errors.${field}`]: "", formError: "" });
  },

  onTogglePassword() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const errors: FieldErrors = {};
    const tenantCode = this.data.tenantCode.trim();
    const account = this.data.account.trim();
    if (!tenantCode) errors.tenantCode = "请输入租户编码";
    else if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenantCode)) errors.tenantCode = "租户编码只能包含字母、数字、下划线或短横线";
    if (!account) errors.account = "请输入账号";
    if (!this.data.password) errors.password = "请输入密码";
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    this.setData({ submitting: true, formError: "" });
    try {
      await login(tenantCode, account, this.data.password);
      this.setData({ password: "" });
      await this.enter();
    } catch (error) {
      const presented = describeError(error);
      this.setData({ formError: presented.code === "UNAUTHENTICATED" || presented.code === "BAD_REQUEST" ? "租户编码、账号或密码不正确" : presented.message });
    } finally {
      this.setData({ submitting: false });
    }
  },

  /** 登录后的去向：改密 → 多空间选择 → 工作台。 */
  async enter() {
    const session = currentSession();
    if (!session) return;
    if (session.user.mustChangePassword) {
      relaunch(buildUrl(ROUTES.password, { forced: "1" }));
      return;
    }
    const activeWorkspaces = session.workspaces.filter((row) => row.status === "enabled" || row.status === "active");
    const candidates = activeWorkspaces.length ? activeWorkspaces : session.workspaces;
    if (candidates.length === 0) {
      this.setData({ formError: "该账号没有可进入的经营空间，请联系租户管理员分配权限" });
      return;
    }
    if (candidates.length > 1 && !session.currentWorkspaceId) {
      relaunch(buildUrl(ROUTES.workspace, { redirect: this.data.redirect }));
      return;
    }
    if (candidates.length > 1) {
      // 多空间但服务端已有当前空间：先进去，顶部可随时切换。
      relaunch(buildUrl(ROUTES.workspace, { redirect: this.data.redirect }));
      return;
    }
    try {
      await loadContext(true);
    } catch (error) {
      toast(describeError(error).message, { duration: 3000 });
    }
    relaunch(this.data.redirect || ROUTES.workbench);
  }
});
