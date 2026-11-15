/** 公共登录与改密呈现，保留原表单/SaveButton 单次提交；凭据及会话变化由宿主端口执行。 */
import { useRef, useState } from "react";
import type { ChangePasswordRequest, LoginRequest } from "@rental-os/platform-contracts";
import { Alert, Form, Input, SaveButton } from "./components/ui";
import { useLocale } from "./app/locale";
import loginStyles from "@/registry/blocks/login-centered/login-centered.module.css";
import "./session-pages.css";

export function AdminLoginPage({ brandName, onLogin }: { brandName: string; onLogin: (input: LoginRequest) => Promise<unknown> }) {
  const [form] = Form.useForm<LoginRequest>();
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const pending = useRef<Promise<unknown> | null>(null);
  const { locale } = useLocale(), english = locale === "en-US";
  const submit = (input: LoginRequest) => {
    if (pending.current) return pending.current;
    setError(false); setBusy(true);
    const request = Promise.resolve().then(() => onLogin(input)).catch(failure => { setError(true); throw failure; })
      .finally(() => { pending.current = null; setBusy(false); });
    pending.current = request;
    return request;
  };
  return <div className="login-stage"><div className="login-frame"><main className="login-workspace">
    <div className="platform-login-card"><div className={loginStyles.card}>
      <div className="login-card-form"><div className="login-brand"><strong>{brandName}</strong></div>
        <div className="login-form-content"><div className="login-panel-heading"><h2>{english ? "Sign in" : "登录"}</h2>
          <p>{english ? "Use your tenant account to continue." : "使用租户账号进入管理后台。"}</p></div>
          {error && <Alert type="error" showIcon title={english ? "Sign in failed. Check your account or try again." : "登录失败，请核对账号或稍后重试。"} />}
          <Form form={form} layout="vertical" requiredMark={false} disabled={busy}
            onFinish={values => { void submit(values).catch(() => undefined); }}>
            <Form.Item name="tenantCode" label={english ? "Tenant code" : "租户编码"} rules={[{ required: true }]}><Input autoComplete="organization" /></Form.Item>
            <Form.Item name="account" label={english ? "Account" : "账号"} rules={[{ required: true }]}><Input autoComplete="username" /></Form.Item>
            <Form.Item name="password" label={english ? "Password" : "密码"} rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
            <SaveButton form={form} label={english ? "Sign in" : "登录"} pending={busy} onSave={submit} style={{ width: "100%" }} />
          </Form>
        </div>
      </div>
    </div></div>
  </main></div></div>;
}

export function AdminPasswordPage({ onChange }: { onChange: (input: ChangePasswordRequest) => Promise<void> }) {
  const [form] = Form.useForm<ChangePasswordRequest & { confirmation: string }>();
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const pending = useRef<Promise<void> | null>(null);
  const { locale } = useLocale(), english = locale === "en-US";
  function submit(values: ChangePasswordRequest) {
    if (pending.current) return pending.current;
    setError(false); setBusy(true);
    const request = Promise.resolve().then(() => onChange({ currentPassword: values.currentPassword, newPassword: values.newPassword }))
      .catch(failure => { setError(true); throw failure; }).finally(() => { pending.current = null; setBusy(false); });
    pending.current = request;
    return request;
  }
  return <div className="password-change-stage"><div className="password-change-panel">
    <h2>{english ? "Set your new password" : "请设置新密码"}</h2>
    <Alert type="info" showIcon title={english ? "At least 8 characters, with letters, numbers and symbols." : "至少 8 位，并同时包含字母、数字和特殊字符。"} />
    {error && <Alert type="error" title={english ? "Password change failed. Verify the current password and try again." : "密码修改失败，请核对当前密码和新密码强度。"} />}
    <Form form={form} layout="vertical" requiredMark={false} disabled={busy} onFinish={values => { void submit(values).catch(() => undefined); }}>
      <Form.Item name="currentPassword" label={english ? "Current password" : "当前密码"} rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
      <Form.Item name="newPassword" label={english ? "New password" : "新密码"} rules={[{ required: true }, { min: 8 }, { pattern: /[a-z]/i }, { pattern: /\d/ }, { pattern: /[^a-z0-9]/i }]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Form.Item name="confirmation" label={english ? "Confirm new password" : "确认新密码"} dependencies={["newPassword"]}
        rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, value) => value === getFieldValue("newPassword") ? Promise.resolve()
          : Promise.reject(new Error(english ? "Passwords do not match." : "两次密码不一致。")) })]}><Input.Password autoComplete="new-password" /></Form.Item>
      <SaveButton form={form} label={english ? "Save password" : "保存密码"} onSave={submit} pending={busy} style={{ width: "100%" }} />
    </Form>
  </div></div>;
}
