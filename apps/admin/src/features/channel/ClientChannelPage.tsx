import { CheckCircleOutlined, ExperimentOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import type { SaveClientChannelProfileRequest, SaveMiniProgramChannelRequest } from "@rental-os/shared";
import { Alert, App, Button, Card, Checkbox, Col, Divider, Form, Input, Row, Space, Spin, Switch, Tag, Typography } from "antd";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clientChannelApi } from "@/api/clientChannel";
import { PageHeader } from "@/components/PageHeader";

type ProfileForm = SaveClientChannelProfileRequest;

function ProfileCard() {
  const [form] = Form.useForm<ProfileForm>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ["client-channel-profile"], queryFn: clientChannelApi.getProfile });

  useEffect(() => {
    const data = profile.data;
    if (!data) return;
    form.setFieldsValue({
      expectedRevision: data.revision,
      brandName: data.brandName,
      brandLogoUrl: data.brandLogoUrl,
      customerServicePhone: data.customerServicePhone,
      customerServiceHours: data.customerServiceHours,
      userAgreement: data.userAgreement ?? { name: "用户服务协议", version: "", url: "", body: "" },
      privacyPolicy: data.privacyPolicy ?? { name: "隐私政策", version: "", url: "", body: "" },
      helpIntro: data.helpIntro,
      helpFaq: data.helpFaq ?? [],
      bannerTitle: data.bannerTitle,
      bannerSubtitle: data.bannerSubtitle,
      smsLoginEnabled: data.smsLoginEnabled,
      passwordLoginEnabled: data.passwordLoginEnabled,
      publishedWorkspaceIds: data.publishedWorkspaceIds,
      defaultWorkspaceId: data.defaultWorkspaceId
    });
  }, [profile.data, form]);

  const save = useMutation({
    mutationFn: (values: ProfileForm) => clientChannelApi.saveProfile({
      ...values,
      expectedRevision: profile.data?.revision,
      helpFaq: (values.helpFaq ?? []).filter((item) => item?.question?.trim() && item?.answer?.trim())
    }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["client-channel-profile"] }); message.success("客户端渠道配置已保存"); },
    onError: (error: any) => message.error(error?.response?.data?.message ?? "保存失败")
  });

  if (profile.isLoading) return <div style={{ textAlign: "center", padding: 60 }}><Spin size="large" /></div>;
  if (profile.error || !profile.data) return <Alert showIcon type="error" title="无法读取客户端渠道配置" description="请刷新重试。" />;

  const data = profile.data;
  const workspaceOptions = data.workspaces.map((w) => ({ label: `${w.name}（${w.code}）`, value: w.id }));

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        showIcon
        type={data.readiness.ready ? "success" : "warning"}
        title={data.readiness.ready ? "客户端渠道配置已就绪" : "客户端渠道配置未完成"}
        description={data.readiness.ready
          ? "小程序与后续 APP 都会读取这份品牌、协议、客服、帮助与发布服务配置。"
          : <span>还需完成：{data.readiness.missing.join("、")}。未完成前小程序对客户显示租户名与“商户未提供”，不会用占位品牌或协议。</span>} />
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
        <Card size="small" title="品牌与客服">
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}><Form.Item name="brandName" label="商户展示名" extra="登录页标题、启动配置与分享使用；缺省用租户名"><Input maxLength={191} placeholder="如：光影摄影器材租赁" /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="brandLogoUrl" label="商户 Logo 地址" extra="HTTPS 图片地址；小程序需将其域名加入 downloadFile 合法域名"><Input maxLength={512} placeholder="https://..." /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="customerServicePhone" label="客服电话" extra="订单/付款页“联系商户”与拨号使用"><Input maxLength={32} placeholder="如：021-00000000" /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="customerServiceHours" label="客服时段" extra="展示文案，如“工作日 9:00-18:00”"><Input maxLength={64} /></Form.Item></Col>
          </Row>
        </Card>

        <Card size="small" title="首页横幅（可选）" style={{ marginTop: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}><Form.Item name="bannerTitle" label="横幅标题" extra="缺省使用品牌文案"><Input maxLength={64} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="bannerSubtitle" label="横幅副标题"><Input maxLength={120} /></Form.Item></Col>
          </Row>
        </Card>

        <Card size="small" title="用户服务协议" style={{ marginTop: 16 }}>
          <Typography.Paragraph type="secondary">正文在小程序内直接展示（不依赖外部网页）。填写版本后必须提供正文或外链；版本变更会作为客户同意留痕的依据。</Typography.Paragraph>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={8}><Form.Item name={["userAgreement", "name"]} label="名称"><Input maxLength={64} placeholder="用户服务协议" /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name={["userAgreement", "version"]} label="版本" extra="如 2026-09 / v1.2"><Input maxLength={64} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name={["userAgreement", "url"]} label="外部链接（可选）"><Input maxLength={512} placeholder="https://..." /></Form.Item></Col>
          </Row>
          <Form.Item name={["userAgreement", "body"]} label="正文"><Input.TextArea rows={6} maxLength={20000} showCount placeholder="协议正文（纯文本或简单富文本）" /></Form.Item>
        </Card>

        <Card size="small" title="隐私政策" style={{ marginTop: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={8}><Form.Item name={["privacyPolicy", "name"]} label="名称"><Input maxLength={64} placeholder="隐私政策" /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name={["privacyPolicy", "version"]} label="版本"><Input maxLength={64} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name={["privacyPolicy", "url"]} label="外部链接（可选）"><Input maxLength={512} placeholder="https://..." /></Form.Item></Col>
          </Row>
          <Form.Item name={["privacyPolicy", "body"]} label="正文"><Input.TextArea rows={6} maxLength={20000} showCount placeholder="隐私政策正文" /></Form.Item>
        </Card>

        <Card size="small" title="帮助与常见问题" style={{ marginTop: 16 }}>
          <Form.Item name="helpIntro" label="帮助说明"><Input.TextArea rows={3} maxLength={2000} placeholder="给客户的帮助说明；为空时帮助页只显示客服联系方式" /></Form.Item>
          <Form.List name="helpFaq">
            {(fields, { add, remove }) => (
              <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                {fields.map((field) => (
                  <Row key={field.key} gutter={[12, 0]} align="top">
                    <Col xs={24} md={8}><Form.Item {...field} key={`${field.key}-q`} name={[field.name, "question"]} label="问题" style={{ marginBottom: 8 }}><Input maxLength={200} /></Form.Item></Col>
                    <Col xs={22} md={15}><Form.Item {...field} key={`${field.key}-a`} name={[field.name, "answer"]} label="答案" style={{ marginBottom: 8 }}><Input.TextArea rows={2} maxLength={2000} /></Form.Item></Col>
                    <Col xs={2} md={1}><Button type="text" danger style={{ marginTop: 30 }} onClick={() => remove(field.name)}>删除</Button></Col>
                  </Row>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ question: "", answer: "" })} disabled={fields.length >= 30}>新增常见问题</Button>
              </Space>
            )}
          </Form.List>
        </Card>

        <Card size="small" title="登录方式与发布服务" style={{ marginTop: 16 }}>
          <Space size="large" style={{ marginBottom: 12 }}>
            <Form.Item name="smsLoginEnabled" label="短信验证码登录" valuePropName="checked" noStyle><Switch /></Form.Item>
            <Typography.Text type="secondary">短信登录（需已配置短信服务商）</Typography.Text>
            <Form.Item name="passwordLoginEnabled" label="密码登录" valuePropName="checked" noStyle><Switch /></Form.Item>
            <Typography.Text type="secondary">手机号密码登录</Typography.Text>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>微信手机号一键登录由“微信小程序凭证”是否就绪决定，无需单独开关。</Typography.Paragraph>
          <Divider style={{ margin: "12px 0" }} />
          <Form.Item name="publishedWorkspaceIds" label="发布到客户端的服务" extra="只有勾选的服务会出现在小程序/游客目录；未发布的服务不因启用而自动上架">
            <Checkbox.Group options={workspaceOptions} />
          </Form.Item>
          {data.workspaces.length === 0 ? <Alert type="info" showIcon title="当前没有启用中的经营空间" description="请先在经营设置中启用服务空间，再回来发布到客户端。" /> : null}
          <Form.Item name="defaultWorkspaceId" label="默认服务" extra="留空则按空间默认标记选择；必须在已发布服务之内">
            <Input placeholder="服务空间 ID（可留空）" allowClear />
          </Form.Item>
        </Card>

        <Space style={{ marginTop: 16 }}>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending}>保存配置</Button>
          {data.updatedAt ? <Typography.Text type="secondary">上次更新：{data.updatedAt}</Typography.Text> : null}
        </Space>
      </Form>
    </Space>
  );
}

function WechatCredentialsCard() {
  const [form] = Form.useForm<SaveMiniProgramChannelRequest>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const channel = useQuery({ queryKey: ["mini-program-channel"], queryFn: clientChannelApi.getWechat });
  const enabled = Form.useWatch("enabled", form);

  useEffect(() => {
    if (!channel.data) return;
    form.setFieldsValue({ appId: channel.data.appId ?? "", appSecret: "", enabled: channel.data.enabled });
  }, [channel.data, form]);

  const save = useMutation({
    mutationFn: (values: SaveMiniProgramChannelRequest) => clientChannelApi.saveWechat({ ...values, appSecret: values.appSecret?.trim() || undefined }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["mini-program-channel"] }); message.success("微信小程序凭证已保存"); },
    onError: (error: any) => message.error(error?.response?.data?.message ?? "保存失败")
  });
  const test = useMutation({
    mutationFn: () => clientChannelApi.testWechat(),
    onSuccess: async (result) => { await queryClient.invalidateQueries({ queryKey: ["mini-program-channel"] }); result.ok ? message.success(result.message) : message.warning(result.message); },
    onError: (error: any) => message.error(error?.response?.data?.message ?? "测试失败")
  });

  if (channel.isLoading) return <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>;
  const data = channel.data;
  const identityLocked = (data?.identityCount ?? 0) > 0;

  return (
    <Card
      size="small"
      title={<Space>微信小程序凭证{data?.enabled ? <Tag color="success">已启用</Tag> : <Tag>未启用</Tag>}</Space>}
      extra={data?.lastTestStatus === "passed" ? <Tag icon={<CheckCircleOutlined />} color="success">已验证</Tag> : data?.lastTestStatus === "failed" ? <Tag color="error">测试失败</Tag> : null}
    >
      <Typography.Paragraph type="secondary">AppSecret 只在服务端加密保存、不回显。微信手机号一键登录与小程序内微信支付需要凭证就绪并通过测试。</Typography.Paragraph>
      {identityLocked ? <Alert style={{ marginBottom: 12 }} showIcon type="info" title={`已有 ${data?.identityCount} 位客户绑定微信身份`} description="AppID 与客户 openid 绑定，绑定后不能更换 AppID；如需迁移请联系平台。" /> : null}
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
        <Row gutter={[16, 0]}>
          <Col xs={24} md={12}><Form.Item name="appId" label="AppID" rules={[{ required: true, message: "请输入 AppID" }, { pattern: /^wx[0-9a-f]{16}$/i, message: "AppID 格式无效（wx 开头 18 位）" }]}><Input maxLength={191} disabled={identityLocked} placeholder="wx0123456789abcdef" /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="appSecret" label="AppSecret" extra={data?.secretConfigured ? "已配置；留空保持原密钥不变" : "首次配置必填"}><Input.Password placeholder={data?.secretConfigured ? "已配置（留空不修改）" : "AppSecret"} /></Form.Item></Col>
        </Row>
        <Form.Item name="enabled" label="启用渠道" valuePropName="checked" extra="启用前须已填写 AppSecret"><Switch /></Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending}>保存凭证</Button>
          <Button icon={<ExperimentOutlined />} onClick={() => test.mutate()} loading={test.isPending} disabled={!data?.secretConfigured && !enabled}>测试连接</Button>
          {data?.lastTestAt ? <Typography.Text type="secondary">上次测试：{data.lastTestAt}</Typography.Text> : null}
        </Space>
        {data?.lastTestStatus === "failed" && data.lastTestError ? <Alert style={{ marginTop: 12 }} showIcon type="error" title="上次测试失败" description={data.lastTestError} /> : null}
      </Form>
    </Card>
  );
}

export function ClientChannelPage() {
  return (
    <PageHeader
      title="客户端渠道"
      description="配置小程序与后续 APP 对客户展示的品牌、客服、协议、帮助与发布服务（租户级共用），以及微信小程序凭证。"
      note={{ title: "一份配置，多端共用", description: "品牌、客服、协议正文/版本、帮助与发布服务由小程序和 APP 共用；只有微信 AppID/AppSecret 是微信渠道专有。协议正文在客户端内直接渲染，请填写正文而不仅是外链。" }}
      view={<Space orientation="vertical" size={20} style={{ width: "100%" }}>
        <ProfileCard />
        <WechatCredentialsCard />
      </Space>}
    />
  );
}
