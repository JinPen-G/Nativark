import { LockOutlined } from "@ant-design/icons";
import { Alert, App, Button, Form, Input, Typography } from "antd";
import { useState } from "react";
import { useAuthStore } from "./authStore";

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
}

export function PasswordChangeGate() {
  const { message } = App.useApp();
  const changePassword = useAuthStore((state) => state.changePassword);
  const [submitting, setSubmitting] = useState(false);

  async function submit(values: PasswordForm) {
    setSubmitting(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      message.success("密码已更新，当前会话已重新签发");
    } catch {
      message.error("密码修改失败，请检查当前密码和新密码强度");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="password-change-stage">
      <div className="password-change-panel">
        <div className="password-change-icon"><LockOutlined /></div>
        <Typography.Title level={2}>首次登录，请设置新密码</Typography.Title>
        <Typography.Paragraph type="secondary">
          临时密码只能用于首次登录。更新后，其他旧会话会立即失效。
        </Typography.Paragraph>
        <Alert type="info" showIcon title="至少 8 位，并同时包含字母、数字和特殊字符" />
        <Form<PasswordForm> layout="vertical" requiredMark={false} onFinish={submit}>
          <Form.Item name="currentPassword" label="当前临时密码" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true },
              { min: 8 },
              { pattern: /[a-z]/i, message: "必须包含字母" },
              { pattern: /\d/, message: "必须包含数字" },
              { pattern: /[^a-z0-9]/i, message: "必须包含特殊字符" }
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmation"
            label="确认新密码"
            dependencies={["newPassword"]}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || getFieldValue("newPassword") === value
                    ? Promise.resolve()
                    : Promise.reject(new Error("两次输入的密码不一致"));
                }
              })
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            保存并进入系统
          </Button>
        </Form>
      </div>
    </div>
  );
}
