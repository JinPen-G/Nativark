import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Form, Input, Modal, Space, Typography } from "antd";
import { isAxiosError } from "axios";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { clientChannelApi } from "@/api/clientChannel";
import { ADMIN_BRAND_NAME, ADMIN_DEFAULT_LOGO, applyAdminFavicon } from "@/app/branding";
import { useLocale } from "@/app/locale";
import { AppearanceSwitcher } from "@/components/AppearanceSwitcher";
import { api } from "@/api/platform";
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
  const { locale, t } = useLocale();
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const [demoPasswordOpen, setDemoPasswordOpen] = useState(false);
  const [resettingDemoPassword, setResettingDemoPassword] = useState(false);
  const watchedTenantCode = Form.useWatch("tenantCode", form)?.trim().toLowerCase();
  const publicBootstrap = useQuery({
    queryKey: ["public-admin-brand", watchedTenantCode],
    queryFn: () => clientChannelApi.getPublicBootstrap(watchedTenantCode as string),
    enabled: Boolean(watchedTenantCode && /^[a-z][a-z0-9_-]{1,31}$/u.test(watchedTenantCode)),
    retry: false,
    staleTime: 5 * 60 * 1000
  });
  const loginBrandName = publicBootstrap.data?.merchant.name?.trim() || ADMIN_BRAND_NAME;
  const loginBrandLogo = publicBootstrap.data?.merchant.logoUrl?.trim() || ADMIN_DEFAULT_LOGO;

  useEffect(() => {
    document.title = locale === "en-US"
      ? loginBrandName === ADMIN_BRAND_NAME ? "Admin Console · Rental OS" : `${loginBrandName} Admin Console`
      : loginBrandName === ADMIN_BRAND_NAME ? "登录运营台 · Rental OS" : `登录${loginBrandName}运营台`;
    applyAdminFavicon(publicBootstrap.data?.merchant.faviconUrl);
  }, [locale, loginBrandName, publicBootstrap.data?.merchant.faviconUrl]);

  const fillLocalDemoAccount = (demo: (typeof LOCAL_DEMO_ACCOUNTS)[number]) => {
    form.setFieldsValue({ tenantCode: demo.tenantCode, account: demo.account, password: "" });
    message.info(t("已填入示例群组与账号，请输入本机初始化时配置的密码"));
  };

  const resetLocalDemoPassword = async () => {
    const values = await demoPasswordForm.validateFields();
    setResettingDemoPassword(true);
    try {
      await api.resetLocalDemoPassword({ password: values.password });
      form.setFieldsValue({ password: values.password });
      demoPasswordForm.resetFields();
      setDemoPasswordOpen(false);
      message.success(t("演示账号密码已设置。选择示例账号后即可登录。"));
    } catch {
      message.error(t("未能设置演示账号密码，请确认本机开发服务和数据库已启动。"));
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
            <div className="login-brand"><img src={loginBrandLogo} alt={loginBrandName} /></div>
            <div className="login-panel-heading">
              <Typography.Title level={2}>{locale === "en-US" ? loginBrandName === ADMIN_BRAND_NAME ? "Admin Console" : `${loginBrandName} Admin Console` : loginBrandName === ADMIN_BRAND_NAME ? "登录运营台" : `登录${loginBrandName}运营台`}</Typography.Title>
              <Typography.Paragraph type="secondary">{t("使用租户账号进入对应品类的租赁工作区。")}</Typography.Paragraph>
            </div>
          <Form form={form} layout="vertical" requiredMark={false} onFinish={async (values) => {
              try {
                const result = await login(values.tenantCode, values.account, values.password);
                message.success(t("登录成功"));
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
                let errorMessage = t("登录失败，请检查租户、账号和密码");
                if (isAxiosError(error)) {
                  if (!error.response) errorMessage = t("无法连接 API，请确认开发服务已启动");
                  else if (error.response.status >= 500) errorMessage = t("服务暂不可用，请检查 API 与数据库配置");
                }
                message.error(errorMessage);
              }
            }}>
              <Form.Item label={t("租户编码")} name="tenantCode" rules={[{ required: true, message: t("请输入租户编码") }]}><Input prefix={<SafetyCertificateOutlined />} autoComplete="organization" /></Form.Item>
              <Form.Item label={t("账号")} name="account" rules={[{ required: true, message: t("请输入账号") }]}><Input prefix={<UserOutlined />} autoComplete="username" /></Form.Item>
              <Form.Item label={t("密码")} name="password" rules={[{ required: true, message: t("请输入密码") }]}><Input.Password prefix={<LockOutlined />} autoComplete="current-password" /></Form.Item>
              <Button type="primary" htmlType="submit" block>{t("进入工作台")}</Button>
            </Form>
            {import.meta.env.DEV ? (
              <Alert
                className="login-demo-hints"
                type="info"
                showIcon
                title={t("本地开发示例群组")}
                description={(
                  <div>
                    <Typography.Paragraph>
                      {t("点击可填入群组和账号。不记得密码时，直接在这里重新设置一次即可。")}
                    </Typography.Paragraph>
                    <Space className="login-demo-accounts" wrap>
                      {LOCAL_DEMO_ACCOUNTS.map((demo) => (
                        <Button key={`${demo.tenantCode}:${demo.account}`} size="small" onClick={() => fillLocalDemoAccount(demo)}>
                          {t(demo.label)}（{demo.tenantCode} / {demo.account}）
                        </Button>
                      ))}
                      <Button type="link" size="small" onClick={() => setDemoPasswordOpen(true)}>
                        {t("设置演示账号密码")}
                      </Button>
                    </Space>
                  </div>
                )}
              />
            ) : null}
            <Typography.Text className="login-support" type="secondary">{t("登录即表示你正在访问获授权的租户数据范围。")}</Typography.Text>
          </Card>
        </main>
      </div>
      <Modal
        title={t("设置本地演示账号密码")}
        open={demoPasswordOpen}
        destroyOnHidden
        okText={t("保存密码")}
        cancelText={t("取消")}
        confirmLoading={resettingDemoPassword}
        onCancel={() => {
          demoPasswordForm.resetFields();
          setDemoPasswordOpen(false);
        }}
        onOk={() => void resetLocalDemoPassword()}
      >
        <Typography.Paragraph type="secondary">
          {t("这只会修改本机开发数据库中的演示账号；三个示例账号将使用同一个新密码。")}
        </Typography.Paragraph>
        <Form form={demoPasswordForm} component={false} layout="vertical" requiredMark={false}>
          <Form.Item label={t("新密码")} name="password" rules={[
            { required: true, message: t("请设置密码") },
            { min: 8, message: t("密码至少 8 位") },
            { pattern: /[a-z]/i, message: t("密码需包含字母") },
            { pattern: /\d/, message: t("密码需包含数字") },
            { pattern: /[^a-z0-9]/i, message: t("密码需包含特殊字符") }
          ]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item label={t("确认密码")} name="confirmPassword" dependencies={["password"]} rules={[
            { required: true, message: t("请再次输入密码") },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return !value || getFieldValue("password") === value
                  ? Promise.resolve()
                  : Promise.reject(new Error(t("两次输入的密码不一致")));
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
