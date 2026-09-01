import { ApartmentOutlined, LockOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Form, Input, Space, Typography } from "antd";
import { isAxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import { AppearanceSwitcher } from "@/components/AppearanceSwitcher";
import { useAuthStore } from "./authStore";

type LoginValues = { tenantCode: string; account: string; password: string };

const LOCAL_DEMO_ACCOUNTS = [
  { label: "演示香港租户管理员", tenantCode: "demo", account: "admin" },
  { label: "演示深圳租户管理员", tenantCode: "demo2", account: "admin" },
  { label: "SaaS 平台管理员", tenantCode: "platform", account: "admin" },
] as const;

export function LoginPage() {
  const [form] = Form.useForm<LoginValues>();
  const { message } = App.useApp();
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  const fillLocalDemoAccount = (demo: (typeof LOCAL_DEMO_ACCOUNTS)[number]) => {
    form.setFieldsValue({ tenantCode: demo.tenantCode, account: demo.account, password: "" });
    message.info("已填入示例群组与账号，请输入本机初始化时配置的密码");
  };

  return (
    <div className="login-stage">
      <div className="login-frame">
        <header className="login-header">
          <div className="login-brand"><span><ApartmentOutlined /></span><b>Rental OS</b></div>
          <AppearanceSwitcher showLabel />
        </header>
        <main className="login-workspace">
          <Card className="login-panel">
            <div className="login-panel-heading">
              <Typography.Title level={2}>登录运营台</Typography.Title>
              <Typography.Paragraph type="secondary">使用租户账号进入对应品类的租赁工作区。</Typography.Paragraph>
            </div>
          <Form form={form} layout="vertical" requiredMark={false} onFinish={async (values) => {
              try {
                await login(values.tenantCode, values.account, values.password);
                message.success("登录成功");
                navigate(useAuthStore.getState().user?.isSaasAdmin ? "/platform/tenants" : "/workbench", { replace: true });
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
                message="本地开发示例群组"
                description={(
                  <div>
                    <Typography.Paragraph>
                      点击可填入群组和账号。密码不写入前端源码，请使用本机初始化时设置的
                      <Typography.Text code> SEED_DEMO_PASSWORD </Typography.Text>
                      或
                      <Typography.Text code> SEED_PLATFORM_PASSWORD </Typography.Text>
                      （兼容对应的 <Typography.Text code>E2E_*</Typography.Text> 变量）。
                    </Typography.Paragraph>
                    <Space className="login-demo-accounts" wrap>
                      {LOCAL_DEMO_ACCOUNTS.map((demo) => (
                        <Button key={`${demo.tenantCode}:${demo.account}`} size="small" onClick={() => fillLocalDemoAccount(demo)}>
                          {demo.label}（{demo.tenantCode} / {demo.account}）
                        </Button>
                      ))}
                    </Space>
                  </div>
                )}
              />
            ) : null}
            <Typography.Text className="login-support" type="secondary">登录即表示你正在访问获授权的租户数据范围。</Typography.Text>
          </Card>
        </main>
      </div>
    </div>
  );
}
