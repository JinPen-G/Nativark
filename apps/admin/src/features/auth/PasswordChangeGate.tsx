import { LockOutlined } from "@/components/ui/icons";
import { Typography } from "antd";
import { App } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert } from "@/components/ui";
import { Input } from "@/components/ui";
import { SaveButton } from "@/components/ui";
import { useState } from "react";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "./authStore";

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
}

export function PasswordChangeGate() {
  const { message } = App.useApp();
  const { t } = useLocale();
  const changePassword = useAuthStore((state) => state.changePassword);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<PasswordForm>();

  async function submit(values: PasswordForm) {
    setSubmitting(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      message.success(t("密码已更新，当前会话已重新签发"));
      return true;
    } catch {
      message.error(t("密码修改失败，请检查当前密码和新密码强度"));
      throw new Error(t("密码修改失败"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="password-change-stage">
      <div className="password-change-panel">
        <div className="password-change-icon"><LockOutlined /></div>
        <Typography.Title level={2}>{t("首次登录，请设置新密码")}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {t("临时密码只能用于首次登录。更新后，其他旧会话会立即失效。")}
        </Typography.Paragraph>
        <Alert type="info" showIcon title={t("至少 8 位，并同时包含字母、数字和特殊字符")} />
        <Form<PasswordForm> form={form} layout="vertical" requiredMark={false} onFinish={(values) => { void submit(values).catch(() => undefined); }}>
          <Form.Item name="currentPassword" label={t("当前临时密码")} rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label={t("新密码")}
            rules={[
              { required: true },
              { min: 8 },
              { pattern: /[a-z]/i, message: t("必须包含字母") },
              { pattern: /\d/, message: t("必须包含数字") },
              { pattern: /[^a-z0-9]/i, message: t("必须包含特殊字符") }
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmation"
            label={t("确认新密码")}
            dependencies={["newPassword"]}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || getFieldValue("newPassword") === value
                    ? Promise.resolve()
                    : Promise.reject(new Error(t("两次输入的密码不一致")));
                }
              })
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <SaveButton form={form} label={t("保存并进入系统")} pending={submitting} onSave={submit} style={{ width: "100%" }} />
        </Form>
      </div>
    </div>
  );
}
