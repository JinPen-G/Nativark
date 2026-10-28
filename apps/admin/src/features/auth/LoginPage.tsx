import { AppleOutlined, GoogleOutlined, WechatOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import { Modal } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, PasswordField, SaveButton, Segmented, useFeedback } from "@/components/ui";
import loginStyles from "@/registry/blocks/login-centered/login-centered.module.css";
import { AuthCodePreview } from "./AuthCodePreview";
import { isAxiosError } from "axios";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { clientChannelApi } from "@/api/clientChannel";
import { ADMIN_BRAND_NAME, ADMIN_DEFAULT_LOGO, ADMIN_LOGIN_DEFAULTS, applyAdminFavicon } from "@/app/branding";
import { apiAssetOrigin } from "@/api/http";
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

const TENANT_CODE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/u;

function LoginBackground({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <div className="login-brand-background" aria-hidden="true"><img src={src} alt="" onError={() => setFailed(true)} /></div>;
}

export function LoginPage() {
  const [form] = Form.useForm<LoginValues>();
  const [demoPasswordForm] = Form.useForm<DemoPasswordValues>();
  const { toast } = useFeedback();
  const { locale, t } = useLocale();
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  // 租户专属登录链接 /login/:tenantCode：租户编码来自 URL、不再要求手输，也不在页面上展示可编辑的租户编码框。
  const { tenantCode: urlTenantCode } = useParams<{ tenantCode?: string }>();
  const lockedTenantCode = urlTenantCode?.trim().toLowerCase();
  const isTenantLocked = Boolean(lockedTenantCode && TENANT_CODE_PATTERN.test(lockedTenantCode));
  const [demoPasswordOpen, setDemoPasswordOpen] = useState(false);
  const [resettingDemoPassword, setResettingDemoPassword] = useState(false);
  const [demoAccountsOpen, setDemoAccountsOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | undefined>(undefined);
  const [loginMode, setLoginMode] = useState<"password" | "phone" | "email" | "reset">("password");
  const [loggingIn, setLoggingIn] = useState(false);
  const [providerPreview, setProviderPreview] = useState<string>();
  const watchedTenantCode = Form.useWatch("tenantCode", form)?.trim().toLowerCase();
  const effectiveTenantCode = isTenantLocked ? lockedTenantCode : watchedTenantCode;
  const publicBootstrap = useQuery({
    queryKey: ["public-admin-brand", effectiveTenantCode],
    queryFn: () => clientChannelApi.getPublicBootstrap(effectiveTenantCode as string),
    enabled: Boolean(effectiveTenantCode && TENANT_CODE_PATTERN.test(effectiveTenantCode)),
    retry: false,
    staleTime: 5 * 60 * 1000
  });
  // 锁定租户但该编码查不到品牌（未开通/已停用）时，不冒充成"平台默认"，明确提示，不让人对着错的品牌登录。
  const tenantLockedButUnresolved = isTenantLocked && publicBootstrap.isFetched && !publicBootstrap.data;
  const loginBrandName = publicBootstrap.data?.merchant.name?.trim() || ADMIN_BRAND_NAME;
  const loginBrandLogo = publicBootstrap.data?.merchant.logoUrl?.trim() || ADMIN_DEFAULT_LOGO;
  const loginBranding = publicBootstrap.data?.adminLogin;
  const backgroundPath = loginBranding?.backgroundImageUrl;
  const backgroundSrc = backgroundPath?.startsWith("/") ? `${apiAssetOrigin}${backgroundPath}` : backgroundPath;

  useEffect(() => {
    document.title = locale === "en-US"
      ? loginBrandName === ADMIN_BRAND_NAME ? "Admin Console · Rental OS" : `${loginBrandName} Admin Console`
      : loginBrandName === ADMIN_BRAND_NAME ? "登录运营台 · Rental OS" : `登录${loginBrandName}运营台`;
    applyAdminFavicon();
  }, [locale, loginBrandName]);

  // 租户专属链接：把 URL 里的租户编码写进表单隐藏字段，登录逻辑不用区分两种入口。
  useEffect(() => {
    if (isTenantLocked) form.setFieldsValue({ tenantCode: lockedTenantCode });
  }, [isTenantLocked, lockedTenantCode, form]);

  const fillLocalDemoAccount = (demo: (typeof LOCAL_DEMO_ACCOUNTS)[number]) => {
    form.setFieldsValue({ tenantCode: demo.tenantCode, account: demo.account, password: "" });
    setLoginError(undefined);
    toast({ type: "info", title: t("已填入示例群组与账号，请输入本机初始化时配置的密码") });
  };

  const resetLocalDemoPassword = async () => {
    const values = await demoPasswordForm.validateFields();
    setResettingDemoPassword(true);
    try {
      await api.resetLocalDemoPassword({ password: values.password });
      form.setFieldsValue({ password: values.password });
      demoPasswordForm.resetFields();
      setDemoPasswordOpen(false);
      toast({ type: "success", title: t("演示账号密码已设置。选择示例账号后即可登录。") });
    } catch {
      toast({ type: "error", title: t("未能设置演示账号密码，请确认本机开发服务和数据库已启动。") });
    } finally {
      setResettingDemoPassword(false);
    }
  };

  const switchLoginMode = (mode: typeof loginMode) => {
    // CSS keeps every login method within the current viewport, including resize.
    form.setFieldValue("password", "");
    setLoginError(undefined);
    setProviderPreview(undefined);
    setLoginMode(mode);
  };
  const submitPasswordLogin = async (values: LoginValues) => {
    setLoggingIn(true);
    setLoginError(undefined);
    try {
      const result = await login(values.tenantCode, values.account, values.password);
      toast({ type: "success", title: t("登录成功") });
      navigate(result.needsTenantOnboarding ? "/tenant/readiness" : result.user.isSaasAdmin ? "/platform/tenants" : "/workbench", { replace: true });
    } catch (error) {
      let errorMessage = t("登录失败，请检查租户、账号和密码");
      if (isAxiosError(error)) {
        if (!error.response) errorMessage = t("无法连接 API，请确认开发服务已启动");
        else if (error.response.status >= 500) errorMessage = t("服务暂不可用，请检查 API 与数据库配置");
      }
      setLoginError(errorMessage);
      throw error;
    } finally { setLoggingIn(false); }
  };

  return (
    <div className="login-stage">
      {/* 外层：原有的带留白/圆角/描边的视口容器，保持不变。 */}
      <div className="login-frame">
        <div className="login-appearance"><AppearanceSwitcher iconOnly /></div>
        <main className="login-workspace">
          {/* 内层：更大圆角的登录卡片，左品牌、右表单；窄屏左栏隐藏，卡片退化为单栏。 */}
          <div className="login-card">
            <aside className="login-card-brand" aria-labelledby="login-brand-heading">
              {backgroundSrc ? <LoginBackground key={`${effectiveTenantCode}:${backgroundSrc}`} src={backgroundSrc} /> : null}
              <div className={`login-brand login-brand--hero${loginBrandLogo === ADMIN_DEFAULT_LOGO ? " login-brand--platform" : " login-brand--tenant"}`}>
                <img src={loginBrandLogo} alt={loginBrandName} />
              </div>
              <div className="login-card-brand-copy">
                <h1 id="login-brand-heading" className="login-card-brand-title">{loginBranding?.title?.trim() || t(ADMIN_LOGIN_DEFAULTS.title)}</h1>
                <p className="login-card-brand-tagline">{loginBranding?.description?.trim() || t(ADMIN_LOGIN_DEFAULTS.description)}</p>
              </div>
              <div className="login-card-brand-footer">
                <dl className="login-brand-capabilities">
                  {ADMIN_LOGIN_DEFAULTS.highlights.map((item, index) => (
                    <div key={item.title}>
                      <dt>{loginBranding?.highlights?.[index]?.title?.trim() || t(item.title)}</dt>
                      <dd>{loginBranding?.highlights?.[index]?.description?.trim() || t(item.description)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="login-brand-note">{loginBranding?.footerText?.trim() || t(ADMIN_LOGIN_DEFAULTS.footerText)}</p>
              </div>
            </aside>
            <div className="login-card-form">
              {/* 窄屏才显示：左栏隐藏后，品牌标识挪到表单顶部。 */}
              <div className="login-brand login-brand--compact"><img src={loginBrandLogo} alt={loginBrandName} /></div>
              <div className="login-panel-heading">
                <Typography.Title level={2}>{locale === "en-US" ? loginBrandName === ADMIN_BRAND_NAME ? "Admin Console" : `${loginBrandName} Admin Console` : loginBrandName === ADMIN_BRAND_NAME ? "登录运营台" : `登录${loginBrandName}运营台`}</Typography.Title>
                <Typography.Paragraph type="secondary">{t(loginMode === "reset" ? "通过手机号或邮箱验证找回密码（前端预览）。" : "使用租户账号进入对应品类的租赁工作区。")}</Typography.Paragraph>
              </div>
              {loginMode !== "reset" && <div className="login-methods"><Segmented value={loginMode} disabled={loggingIn} onChange={value => switchLoginMode(value as typeof loginMode)} options={[
                { value: "password", label: t("账号密码") }, { value: "phone", label: t("短信验证码") }, { value: "email", label: t("邮箱验证码") }
              ]} /></div>}
              {tenantLockedButUnresolved ? (
                <Alert
                  className="login-error"
                  type="warning"
                  showIcon
                  title={t("未找到该租户的品牌信息，仍可尝试登录；如链接有误请联系发放该链接的管理员。")}
                  style={{ marginBottom: 16 }}
                />
              ) : null}
              {loginError ? (
                <Alert
                  className="login-error"
                  type="error"
                  showIcon
                  closable
                  title={loginError}
                  onClose={() => setLoginError(undefined)}
                  style={{ marginBottom: 16 }}
                />
              ) : null}
              <Form form={form} layout="vertical" requiredMark={false} disabled={loggingIn} style={{ display: loginMode === "password" ? undefined : "none" }} onFinish={values => { void submitPasswordLogin(values).catch(() => undefined); }}>
                  {/* 租户专属链接：租户已由 URL 锁定，字段仍在表单里（隐藏）参与校验/提交，但不展示给用户改。 */}
                  <Form.Item name="tenantCode" hidden={isTenantLocked} label={t("租户编码")} rules={[{ required: true, message: t("请输入租户编码") }]}><Input autoComplete="organization" /></Form.Item>
                  <Form.Item label={t("账号")} name="account" rules={[{ required: true, message: t("请输入账号") }]}><Input autoComplete="username" /></Form.Item>
                  <Form.Item label={t("密码")} name="password" rules={[{ required: true, message: t("请输入密码") }]}><PasswordField autoComplete="current-password" /></Form.Item>
                  <SaveButton className="login-submit" label={t("进入工作台")} pendingLabel={t("登录中")} successLabel={t("登录成功")} form={form} onSave={submitPasswordLogin} />
                </Form>
                {loginMode === "password" ? <div className="login-preview-links"><Button type="text" size="small" disabled={loggingIn} onClick={() => switchLoginMode("reset")}>{t("忘记密码？")}</Button></div> : <AuthCodePreview key={loginMode} mode={loginMode} tenantCode={effectiveTenantCode} tenantLocked={isTenantLocked} onTenantChange={value => form.setFieldValue("tenantCode", value)} onBack={() => switchLoginMode("password")} />}
                {loginMode !== "reset" && <div className="login-provider-preview">
                  <div className={loginStyles.divider}>{t("其他登录方式（预览）")}</div>
                  <div className={loginStyles.sso}>
                    {[{ name: "Google", icon: <GoogleOutlined /> }, { name: "Apple", icon: <AppleOutlined /> }, { name: t("微信"), icon: <WechatOutlined /> }].map(provider => <Button key={provider.name} aria-label={provider.name} className={loginStyles.ssoButton} disabled={loggingIn} icon={provider.icon} onClick={() => setProviderPreview(provider.name)}>{provider.name}</Button>)}
                  </div>
                  {providerPreview && <Alert type="info" title={`${providerPreview} · ${t("登录方式预览")}`} description={t("暂未接入第三方授权，不会打开授权页面或建立登录会话。")} />}
                </div>}
                {isTenantLocked ? (
                  <Typography.Paragraph className="login-switch-tenant">
                    <a onClick={() => navigate("/login", { replace: true })}>{t("不是这家租户？切换到通用登录入口")}</a>
                  </Typography.Paragraph>
                ) : null}
                {import.meta.env.DEV && loginMode === "password" ? (
                  <div className="login-demo">
                    <Button type="link" className="login-demo-toggle" onClick={() => setDemoAccountsOpen((open) => !open)}>
                      {demoAccountsOpen ? t("收起本地开发示例群组 ▲") : t("使用本地开发示例群组 ▾")}
                    </Button>
                    {demoAccountsOpen ? (
                      <Alert
                        className="login-demo-hints"
                        type="info"
                        showIcon
                        title={t("本地开发示例群组")}
                        description={(
                          <span>
                            <span style={{ display: "block", marginBottom: 8 }}>
                              {t("点击可填入群组和账号。不记得密码时，直接在这里重新设置一次即可。")}
                            </span>
                            <span className="login-demo-accounts" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {LOCAL_DEMO_ACCOUNTS.map((demo) => (
                                <Button key={`${demo.tenantCode}:${demo.account}`} size="small" onClick={() => fillLocalDemoAccount(demo)}>
                                  {t(demo.label)}（{demo.tenantCode} / {demo.account}）
                                </Button>
                              ))}
                              <Button type="link" size="small" onClick={() => setDemoPasswordOpen(true)}>
                                {t("设置演示账号密码")}
                              </Button>
                            </span>
                          </span>
                        )}
                      />
                    ) : null}
                  </div>
                ) : null}
              <Typography.Text className="login-support" type="secondary">{t("登录即表示你正在访问获授权的租户数据范围。")}</Typography.Text>
            </div>
          </div>
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
