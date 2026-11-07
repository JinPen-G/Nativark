import { ClientBrandPreview } from "./ClientBrandPreview";
import { SettingsGroups, revealSettingsValidation } from "@/components/settings/SettingsWorkspace";
import { CheckCircleOutlined, PlusOutlined } from "@/components/ui/icons";
import type { SaveClientChannelProfileRequest, SaveMiniProgramChannelRequest, SaveWebsiteChannelProfileRequest } from "@rental-os/shared";
import { Card, Col, Divider, Row, Space, Tag, Typography } from "antd";
import { App } from "@/components/ui";
import { Checkbox } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, FileUpload, type FileUploadItem } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { ActionButton, Button, ColorPicker, RichTextEditor, SaveButton, Tabs } from "@/components/ui";
import { useId, useState, type ReactNode } from "react";
import { useServerFormSync } from "@/app/useServerFormSync";
import { isTransientRefreshError } from "@/app/queryClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clientChannelApi } from "@/api/clientChannel";
import { websiteChannelApi } from "@/api/websiteChannel";
import { apiAssetOrigin } from "@/api/http";
import { ADMIN_LOGIN_DEFAULTS } from "@/app/branding";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";

type ProfileForm = SaveClientChannelProfileRequest;

/** Form.Item 兼容的图片上传：上传到官网资产接口，把返回的公开 URL 写回字段；也可移除。 */
function ImageUrlUpload({ value, onChange, scene, hint, previewHeight = 64 }: { value?: string; onChange?: (url: string) => void; scene: "logo" | "favicon" | "hero" | "category"; hint: string; previewHeight?: number; }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [files, setFiles] = useState<FileUploadItem[]>([]);
  const preview = value ? (value.startsWith("/") ? `${apiAssetOrigin}${value}` : value) : "";
  return (
    <div>
      {preview ? <img src={preview} alt="" style={{ height: previewHeight, maxWidth: 240, objectFit: "contain", borderRadius: "var(--rental-ui-radius-container)", border: "1px solid var(--border)", display: "block", marginBottom: "var(--space-2)", background: "var(--surface-muted)" }} /> : null}
      <Space>
        <FileUpload
          accept="image/jpeg,image/png,image/webp"
          multiple={false} maxSize={2 * 1024 * 1024} value={files} onChange={setFiles}
          label={value ? t("重新上传") : t("上传图片")}
          description={t("只支持 JPG、PNG 或 WebP 图片，单张不超过 2MB")}
          onUpload={async (file, options) => {
            try { const result = await websiteChannelApi.uploadAsset(scene, file); if (options.signal.aborted) throw new DOMException("Aborted", "AbortError"); onChange?.(result.url); message.success(t("图片已上传")); }
            catch (error) { if (!options.signal.aborted) message.error(t("上传失败")); throw error; }
          }}
        />
        {value ? <Button type="text" danger onClick={() => { onChange?.(""); setFiles([]); }}>{t("移除")}</Button> : null}
      </Space>
      <Typography.Text type="secondary" className="text-meta" style={{ display: "block", marginTop: 6 }}>{t(hint)}</Typography.Text>
    </div>
  );
}

/** Visible and hidden are separate from an empty field's default copy. */
function LoginBrandingSection({ field, title, children }: {
  field: "showTitle" | "showDescription" | "showHighlights" | "showFooter";
  title: string; children: ReactNode;
}) {
  const { t } = useLocale();
  const id = useId();
  const enabled = Form.useWatch(["adminLogin", field]);
  return <section className="login-brand-settings-section">
    <div className="login-brand-settings-heading">
      <label htmlFor={id}>{t(title)}</label>
      <Form.Item name={["adminLogin", field]} valuePropName="checked" noStyle>
        <Switch id={id} aria-label={t(title)} />
      </Form.Item>
    </div>
    <fieldset disabled={enabled === false} className="login-brand-settings-fields">{children}</fieldset>
  </section>;
}

function ProfileCard() {
  const { t } = useLocale();
  const [form] = Form.useForm<ProfileForm>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((state) => state.tenant?.tenantId);
  const setTenantBranding = useAuthStore((state) => state.setTenantBranding);
  // 原生取色器需要合法 #RRGGBB；表单里可能是 #RGB 或空，展示时归一化，不回写表单值。
  const profile = useQuery({ queryKey: ["client-channel-profile", tenantId], queryFn: clientChannelApi.getProfile, enabled: Boolean(tenantId) });

  useServerFormSync(form, profile.data, () => {
    const data = profile.data;
    if (!data) return;
    form.setFieldsValue({
      expectedRevision: data.revision,
      brandName: data.brandName,
      brandLogoUrl: data.brandLogoUrl,
      faviconUrl: data.faviconUrl,
      customerServicePhone: data.customerServicePhone,
      customerServiceHours: data.customerServiceHours,
      userAgreement: data.userAgreement ?? { name: "用户服务协议", version: "", url: "", body: "" },
      privacyPolicy: data.privacyPolicy ?? { name: "隐私政策", version: "", url: "", body: "" },
      helpIntro: data.helpIntro,
      helpFaq: data.helpFaq ?? [],
      bannerTitle: data.bannerTitle,
      bannerSubtitle: data.bannerSubtitle,
      adminLogin: {
        showTitle: data.adminLogin?.showTitle !== false,
        showDescription: data.adminLogin?.showDescription !== false,
        showHighlights: data.adminLogin?.showHighlights !== false,
        showFooter: data.adminLogin?.showFooter !== false,
        backgroundImageUrl: data.adminLogin?.backgroundImageUrl ?? "",
        title: data.adminLogin?.title ?? "",
        description: data.adminLogin?.description ?? "",
        highlights: ADMIN_LOGIN_DEFAULTS.highlights.map((_, index) => ({
          title: data.adminLogin?.highlights?.[index]?.title ?? "",
          description: data.adminLogin?.highlights?.[index]?.description ?? ""
        })),
        footerText: data.adminLogin?.footerText ?? ""
      },
      themeColor: data.themeColor,
      smsLoginEnabled: data.smsLoginEnabled,
      passwordLoginEnabled: data.passwordLoginEnabled,
      publishedWorkspaceIds: data.publishedWorkspaceIds,
      defaultWorkspaceId: data.defaultWorkspaceId
    });
  });

  const save = useMutation({
    meta: { soundFeedback: true },
    mutationFn: (values: ProfileForm) => clientChannelApi.saveProfile({
      ...values,
      expectedRevision: form.getFieldValue("expectedRevision"),
      helpFaq: (values.helpFaq ?? []).filter((item) => item?.question?.trim() && item?.answer?.trim())
    }),
    onSuccess: async (data) => {
      setTenantBranding({ brandName: data.brandName, brandLogoUrl: data.brandLogoUrl, faviconUrl: data.faviconUrl, themeColor: data.themeColor, adminCornerRadius: data.adminCornerRadius, adminContainerRadius: data.adminContainerRadius, adminButtonRadius: data.adminButtonRadius, adminInputRadius: data.adminInputRadius });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["client-channel-profile", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["tenant-appearance"] }),
        queryClient.invalidateQueries({ queryKey: ["public-admin-brand"] })
      ]);
      message.success(t("客户端渠道配置已保存"));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? t("保存失败"))
  });

  if (profile.isLoading) return <div style={{ textAlign: "center", padding: 60 }}><LoadingState /></div>;
  if (!profile.data || profile.error && !isTransientRefreshError(profile.error)) return <Alert showIcon type="error" title={t("无法读取客户端渠道配置")} description={t("请刷新重试。")} />;

  const data = profile.data;
  const workspaceOptions = data.workspaces.map((w) => ({ label: `${w.name}（${w.code}）`, value: w.id }));

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        showIcon
        type={data.readiness.ready ? "success" : "warning"}
        title={data.readiness.ready ? t("客户端渠道配置已就绪") : t("客户端渠道配置未完成")}
        description={data.readiness.ready
          ? t("小程序与后续 APP 都会读取这份品牌、协议、客服、帮助与发布服务配置。")
          : <span>{t("还需完成：")}{data.readiness.missing.join("、")}{t("。未完成前小程序对客户显示租户名与“商户未提供”，不会用占位品牌或协议。")}</span>} />
      <Form id="client-profile" form={form} layout="vertical" onFinish={(values) => save.mutate(values)} onFinishFailed={()=>revealSettingsValidation("client-profile")}>
        <SettingsGroups>
        <Card size="small" title={t("品牌与客服")}>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}><Form.Item name="brandName" label={t("商户展示名")} extra={t("登录页标题、启动配置与分享使用；缺省用租户名")}><Input maxLength={191} placeholder={t("如：光影摄影器材租赁")} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="themeColor" label={t("品牌色")} tooltip={t("客户端与官网的品牌主色；#RRGGBB，留空回退平台默认色")} extra={t("用于客户端与官网品牌展示，不影响管理后台主色")} rules={[{ pattern: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, message: t("请输入 #RRGGBB 十六进制颜色") }]}><ColorPicker label={t("品牌色")} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="brandLogoUrl" label={t("商户 Logo")} extra={t("登录页、启动配置与分享使用")}><ImageUrlUpload scene="logo" previewHeight={48} hint="建议 240×80px 横版（透明背景 PNG 更佳），≤ 500KB，JPG/PNG/WebP。" /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="faviconUrl" label={t("浏览器图标")} extra={t("浏览器标签页与收藏夹使用；留空回退平台默认图标")}><ImageUrlUpload scene="favicon" previewHeight={48} hint="建议 64×64px 方形图标，≤ 500KB，JPG/PNG/WebP。" /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="customerServicePhone" label={t("客服电话")} extra={t("订单/付款页“联系商户”与拨号使用")}><Input maxLength={32} placeholder={t("如：021-00000000")} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="customerServiceHours" label={t("客服时段")} extra={t("展示文案，如“工作日 9:00-18:00”")}><Input maxLength={64} /></Form.Item></Col>
          </Row>
        </Card>

        <Card size="small" title={t("管理后台登录页")} style={{ marginTop: 16 }}>
          <Typography.Paragraph type="secondary">{t("文案留空使用默认内容；关闭对应开关可隐藏，已填写的内容会保留。仅影响后台登录页。")}</Typography.Paragraph>
          <Form.Item name={["adminLogin", "backgroundImageUrl"]} label={t("左侧背景图")}>
            <ImageUrlUpload scene="hero" previewHeight={160} hint="建议使用竖版图片，主体居中；自动裁切并叠加深色遮罩。JPG/PNG/WebP，最大 2MB。" />
          </Form.Item>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <LoginBrandingSection field="showTitle" title="登录页标题">
                <Form.Item name={["adminLogin", "title"]} rules={[{ max: 80 }]}>
                  <Input.TextArea aria-label={t("登录页标题")} rows={2} maxLength={80} placeholder={t(ADMIN_LOGIN_DEFAULTS.title)} />
                </Form.Item>
              </LoginBrandingSection>
            </Col>
            <Col xs={24} md={12}>
              <LoginBrandingSection field="showDescription" title="登录页说明">
                <Form.Item name={["adminLogin", "description"]} rules={[{ max: 300 }]}>
                  <Input.TextArea aria-label={t("登录页说明")} rows={2} maxLength={300} placeholder={t(ADMIN_LOGIN_DEFAULTS.description)} />
                </Form.Item>
              </LoginBrandingSection>
            </Col>
          </Row>
          <LoginBrandingSection field="showHighlights" title="底部介绍">
            <Row gutter={[16, 0]}>
              {ADMIN_LOGIN_DEFAULTS.highlights.map((item, index) => (
                <Col xs={24} md={8} key={item.title}>
                  <Form.Item name={["adminLogin", "highlights", index, "title"]} label={`${t("底部介绍")} ${index + 1}`} rules={[{ max: 24 }]}>
                    <Input maxLength={24} placeholder={t(item.title)} />
                  </Form.Item>
                  <Form.Item name={["adminLogin", "highlights", index, "description"]} label={t("介绍说明")} rules={[{ max: 80 }]}>
                    <Input.TextArea rows={2} maxLength={80} placeholder={t(item.description)} />
                  </Form.Item>
                </Col>
              ))}
            </Row>
          </LoginBrandingSection>
          <LoginBrandingSection field="showFooter" title="底部补充文字">
            <Form.Item name={["adminLogin", "footerText"]} rules={[{ max: 160 }]}>
              <Input.TextArea aria-label={t("底部补充文字")} rows={2} maxLength={160} placeholder={t(ADMIN_LOGIN_DEFAULTS.footerText)} />
            </Form.Item>
          </LoginBrandingSection>
        </Card>

        <Card size="small" title={t("首页横幅（可选）")} style={{ marginTop: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}><Form.Item name="bannerTitle" label={t("横幅标题")} extra={t("缺省使用品牌文案")}><Input maxLength={64} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="bannerSubtitle" label={t("横幅副标题")}><Input maxLength={120} /></Form.Item></Col>
          </Row>
        </Card>

        <Card size="small" title={t("用户服务协议")} style={{ marginTop: 16 }}>
          <Typography.Paragraph type="secondary">{t("正文在小程序内直接展示（不依赖外部网页）。填写版本后必须提供正文或外链；版本变更会作为客户同意留痕的依据。")}</Typography.Paragraph>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={8}><Form.Item name={["userAgreement", "name"]} label={t("名称")}><Input maxLength={64} placeholder={t("用户服务协议")} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name={["userAgreement", "version"]} label={t("版本")} extra={t("如 2026-09 / v1.2")}><Input maxLength={64} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name={["userAgreement", "url"]} label={t("外部链接（可选）")}><Input maxLength={512} placeholder="https://..." /></Form.Item></Col>
          </Row>
          <Form.Item name={["userAgreement", "body"]} label={t("正文")} rules={[{ max: 20000, message: t("正文不能超过 20000 字符") }]}><RichTextEditor placeholder={t("协议正文（纯文本或简单富文本）")} /></Form.Item>
        </Card>

        <Card size="small" title={t("隐私政策")} style={{ marginTop: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={8}><Form.Item name={["privacyPolicy", "name"]} label={t("名称")}><Input maxLength={64} placeholder={t("隐私政策")} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name={["privacyPolicy", "version"]} label={t("版本")}><Input maxLength={64} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name={["privacyPolicy", "url"]} label={t("外部链接（可选）")}><Input maxLength={512} placeholder="https://..." /></Form.Item></Col>
          </Row>
          <Form.Item name={["privacyPolicy", "body"]} label={t("正文")} rules={[{ max: 20000, message: t("正文不能超过 20000 字符") }]}><RichTextEditor placeholder={t("隐私政策正文")} /></Form.Item>
        </Card>

        <Card size="small" title={t("帮助与常见问题")} style={{ marginTop: 16 }}>
          <Form.Item name="helpIntro" label={t("帮助说明")}><Input.TextArea rows={3} maxLength={2000} placeholder={t("给客户的帮助说明；为空时帮助页只显示客服联系方式")} /></Form.Item>
          <Form.List name="helpFaq">
            {(fields, { add, remove }) => (
              <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                {fields.map((field) => (
                  <Row key={field.key} gutter={[12, 0]} align="top">
                    <Col xs={24} md={8}><Form.Item {...field} key={`${field.key}-q`} name={[field.name, "question"]} label={t("问题")} style={{ marginBottom: 8 }}><Input maxLength={200} /></Form.Item></Col>
                    <Col xs={22} md={15}><Form.Item {...field} key={`${field.key}-a`} name={[field.name, "answer"]} label={t("答案")} style={{ marginBottom: 8 }}><Input.TextArea rows={2} maxLength={2000} /></Form.Item></Col>
                    <Col xs={2} md={1}><Button type="text" danger style={{ marginTop: 30 }} onClick={() => remove(field.name)}>{t("删除")}</Button></Col>
                  </Row>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ question: "", answer: "" })} disabled={fields.length >= 30}>{t("新增常见问题")}</Button>
              </Space>
            )}
          </Form.List>
        </Card>

        <Card size="small" title={t("登录方式与发布服务")} style={{ marginTop: 16 }}>
          <Space size="large" style={{ marginBottom: 12 }}>
            <Form.Item name="smsLoginEnabled" label={t("短信验证码登录")} valuePropName="checked" noStyle><Switch /></Form.Item>
            <Typography.Text type="secondary">{t("短信登录（需已配置短信服务商）")}</Typography.Text>
            <Form.Item name="passwordLoginEnabled" label={t("密码登录")} valuePropName="checked" noStyle><Switch /></Form.Item>
            <Typography.Text type="secondary">{t("手机号密码登录")}</Typography.Text>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>{t("微信手机号一键登录由“微信小程序凭证”是否就绪决定，无需单独开关。")}</Typography.Paragraph>
          <Divider style={{ margin: "12px 0" }} />
          <Form.Item name="publishedWorkspaceIds" label={t("发布到客户端的服务")} extra={t("只有勾选的服务会出现在小程序/游客目录；未发布的服务不因启用而自动上架")}>
            <Checkbox.Group options={workspaceOptions} />
          </Form.Item>
          {data.workspaces.length === 0 ? <Alert type="info" showIcon title={t("当前没有启用中的经营空间")} description={t("请先在经营设置中启用服务空间，再回来发布到客户端。")} /> : null}
          <Form.Item name="defaultWorkspaceId" label={t("默认服务")} extra={t("留空则按空间默认标记选择；必须在已发布服务之内")}>
            <Input placeholder={t("服务空间 ID（可留空）")} allowClear />
          </Form.Item>
        </Card>

        <Card size="small" title={t("客户端样式预览")}><ClientBrandPreview form={form}/></Card>
        </SettingsGroups>
        <Space style={{ marginTop: 16 }}>
          <SaveButton label={t("保存配置")} form={form} pending={save.isPending} onSave={(values) => save.mutateAsync(values)} />
          {data.updatedAt ? <Typography.Text type="secondary">{t("上次更新")}：{data.updatedAt}</Typography.Text> : null}
        </Space>
      </Form>
    </Space>
  );
}

function WechatCredentialsCard() {
  const { t } = useLocale();
  const [form] = Form.useForm<SaveMiniProgramChannelRequest>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const channel = useQuery({ queryKey: ["mini-program-channel"], queryFn: clientChannelApi.getWechat });
  const enabled = Form.useWatch("enabled", form);

  const channelCurrent = useServerFormSync(form, channel.data, () => {
    if (!channel.data) return;
    form.setFieldsValue({ appId: channel.data.appId ?? "", appSecret: "", enabled: channel.data.enabled });
  });

  const save = useMutation({
    meta: { soundFeedback: true },
    mutationFn: async (values: SaveMiniProgramChannelRequest) => {
      if (!channelCurrent()) throw new Error(t("服务端配置已变更，请重新打开本页核对后再保存"));
      return clientChannelApi.saveWechat({ ...values, appSecret: values.appSecret?.trim() || undefined });
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["mini-program-channel"] }); message.success(t("微信小程序凭证已保存")); },
    onError: (error: any) => message.error(error?.response?.data?.message ?? t("保存失败"))
  });
  const test = useMutation({
    mutationFn: () => clientChannelApi.testWechat(),
    onSuccess: async (result) => { await queryClient.invalidateQueries({ queryKey: ["mini-program-channel"] }); result.ok ? message.success(result.message) : message.warning(result.message); },
    onError: (error: any) => message.error(error?.response?.data?.message ?? t("测试失败"))
  });

  if (channel.isLoading) return <div style={{ textAlign: "center", padding: 40 }}><LoadingState /></div>;
  const data = channel.data;
  const identityLocked = (data?.identityCount ?? 0) > 0;

  return (
    <Card
      size="small"
      title={<Space>{t("微信小程序凭证")}{data?.enabled ? <Tag color="success">{t("已启用")}</Tag> : <Tag>{t("未启用")}</Tag>}</Space>}
      extra={data?.lastTestStatus === "passed" ? <Tag icon={<CheckCircleOutlined />} color="success">{t("已验证")}</Tag> : data?.lastTestStatus === "failed" ? <Tag color="error">{t("测试失败")}</Tag> : null}
    >
      <Typography.Paragraph type="secondary">{t("AppSecret 只在服务端加密保存、不回显。微信手机号一键登录与小程序内微信支付需要凭证就绪并通过测试。")}</Typography.Paragraph>
      {identityLocked ? <Alert style={{ marginBottom: 12 }} showIcon type="info" title={`${t("已有")} ${data?.identityCount} ${t("位客户绑定微信身份")}`} description={t("AppID 与客户 openid 绑定，绑定后不能更换 AppID；如需迁移请联系平台。")} /> : null}
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
        <Row gutter={[16, 0]}>
          <Col xs={24} md={12}><Form.Item name="appId" label="AppID" rules={[{ required: true, message: t("请输入 AppID") }, { pattern: /^wx[0-9a-f]{16}$/i, message: t("AppID 格式无效（wx 开头 18 位）") }]}><Input maxLength={191} disabled={identityLocked} placeholder="wx0123456789abcdef" /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="appSecret" label="AppSecret" extra={data?.secretConfigured ? t("已配置；留空保持原密钥不变") : t("首次配置必填")}><Input.Password placeholder={data?.secretConfigured ? t("已配置（留空不修改）") : "AppSecret"} /></Form.Item></Col>
        </Row>
        <Form.Item name="enabled" label={t("启用渠道")} valuePropName="checked" extra={t("启用前须已填写 AppSecret")}><Switch /></Form.Item>
        <Space>
          <SaveButton label={t("保存凭证")} form={form} pending={save.isPending} onSave={(values) => save.mutateAsync(values)} />
          <ActionButton label={t("测试连接")} pendingLabel={t("检测中")} successLabel={t("检测通过")} pending={test.isPending} disabled={!data?.secretConfigured && !enabled} onAction={async () => { const result = await test.mutateAsync(); if (!result.ok) throw new Error(result.message); }} />
          {data?.lastTestAt ? <Typography.Text type="secondary">{t("上次测试")}：{data.lastTestAt}</Typography.Text> : null}
        </Space>
        {data?.lastTestStatus === "failed" && data.lastTestError ? <Alert style={{ marginTop: 12 }} showIcon type="error" title={t("上次测试失败")} description={data.lastTestError} /> : null}
      </Form>
    </Card>
  );
}

function WebsiteProfileCard() {
  const { t } = useLocale();
  const [form] = Form.useForm<SaveWebsiteChannelProfileRequest & { categoryImageMap?: Record<string, string> }>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  // 原生取色器需要合法 #RRGGBB；表单里可能是 #RGB 或空，展示时归一化，不回写表单值。
  const secondaryColorValue = Form.useWatch("secondaryColor", form);
  const secondaryColorSwatch = /^#[0-9a-fA-F]{6}$/.test(secondaryColorValue ?? "")
    ? (secondaryColorValue as string)
    : /^#[0-9a-fA-F]{3}$/.test(secondaryColorValue ?? "")
      ? "#" + (secondaryColorValue as string).slice(1).split("").map((c) => c + c).join("")
      : "#0A5CFF";
  const profile = useQuery({ queryKey: ["website-channel-profile"], queryFn: websiteChannelApi.getProfile });

  useServerFormSync(form, profile.data, () => {
    const data = profile.data;
    if (!data) return;
    form.setFieldsValue({
      expectedRevision: data.revision,
      enabled: data.enabled,
      slogan: data.slogan,
      heroTitle: data.heroTitle,
      heroDescription: data.heroDescription,
      heroImageUrl: data.heroImageUrl,
      secondaryColor: data.secondaryColor,
      footerText: data.footerText,
      contactAddress: data.contactAddress,
      ctaTitle: data.ctaTitle,
      ctaDescription: data.ctaDescription,
      seoTitle: data.seoTitle,
      seoDescription: data.seoDescription,
      seoKeywords: data.seoKeywords,
      showPoweredBy: data.showPoweredBy,
      customDomain: data.customDomain,
      categoryImageMap: Object.fromEntries((data.categoryImages ?? []).map((item) => [item.code, item.imageUrl])),
      advantages: data.advantages ?? [],
      steps: data.steps ?? [],
      testimonials: data.testimonials ?? []
    });
  });

  const save = useMutation({
    meta: { soundFeedback: true },
    mutationFn: (values: SaveWebsiteChannelProfileRequest & { categoryImageMap?: Record<string, string> }) => {
      const { categoryImageMap, ...rest } = values;
      const categoryImages = Object.entries(categoryImageMap ?? {})
        .map(([code, imageUrl]) => ({ code, imageUrl: (imageUrl ?? "").trim() }))
        .filter((item) => item.imageUrl);
      return websiteChannelApi.saveProfile({ ...rest, categoryImages, expectedRevision: form.getFieldValue("expectedRevision") });
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["website-channel-profile"] }); message.success(t("官网渠道配置已保存")); },
    onError: (error: any) => message.error(error?.response?.data?.message ?? t("保存失败"))
  });

  if (profile.isLoading) return <div style={{ textAlign: "center", padding: 60 }}><LoadingState /></div>;
  if (!profile.data || profile.error && !isTransientRefreshError(profile.error)) return <Alert showIcon type="error" title={t("无法读取官网渠道配置")} description={t("请刷新重试。")} />;

  const data = profile.data;

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        showIcon
        type={data.readiness.ready ? "success" : "warning"}
        title={data.readiness.ready ? t("官网渠道已就绪") : t("官网渠道未完成")}
        description={data.readiness.ready
          ? t("官网将读取这份官网特有配置；商户名、Logo、协议、客服等通用项仍来自“通用客户端配置”。")
          : <span>{t("还需完成：")}{data.readiness.missing.join("、")}{t("。未启用或缺 Hero 标题前，官网会回退到通用品牌文案。")}</span>} />
      <Form id="website-profile" form={form} layout="vertical" onFinish={(values) => save.mutate(values)} onFinishFailed={()=>revealSettingsValidation("website-profile")}>
        <SettingsGroups>
        <Card size="small" title={t("官网开关")}>
          <Space size="large">
            <Form.Item name="enabled" label={t("启用官网渠道")} valuePropName="checked" noStyle><Switch /></Form.Item>
            <Typography.Text type="secondary">{t("关闭后公开启动接口不返回官网配置，官网回退到通用品牌文案")}</Typography.Text>
          </Space>
          <div style={{ marginTop: 12 }}>
            <Space size="large">
              <Form.Item name="showPoweredBy" label={t("页脚显示 Powered by Rental OS")} valuePropName="checked" noStyle><Switch /></Form.Item>
              <Typography.Text type="secondary">{t("是否在页脚展示 “Powered by Rental OS”")}</Typography.Text>
            </Space>
          </div>
        </Card>

        <Card size="small" title={t("官网域名")} style={{ marginTop: 16 }}>
          <Form.Item
            name="customDomain"
            label={t("自定义域名")}
            extra={t("只填域名，不含 http:// 与路径；一个域名只能绑定一个租户。保存后访问该域名即打开本租户官网。")}
            rules={[{ pattern: /^(?:https?:\/\/)?([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\/?$/, message: t("域名格式无效，示例：www.brand.com") }]}
          >
            <Input maxLength={191} allowClear placeholder="www.brand.com" />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            title={t("绑定后还需在域名服务商处添加解析")}
            description={<span>{t("在你的域名 DNS 控制台为该域名添加一条")} <Typography.Text code>CNAME</Typography.Text> {t("记录，指向平台提供的官网接入地址；解析生效并签发 HTTPS 证书后即可访问。不填域名时，官网仍可通过平台分配的地址访问。")}</span>}
          />
        </Card>

        <Card size="small" title={t("首页 Hero 与品牌")} style={{ marginTop: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}><Form.Item name="slogan" label={t("站点标语")} extra={t("展示在品牌名下方与页脚")}><Input maxLength={120} placeholder={t("如：好物相伴，更好生活")} /></Form.Item></Col>
            <Col xs={24} md={12}>
              <Form.Item name="secondaryColor" label={t("辅助色")} tooltip={t("主色仍在“通用客户端配置”的主题色里；此处是官网强调/辅助色")} extra="#RRGGBB，留空回退默认" rules={[{ pattern: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, message: t("请输入 #RRGGBB 十六进制颜色") }]}>
                <Input maxLength={7} allowClear placeholder="#0A5CFF" addonBefore={<input type="color" value={secondaryColorSwatch} onChange={(e) => form.setFieldValue("secondaryColor", e.target.value.toUpperCase())} style={{ width: 28, height: 22, border: "none", background: "transparent", padding: 0, cursor: "pointer" }} aria-label={t("选择辅助色")} />} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}><Form.Item name="heroTitle" label={t("Hero 主标题")} extra={t("首页首屏大标题；缺省回退到商户名/标语")}><Input maxLength={120} placeholder={t("如：面向多行业的租赁解决方案")} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="heroImageUrl" label={t("Hero 大图")}><ImageUrlUpload scene="hero" previewHeight={72} hint="建议 2400×1000px（约 12:5 宽幅横图），≤ 1MB，JPG/WebP；主体居中、两侧留白以适配裁切。" /></Form.Item></Col>
            <Col xs={24}><Form.Item name="heroDescription" label={t("Hero 副文案")}><Input.TextArea rows={2} maxLength={400} showCount /></Form.Item></Col>
          </Row>
        </Card>

        <Card size="small" title={t("底部行动区（CTA）")} style={{ marginTop: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}><Form.Item name="ctaTitle" label={t("CTA 标题")}><Input maxLength={120} placeholder={t("如：现在就开始租赁吧")} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="ctaDescription" label={t("CTA 文案")}><Input maxLength={400} placeholder={t("如：海量好物 · 灵活租期")} /></Form.Item></Col>
          </Row>
        </Card>

        <Card size="small" title={t("品类入口图")} style={{ marginTop: 16 }}>
          <Typography.Paragraph type="secondary">{t("官网首页每个一级品类卡片/场景图的展示图。建议 800×600px（4:3），≤ 500KB，JPG/WebP；留空则自动使用该品类下第一个商品的图片。品类来自“通用客户端配置”里已启用的经营空间。")}</Typography.Paragraph>
          {data.categories.length ? <Row gutter={[16, 0]}>{data.categories.map((cat) => (
            <Col xs={24} md={12} key={cat.code}><Form.Item name={["categoryImageMap", cat.code]} label={`${cat.name}（${cat.code}）`}><ImageUrlUpload scene="category" hint="建议 800×600px（4:3），≤ 500KB，JPG/WebP；留空用商品图。" /></Form.Item></Col>
          ))}</Row> : <Alert type="info" showIcon title={t("暂无可配置品类")} description={t("请先在经营设置中启用服务空间，并在“通用客户端配置”里发布到客户端。")} />}
        </Card>

        <Card size="small" title={t("页脚与联系")} style={{ marginTop: 16 }}>
          <Form.Item name="footerText" label={t("页脚文案")}><Input.TextArea rows={2} maxLength={600} showCount placeholder={t("页脚品牌介绍文案")} /></Form.Item>
          <Form.Item name="contactAddress" label={t("联系地址")} extra={t("展示在页脚")}><Input maxLength={256} /></Form.Item>
        </Card>

        <Card size="small" title={t("SEO（可选）")} style={{ marginTop: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}><Form.Item name="seoTitle" label={t("SEO 标题")}><Input maxLength={120} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="seoKeywords" label={t("SEO 关键词")} extra={t("以英文逗号分隔")}><Input maxLength={256} placeholder="相机,露营,租赁" /></Form.Item></Col>
            <Col xs={24}><Form.Item name="seoDescription" label={t("SEO 描述")}><Input.TextArea rows={2} maxLength={400} showCount /></Form.Item></Col>
          </Row>
        </Card>

        <Card size="small" title={t("为什么选择我们（卖点）")} style={{ marginTop: 16 }}>
          <Typography.Paragraph type="secondary">{t("留空则使用通用文案。图标关键字可填 authentic / delivery / flexible / service / quality / support，其余用默认勾选图标。")}</Typography.Paragraph>
          <Form.List name="advantages">{(fields, { add, remove }) => <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            {fields.map((field) => <Row key={field.key} gutter={[8, 0]} align="top">
              <Col xs={24} md={5}><Form.Item {...field} key={`${field.key}-i`} name={[field.name, "icon"]} style={{ marginBottom: 8 }}><Input maxLength={32} placeholder={t("图标关键字")} /></Form.Item></Col>
              <Col xs={24} md={6}><Form.Item {...field} key={`${field.key}-t`} name={[field.name, "title"]} rules={[{ required: true, max: 40 }]} style={{ marginBottom: 8 }}><Input placeholder={t("标题")} /></Form.Item></Col>
              <Col xs={22} md={12}><Form.Item {...field} key={`${field.key}-d`} name={[field.name, "description"]} rules={[{ max: 120 }]} style={{ marginBottom: 8 }}><Input placeholder={t("描述")} /></Form.Item></Col>
              <Col xs={2} md={1}><Button type="text" danger onClick={() => remove(field.name)}>{t("删")}</Button></Col>
            </Row>)}
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ title: "" })} disabled={fields.length >= 8}>{t("新增卖点")}</Button>
          </Space>}</Form.List>
        </Card>

        <Card size="small" title={t("租赁流程")} style={{ marginTop: 16 }}>
          <Typography.Paragraph type="secondary">{t("留空则使用通用四步；填写后按顺序展示，序号自动生成。")}</Typography.Paragraph>
          <Form.List name="steps">{(fields, { add, remove }) => <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            {fields.map((field) => <Row key={field.key} gutter={[8, 0]} align="top">
              <Col xs={24} md={7}><Form.Item {...field} key={`${field.key}-t`} name={[field.name, "title"]} rules={[{ required: true, max: 40 }]} style={{ marginBottom: 8 }}><Input placeholder={t("步骤标题")} /></Form.Item></Col>
              <Col xs={22} md={16}><Form.Item {...field} key={`${field.key}-d`} name={[field.name, "description"]} rules={[{ max: 120 }]} style={{ marginBottom: 8 }}><Input placeholder={t("步骤说明")} /></Form.Item></Col>
              <Col xs={2} md={1}><Button type="text" danger onClick={() => remove(field.name)}>{t("删")}</Button></Col>
            </Row>)}
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ title: "" })} disabled={fields.length >= 8}>{t("新增步骤")}</Button>
          </Space>}</Form.List>
        </Card>

        <Card size="small" title={t("用户评价 / 客户案例")} style={{ marginTop: 16 }}>
          <Typography.Paragraph type="secondary">{t("留空则首页不展示评价区块。请如实使用已获授权的客户评价。")}</Typography.Paragraph>
          <Form.List name="testimonials">{(fields, { add, remove }) => <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            {fields.map((field) => <Row key={field.key} gutter={[8, 0]} align="top">
              <Col xs={24} md={5}><Form.Item {...field} key={`${field.key}-n`} name={[field.name, "name"]} rules={[{ required: true, max: 40 }]} style={{ marginBottom: 8 }}><Input placeholder={t("来源（如 陈女士）")} /></Form.Item></Col>
              <Col xs={24} md={5}><Form.Item {...field} key={`${field.key}-c`} name={[field.name, "context"]} rules={[{ max: 60 }]} style={{ marginBottom: 8 }}><Input placeholder={t("场景（如 周末摄影）")} /></Form.Item></Col>
              <Col xs={22} md={13}><Form.Item {...field} key={`${field.key}-x`} name={[field.name, "text"]} rules={[{ required: true, max: 300 }]} style={{ marginBottom: 8 }}><Input placeholder={t("评价内容")} /></Form.Item></Col>
              <Col xs={2} md={1}><Button type="text" danger onClick={() => remove(field.name)}>{t("删")}</Button></Col>
            </Row>)}
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ name: "", text: "" })} disabled={fields.length >= 12}>{t("新增评价")}</Button>
          </Space>}</Form.List>
        </Card>

        <Card size="small" title={t("客户端样式预览")}><ClientBrandPreview form={form} website/></Card>
        </SettingsGroups>
        <Space style={{ marginTop: 16 }}>
          <SaveButton label={t("保存配置")} form={form} pending={save.isPending} onSave={(values) => save.mutateAsync(values)} />
          {data.updatedAt ? <Typography.Text type="secondary">{t("上次更新")}：{data.updatedAt}</Typography.Text> : null}
        </Space>
      </Form>
    </Space>
  );
}

export function ClientChannelPage() {
  const { t } = useLocale();
  return (
    <PageHeader
      title={t("客户端渠道")}
      note={{ title: t("一份通用配置，多端共用"), description: t("品牌、客服、协议正文/版本、帮助与发布服务由小程序、APP 和官网共用；微信 AppID/AppSecret 是微信渠道专有；站点标语、Hero、辅助色、页脚与 SEO 是官网专有。协议正文在客户端内直接渲染，请填写正文而不仅是外链。") }}
      view={<Tabs
        tabBarGutter={32}
        items={[
          {
            key: "common",
            label: t("通用客户端配置"),
            children: <ProfileCard />
          },
          {
            key: "mini-program",
            label: t("微信小程序配置"),
            children: <WechatCredentialsCard />
          },
          {
            key: "website",
            label: t("官网配置"),
            children: <WebsiteProfileCard />
          }
        ]}
      />}
    />
  );
}
