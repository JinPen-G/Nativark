import { ApartmentOutlined, LockOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Form, Input, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { AppearanceSwitcher } from "@/components/AppearanceSwitcher";
import { useAuthStore } from "./authStore";

export function LoginPage() {
  const [form] = Form.useForm<{ tenantCode: string; account: string; password: string }>();
  const { message } = App.useApp();
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

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
          <Alert type="info" showIcon message="租户演示：demo / admin / RentalDemo!2026；SaaS 管理：platform / admin / RentalOS!2026" />
          <Form form={form} layout="vertical" requiredMark={false} initialValues={{ tenantCode: "demo", account: "admin", password: "RentalDemo!2026" }} onFinish={async (values) => {
              try {
                await login(values.tenantCode, values.account, values.password);
                message.success("登录成功");
                navigate(useAuthStore.getState().user?.isSaasAdmin ? "/platform/tenants" : "/workbench", { replace: true });
              }
              catch { message.error("登录失败，请检查租户、账号和密码"); }
            }}>
              <Form.Item label="租户编码" name="tenantCode" rules={[{ required: true, message: "请输入租户编码" }]}><Input prefix={<SafetyCertificateOutlined />} autoComplete="organization" /></Form.Item>
              <Form.Item label="账号" name="account" rules={[{ required: true, message: "请输入账号" }]}><Input prefix={<UserOutlined />} autoComplete="username" /></Form.Item>
              <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}><Input.Password prefix={<LockOutlined />} autoComplete="current-password" /></Form.Item>
              <Button type="primary" htmlType="submit" block>进入工作台</Button>
            </Form>
            <Typography.Text className="login-support" type="secondary">登录即表示你正在访问获授权的租户数据范围。</Typography.Text>
          </Card>
        </main>
      </div>
    </div>
  );
}
