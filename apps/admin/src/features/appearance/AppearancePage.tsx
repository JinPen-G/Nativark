import { SaveOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Col, Form, Row, Slider, Space, Typography } from "antd";
import { useEffect, type CSSProperties } from "react";
import { useMutation, useQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import type { SaveTenantAppearanceRequest } from "@rental-os/shared";
import { ADMIN_UI_CORNER_RADIUS_DEFAULT, ADMIN_UI_CORNER_RADIUS_FULL, ADMIN_UI_CORNER_RADIUS_MAX, ADMIN_UI_CORNER_RADIUS_MIN } from "@rental-os/shared";
import { appearanceApi } from "@/api/appearance";
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
      normalize={(value) => typeof value === "number" && value > ADMIN_UI_CORNER_RADIUS_MAX ? (allowFull ? ADMIN_UI_CORNER_RADIUS_FULL : ADMIN_UI_CORNER_RADIUS_MAX) : value}>
      <Slider min={ADMIN_UI_CORNER_RADIUS_MIN} max={sliderMax} step={1} marks={marks}
        tooltip={{ formatter: (value) => value == null ? "" : allowFull && value > ADMIN_UI_CORNER_RADIUS_MAX ? `${ADMIN_UI_CORNER_RADIUS_FULL}px` : `${value}px` }} />
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

type AppearanceForm = Pick<SaveTenantAppearanceRequest, "adminContainerRadius" | "adminButtonRadius" | "adminInputRadius">;

/** 圆角是租户配置；音效是浏览器本地偏好。品牌及主题色仍在客户端配置维护。 */
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

  useEffect(() => {
    if (!profile.data) return;
    const d = profile.data;
    form.setFieldsValue({ adminContainerRadius: d.adminContainerRadius, adminButtonRadius: d.adminButtonRadius, adminInputRadius: d.adminInputRadius });
  }, [profile.data, form]);

  const save = useMutation({
    meta: { soundFeedback: true },
    // 只发送本页圆角；未提交的品牌/主题字段由服务端保留，不能随表单拆分清空。
    mutationFn: (values: AppearanceForm) => appearanceApi.saveProfile({
      adminContainerRadius: values.adminContainerRadius,
      adminButtonRadius: values.adminButtonRadius,
      adminInputRadius: values.adminInputRadius,
      expectedRevision: profile.data?.revision
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
        {profile.isLoading ? <LoadingState /> : profile.error || !profile.data ? (
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
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending} style={{ marginTop: 16 }}>{t("保存圆角设置")}</Button>
            </Card>
          </Form>
        )}
        <SoundSettingCard />
      </Space>
    </>
  );
}
