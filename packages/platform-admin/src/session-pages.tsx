/** 公共登录与改密呈现，保留原表单/SaveButton 单次提交；凭据及会话变化由宿主端口执行。 */
import { useRef, useState } from "react";
import type { ChangePasswordRequest } from "@rental-os/platform-contracts";
import { Alert, Form, Input, SaveButton } from "./components/ui";
import { useLocale } from "./app/locale";
import { UnsavedChangesGuard } from "./components/UnsavedChangesGuard";

export { AdminLoginPage } from "./features/auth/LoginPage";
export type { AdminLoginBrand, AdminLoginDisplay, AdminLoginPageProps } from "./features/auth/LoginPage";
export { resolveLoginTenantCode } from "./features/auth/login-entry";

export function AdminPasswordPage({ onChange, embedded = false }: { onChange: (input: ChangePasswordRequest) => Promise<void>; embedded?: boolean }) {
  const [form] = Form.useForm<ChangePasswordRequest & { confirmation: string }>();
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pending = useRef<Promise<void> | null>(null);
  const { locale } = useLocale(), english = locale === "en-US";
  function submit(values: ChangePasswordRequest) {
    if (pending.current) return pending.current;
    setError(false); setBusy(true);
    const request = Promise.resolve().then(() => onChange({ currentPassword: values.currentPassword, newPassword: values.newPassword }))
      .then(() => { setDirty(false); form.resetFields(); })
      .catch(failure => { setError(true); throw failure; }).finally(() => { pending.current = null; setBusy(false); });
    pending.current = request;
    return request;
  }
  const content = <div className="password-change-panel">
    {!embedded && <h2>{english ? "Set your new password" : "请设置新密码"}</h2>}
    <Alert type="info" showIcon title={english ? "At least 8 characters, with letters, numbers and symbols." : "至少 8 位，并同时包含字母、数字和特殊字符。"} />
    {error && <Alert type="error" title={english ? "Password change failed. Verify the current password and try again." : "密码修改失败，请核对当前密码和新密码强度。"} />}
    <Form form={form} layout="vertical" requiredMark={false} disabled={busy} onValuesChange={() => setDirty(true)}
      onFinish={values => { void submit(values).catch(() => undefined); }}>
      <Form.Item name="currentPassword" label={english ? "Current password" : "当前密码"} rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
      <Form.Item name="newPassword" label={english ? "New password" : "新密码"} rules={[{ required: true }, { min: 8 }, { pattern: /[a-z]/i }, { pattern: /\d/ }, { pattern: /[^a-z0-9]/i }]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Form.Item name="confirmation" label={english ? "Confirm new password" : "确认新密码"} dependencies={["newPassword"]}
        rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, value) => value === getFieldValue("newPassword") ? Promise.resolve()
          : Promise.reject(new Error(english ? "Passwords do not match." : "两次密码不一致。")) })]}><Input.Password autoComplete="new-password" /></Form.Item>
      <SaveButton form={form} label={english ? "Save password" : "保存密码"} onSave={submit} pending={busy} style={{ width: "100%" }} />
    </Form><UnsavedChangesGuard dirty={dirty} busy={busy} />
  </div>;
  return embedded ? content : <div className="password-change-stage">{content}</div>;
}

export { PasswordChangeGate } from "./features/auth/PasswordChangeGate";
export { AuthCodePreview } from "./features/auth/AuthCodePreview";
export { GoogleBrandIcon } from "./features/auth/LoginProviderIcons";
export { LoginShowcase } from "./features/auth/login-showcase/LoginShowcase";
