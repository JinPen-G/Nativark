import { changePassword } from "../../api/auth";
import { describeError } from "../../core/errors";
import { isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, relaunch, toast } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { currentPassword: "", newPassword: "", confirmPassword: "", forced: false, busy: false, error: "" },
  onLoad(query: Record<string, string>) { this.setData({ forced: query.forced === "1" }); },
  onShow() { if (!isSignedIn()) relaunch(ROUTES.login); },
  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field);
    this.setData({ [field]: String(event.detail.value ?? ""), error: "" });
  },
  async onSave() {
    if (this.data.busy) return;
    const current = this.data.currentPassword;
    const next = this.data.newPassword;
    if (!current || !next) { this.setData({ error: "请填写当前密码和新密码" }); return; }
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) { this.setData({ error: "新密码至少 8 位，且包含字母和数字" }); return; }
    if (next !== this.data.confirmPassword) { this.setData({ error: "两次输入的新密码不一致" }); return; }
    this.setData({ busy: true, error: "" });
    try {
      await changePassword(current, next);
      this.setData({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast("密码已更新", { icon: "success" });
      if (this.data.forced) relaunch(ROUTES.workbench);
      else wx.navigateBack({ delta: 1, fail: () => relaunch(ROUTES.me) });
    } catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  }
});
