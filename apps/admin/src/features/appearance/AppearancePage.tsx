import { Card, Col, Row, Space, Typography } from "antd";
import { Slider } from "@/components/ui";
import { App } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert } from "@/components/ui";
import { Button, ColorPicker, SaveButton } from "@/components/ui";
import { type CSSProperties } from "react";
import { useServerFormSync } from "@/app/useServerFormSync";
import { isTransientRefreshError } from "@/app/queryClient";
import { useMutation, useQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import type { SaveTenantAppearanceRequest } from "@rental-os/shared";
import { ADMIN_UI_CORNER_RADIUS_DEFAULT, ADMIN_UI_CORNER_RADIUS_FULL, ADMIN_UI_CORNER_RADIUS_MAX, ADMIN_UI_CORNER_RADIUS_MIN } from "@rental-os/shared";
import { appearanceApi } from "@/api/appearance";
import { accountAppearanceApi } from "@/api/accountAppearance";
import { resolveAdminRadii } from "@/app/designTokens";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";
import { SoundSettingCard } from "@/features/sound/SoundSettingCard";

/** 仅按钮组允许 999 离散档，容器与输入组沿用已配置的连续范围。 */
function AdminRadiusSlider({ name, label, tooltip, allowFull = true }: { name: string; label: string; tooltip: string; allowFull?: boolean }) {
  const sliderMax = allowFull ? ADMIN_UI_CORNER_RADIUS_MAX + 4 : ADMIN_UI_CORNER_RADIUS_MAX;
  const marks: Record<number, string> = {
    [ADMIN_UI_CORNER_RADIUS_MIN]: `${ADMIN_UI_CORNER_RADIUS_MIN}px`,
    [ADMIN_UI_CORNER_RADIUS_DEFAULT]: `${ADMIN_UI_CORNER_RADIUS_DEFAULT}px`,
    [ADMIN_UI_CORNER_RADIUS_MAX]: `${ADMIN_UI_CORNER_RADIUS_MAX}px`,
    ...(allowFull ? { [ADMIN_UI_CORNER_RADIUS_MAX + 4]: `${ADMIN_UI_CORNER_RADIUS_FULL}px` } : {})
  };
  return (
    <Form.Item name={name} label={label} tooltip={tooltip} extra={<span className="text-meta">{tooltip}</span>}
      getValueProps={(value) => ({ value: value === ADMIN_UI_CORNER_RADIUS_FULL ? sliderMax : value })}
      trigger="onValueChange" normalize={(value) => typeof value === "number" && value > ADMIN_UI_CORNER_RADIUS_MAX ? (allowFull ? ADMIN_UI_CORNER_RADIUS_FULL : ADMIN_UI_CORNER_RADIUS_MAX) : value}>
      <Slider label={label} min={ADMIN_UI_CORNER_RADIUS_MIN} max={sliderMax} step={1} marks={Object.entries(marks).map(([value, label]) => ({ value: Number(value), label }))}
        format={value => allowFull && value > ADMIN_UI_CORNER_RADIUS_MAX ? `${ADMIN_UI_CORNER_RADIUS_FULL}px` : `${value}px`} />
    </Form.Item>
  );
}

function RadiusPreview({ kind, radius }: { kind: "container" | "button" | "input"; radius: number }) {
  const { t } = useLocale();
  const shape: CSSProperties = { borderRadius: radius };
  const meta = <span style={{ color: "var(--rental-color-text-description)", fontSize: 12 }}>{radius}px</span>;
  if (kind === "button") return <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}><span style={{ ...shape, display: "inline-flex", alignItems: "center", height: 32, padding: "0 16px", background: "var(--rental-color-primary)", color: "#fff", fontSize: 13, fontWeight: 600 }}>{t("按钮")}</span>{meta}</div>;
  if (kind === "input") return <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}><span style={{ ...shape, display: "inline-flex", alignItems: "center", height: 32, padding: "0 12px", minWidth: 120, border: "1px solid var(--rental-color-border)", background: "var(--rental-color-bg-container)", color: "var(--rental-color-text-description)", fontSize: 13 }}>{t("输入框示例")}</span>{meta}</div>;
  return <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}><span style={{ ...shape, display: "inline-flex", alignItems: "center", height: 44, padding: "0 18px", border: "1px solid var(--rental-color-border-secondary)", background: "var(--rental-color-bg-container)", color: "var(--rental-color-text)", fontSize: 13, boxShadow: "var(--rental-box-shadow-tertiary)" }}>{t("容器卡片")}</span>{meta}</div>;
}

type AppearanceForm = Pick<SaveTenantAppearanceRequest, "adminContainerRadius" | "adminButtonRadius" | "adminInputRadius" | "expectedRevision">;

/** 账户级主题色：跟随登录账户、与租户品牌色相互独立。单字段独立表单、独立保存。 */
function AccountThemeColorCard() {
  const { t } = useLocale();
  const [form] = Form.useForm<{ themeColor?: string }>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const setAccountThemeColor = useAuthStore((state) => state.setAccountThemeColor);
  const profile = useQuery({ queryKey: ["account-appearance"], queryFn: accountAppearanceApi.getProfile });
  const profileCurrent = useServerFormSync(form, profile.data, () => { if (profile.data) form.setFieldsValue({ themeColor: profile.data.themeColor }); });
  const save = useMutation({
    meta: { soundFeedback: true },
    mutationFn: async (values: { themeColor?: string }) => {
      if (!profileCurrent()) throw new Error(t("服务端配置已变更，请重新打开本页核对后再保存"));
      return accountAppearanceApi.saveProfile({ themeColor: values.themeColor });
    },
    onSuccess: (data) => {
      setAccountThemeColor(data.themeColor);
      void queryClient.invalidateQueries({ queryKey: ["account-appearance"] });
      message.success(t("主题色已保存"));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? error?.message ?? t("保存失败"))
  });
  return (
    <Card size="small" title={t("管理后台主题色")}>
      <Typography.Paragraph type="secondary" className="text-meta" style={{ marginBottom: 12 }}>
        {t("仅影响你自己的管理后台主色，跟随登录账户；留空使用平台默认色。与租户品牌色相互独立。")}
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
        <Form.Item name="themeColor" rules={[{ pattern: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, message: t("请输入 #RRGGBB 十六进制颜色") }]}>
          <ColorPicker label={t("主题色")} />
        </Form.Item>
        <SaveButton label={t("保存主题色")} form={form} pending={save.isPending} onSave={(values) => save.mutateAsync(values)} />
      </Form>
    </Card>
  );
}

/** 圆角是租户级配置；主题色跟随登录账户；音效是浏览器本地偏好。品牌色在客户端配置维护。 */
export function AppearancePage() {
  const { t } = useLocale();
  const [form] = Form.useForm<AppearanceForm>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((state) => state.tenant?.tenantId);
  const setTenantBranding = useAuthStore((state) => state.setTenantBranding);
  const profileOptions = queryOptions({ queryKey: ["tenant-appearance", tenantId], queryFn: appearanceApi.getProfile });
  const profile = useQuery({ ...profileOptions, enabled: Boolean(tenantId) });
  const watchContainer = Form.useWatch("adminContainerRadius", form);
  const watchButton = Form.useWatch("adminButtonRadius", form);
  const watchInput = Form.useWatch("adminInputRadius", form);
  const previewRadii = resolveAdminRadii({ container: watchContainer, button: watchButton, input: watchInput, legacy: profile.data?.adminCornerRadius });

  useServerFormSync(form, profile.data, () => {
    if (!profile.data) return;
    const d = profile.data;
    form.setFieldsValue({ adminContainerRadius: d.adminContainerRadius, adminButtonRadius: d.adminButtonRadius, adminInputRadius: d.adminInputRadius,
      expectedRevision: d.revision });
  });

  const save = useMutation({
    meta: { soundFeedback: true },
    // 只发送本页圆角；未提交的品牌/主题字段由服务端保留，不能随表单拆分清空。
    mutationFn: (values: AppearanceForm) => appearanceApi.saveProfile({
      adminContainerRadius: values.adminContainerRadius,
      adminButtonRadius: values.adminButtonRadius,
      adminInputRadius: values.adminInputRadius,
      expectedRevision: form.getFieldValue("expectedRevision")
    }),
    onSuccess: (data) => {
      setTenantBranding({ brandName: data.brandName, brandLogoUrl: data.brandLogoUrl, faviconUrl: data.faviconUrl, themeColor: data.themeColor, adminCornerRadius: data.adminCornerRadius, adminContainerRadius: data.adminContainerRadius, adminButtonRadius: data.adminButtonRadius, adminInputRadius: data.adminInputRadius });
      void queryClient.invalidateQueries({ queryKey: ["tenant-appearance"] });
      void queryClient.invalidateQueries({ queryKey: ["client-channel-profile"] });
      message.success(t("圆角设置已保存"));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? t("保存失败"))
  });

  return (
    <>
      <PageHeader title="外观与音效" description="设置管理后台圆角与界面音效。品牌标识及主题色请在客户端配置中维护。" />
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <AccountThemeColorCard />
        {profile.isLoading ? <LoadingState /> : !profile.data || profile.error && !isTransientRefreshError(profile.error) ? (
          <Alert showIcon type="error" title={t("无法读取圆角设置")} description={<Button onClick={() => profile.refetch()}>{t("重试")}</Button>} />
        ) : (
          <Form<AppearanceForm> form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
            <Card size="small" title={t("管理后台圆角（分组）")}>
              <Typography.Paragraph type="secondary" className="text-meta" style={{ marginBottom: 12 }}>
                {t("容器、按钮、录入控件各自独立调节；圆形图标按钮、开关与胶囊标签保留各自形态不受影响。容器与输入为 8–40px（可做大圆角卡片），仅按钮组可选最右的 999px 极致圆角（胶囊按钮）；留空的组回退到旧的统一圆角。")}
              </Typography.Paragraph>
              <Row gutter={[16, 0]}>
                <Col xs={24} md={8}><AdminRadiusSlider name="adminContainerRadius" label={t("容器圆角")} tooltip={t("卡片、弹窗、抽屉、表格外框等大面")} allowFull={false} /><RadiusPreview kind="container" radius={previewRadii.container} /></Col>
                <Col xs={24} md={8}><AdminRadiusSlider name="adminButtonRadius" label={t("按钮圆角")} tooltip={t("按钮、分段控件、页签、选中菜单项")} /><RadiusPreview kind="button" radius={previewRadii.button} /></Col>
                <Col xs={24} md={8}><AdminRadiusSlider name="adminInputRadius" label={t("输入框圆角")} tooltip={t("输入框、选择器、日期、数字等录入控件")} allowFull={false} /><RadiusPreview kind="input" radius={previewRadii.input} /></Col>
              </Row>
              <SaveButton label={t("保存圆角设置")} form={form} pending={save.isPending} onSave={(values) => save.mutateAsync(values)} style={{ marginTop: 16 }} />
            </Card>
          </Form>
        )}
        <SoundSettingCard />
      </Space>
    </>
  );
}
