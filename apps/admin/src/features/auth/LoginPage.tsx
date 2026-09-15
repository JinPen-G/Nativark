import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Form, Input, Modal, Space, Typography } from "antd";
import { isAxiosError } from "axios";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppearanceSwitcher } from "@/components/AppearanceSwitcher";
import { api } from "@/api/rental";
import { useAuthStore } from "./authStore";

type LoginValues = { tenantCode: string; account: string; password: string };
type DemoPasswordValues = { password: string; confirmPassword: string };

const LOCAL_DEMO_ACCOUNTS = [
  { label: "演示香港租户管理员", tenantCode: "demo", account: "admin" },
  { label: "演示深圳租户管理员", tenantCode: "demo2", account: "admin" },
  { label: "SaaS 平台管理员", tenantCode: "platform", account: "admin" },
] as const;

export function LoginPage() {
  const [form] = Form.useForm<LoginValues>();
  const [demoPasswordForm] = Form.useForm<DemoPasswordValues>();
  const { message } = App.useApp();
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const [demoPasswordOpen, setDemoPasswordOpen] = useState(false);
  const [resettingDemoPassword, setResettingDemoPassword] = useState(false);

  const fillLocalDemoAccount = (demo: (typeof LOCAL_DEMO_ACCOUNTS)[number]) => {
    form.setFieldsValue({ tenantCode: demo.tenantCode, account: demo.account, password: "" });
    message.info("已填入示例群组与账号，请输入本机初始化时配置的密码");
  };

  const resetLocalDemoPassword = async () => {
    const values = await demoPasswordForm.validateFields();
    setResettingDemoPassword(true);
    try {
      await api.resetLocalDemoPassword({ password: values.password });
      form.setFieldsValue({ password: values.password });
      demoPasswordForm.resetFields();
      setDemoPasswordOpen(false);
      message.success("演示账号密码已设置。选择示例账号后即可登录。");
    } catch {
      message.error("未能设置演示账号密码，请确认本机开发服务和数据库已启动。");
    } finally {
      setResettingDemoPassword(false);
    }
  };

  return (
    <div className="login-stage">
      <div className="login-frame">
        {/* 外观开关浮在框角：顶栏已取消，登录页也不再单独留一条只为放它的横栏。 */}
        <div className="login-appearance"><AppearanceSwitcher iconOnly /></div>
        <main className="login-workspace">
          <Card className="login-panel">
            <div className="login-brand"><img src="/brand/logo-horizontal.png" alt="Rental OS" /></div>
            <div className="login-panel-heading">
              <Typography.Title level={2}>登录运营台</Typography.Title>
              <Typography.Paragraph type="secondary">使用租户账号进入对应品类的租赁工作区。</Typography.Paragraph>
            </div>
          <Form form={form} layout="vertical" requiredMark={false} onFinish={async (values) => {
              try {
                const result = await login(values.tenantCode, values.account, values.password);
                message.success("登录成功");
                navigate(
                  result.needsTenantOnboarding
                    ? "/tenant/readiness"
                    : result.user.isSaasAdmin
                      ? "/platform/tenants"
                      : "/workbench",
                  { replace: true }
                );
              }
              catch (error) {
                let errorMessage = "登录失败，请检查租户、账号和密码";
                if (isAxiosError(error)) {
                  if (!error.response) errorMessage = "无法连接 API，请确认开发服务已启动";
                  else if (error.response.status >= 500) errorMessage = "服务暂不可用，请检查 API 与数据库配置";
                }
                message.error(errorMessage);
              }
            }}>
              <Form.Item label="租户编码" name="tenantCode" rules={[{ required: true, message: "请输入租户编码" }]}><Input prefix={<SafetyCertificateOutlined />} autoComplete="organization" /></Form.Item>
              <Form.Item label="账号" name="account" rules={[{ required: true, message: "请输入账号" }]}><Input prefix={<UserOutlined />} autoComplete="username" /></Form.Item>
              <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}><Input.Password prefix={<LockOutlined />} autoComplete="current-password" /></Form.Item>
              <Button type="primary" htmlType="submit" block>进入工作台</Button>
            </Form>
            {import.meta.env.DEV ? (
              <Alert
                className="login-demo-hints"
                type="info"
                showIcon
                title="本地开发示例群组"
                description={(
                  <div>
                    <Typography.Paragraph>
                      点击可填入群组和账号。不记得密码时，直接在这里重新设置一次即可。
                    </Typography.Paragraph>
                    <Space className="login-demo-accounts" wrap>
                      {LOCAL_DEMO_ACCOUNTS.map((demo) => (
                        <Button key={`${demo.tenantCode}:${demo.account}`} size="small" onClick={() => fillLocalDemoAccount(demo)}>
                          {demo.label}（{demo.tenantCode} / {demo.account}）
                        </Button>
                      ))}
                      <Button type="link" size="small" onClick={() => setDemoPasswordOpen(true)}>
                        设置演示账号密码
                      </Button>
                    </Space>
                  </div>
                )}
              />
            ) : null}
            <Typography.Text className="login-support" type="secondary">登录即表示你正在访问获授权的租户数据范围。</Typography.Text>
          </Card>
        </main>
      </div>
      <Modal
        title="设置本地演示账号密码"
        open={demoPasswordOpen}
        destroyOnHidden
        okText="保存密码"
        cancelText="取消"
        confirmLoading={resettingDemoPassword}
        onCancel={() => {
          demoPasswordForm.resetFields();
          setDemoPasswordOpen(false);
        }}
        onOk={() => void resetLocalDemoPassword()}
      >
        <Typography.Paragraph type="secondary">
          这只会修改本机开发数据库中的演示账号；三个示例账号将使用同一个新密码。
        </Typography.Paragraph>
        <Form form={demoPasswordForm} component={false} layout="vertical" requiredMark={false}>
          <Form.Item label="新密码" name="password" rules={[
            { required: true, message: "请设置密码" },
            { min: 8, message: "密码至少 8 位" },
            { pattern: /[a-z]/i, message: "密码需包含字母" },
            { pattern: /\d/, message: "密码需包含数字" },
            { pattern: /[^a-z0-9]/i, message: "密码需包含特殊字符" }
          ]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="确认密码" name="confirmPassword" dependencies={["password"]} rules={[
            { required: true, message: "请再次输入密码" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return !value || getFieldValue("password") === value
                  ? Promise.resolve()
                  : Promise.reject(new Error("两次输入的密码不一致"));
              }
            })
          ]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
