import { CheckCircleOutlined, CloudServerOutlined, ExperimentOutlined, SaveOutlined, SettingOutlined } from "@ant-design/icons";
import type {
  SaveTenantIntegrationRequest,
  TenantIntegrationCapability,
  TenantIntegrationConfigSummary,
  TenantIntegrationProviderDefinition
} from "@rental-os/shared";
import { Alert, App, Button, Card, Col, Empty, Form, Input, Row, Space, Spin, Switch, Tag, Typography } from "antd";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tenantIntegrationsApi } from "@/api/tenantIntegrations";
import { PageHeader } from "@/components/PageHeader";

const CAPABILITY_LABELS: Record<TenantIntegrationCapability, string> = { sms: "短信", payment: "支付", file: "文件存储" };

function ProviderCard({ definition, config }: { definition: TenantIntegrationProviderDefinition; config?: TenantIntegrationConfigSummary }) {
  const [form] = Form.useForm<SaveTenantIntegrationRequest>();
  const enabled = Form.useWatch("enabled", form);
  const liveVerified = config?.lastTestStatus === "passed" && config.lastTestMode === "live";
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (values: SaveTenantIntegrationRequest) => tenantIntegrationsApi.save(definition.capability, definition.provider, {
      ...values,
      credentials: Object.fromEntries(Object.entries(values.credentials ?? {}).filter(([, value]) => String(value ?? "").trim()))
    }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["tenant-integrations"] }); message.success(`${definition.name}配置已保存`); },
    onError: (error: any) => message.error(error?.response?.data?.message ?? `${definition.name}配置保存失败`)
  });
  const test = useMutation({
    mutationFn: () => tenantIntegrationsApi.test(definition.capability, definition.provider),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["tenant-integrations"] });
      result.ok ? message.success(result.message) : message.warning(result.message);
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? "连接测试失败")
  });

  useEffect(() => {
    form.setFieldsValue({ enabled: config?.enabled ?? false, isDefault: config?.isDefault ?? false, settings: config?.settings ?? {}, credentials: {} });
  }, [config, form]);

  return (
    <Card
      size="small"
      title={<Space><CloudServerOutlined /><span>{definition.name}</span>{config?.enabled ? <Tag color="success">已启用</Tag> : <Tag>未启用</Tag>}{config?.isDefault ? <Tag color="blue">默认</Tag> : null}</Space>}
      extra={config?.lastTestStatus === "passed" && config.lastTestMode === "live"
        ? <Tag icon={<CheckCircleOutlined />} color="success">已验证</Tag>
        : config?.lastTestStatus === "passed"
          ? <Tag color="processing">配置完整（未联网）</Tag>
          : config?.lastTestStatus === "failed" && config.lastTestMode === "live"
            ? <Tag color="error">连接失败</Tag>
            : config?.lastTestStatus === "failed"
              ? <Tag color="error">配置不完整</Tag>
              : null}
    >
      <Typography.Paragraph type="secondary">{definition.description}</Typography.Paragraph>
      {config?.enabled && !liveVerified ? (
        <Alert
          showIcon
          type={config.lastTestStatus === "failed" ? "error" : "warning"}
          style={{ marginBottom: 16 }}
          title={config.lastTestStatus === "failed" ? "连接测试未通过，业务暂不可用" : "尚未通过真实连接测试，业务暂不可用"}
          description="配置可以先保存，但支付下单、短信发送和文件上传等新业务调用会被服务端拒绝。请先补齐配置并点击“测试连接”，测试通过后才会进入真实运行链。"
        />
      ) : null}
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
        <Space size="large" style={{ marginBottom: 12 }}>
          <Form.Item name="enabled" label="启用此平台" valuePropName="checked" noStyle>
            <Switch onChange={(checked) => { if (!checked) form.setFieldValue("isDefault", false); }} />
          </Form.Item>
          <Form.Item name="isDefault" label="设为该能力默认平台" valuePropName="checked" noStyle>
            <Switch disabled={!enabled} />
          </Form.Item>
        </Space>
        <Row gutter={[12, 0]}>
          {definition.fields.map((field) => (
            <Col xs={24} md={12} key={field.key}>
              <Form.Item
                name={[field.secret ? "credentials" : "settings", field.key]}
                label={field.label}
                valuePropName={field.inputType === "boolean" ? "checked" : undefined}
                rules={[{ required: field.required && !field.secret, message: `请输入${field.label}` }]}
                extra={field.secret && config?.secrets.fields.includes(field.key) ? "已配置；留空保持原密钥不变" : field.description}
              >
                {field.secret
                  ? <Input.Password placeholder={config?.secrets.fields.includes(field.key) ? "已配置（留空不修改）" : field.placeholder} />
                  : field.inputType === "boolean"
                    ? <Switch />
                    : <Input type={field.inputType === "url" ? "url" : field.inputType === "number" ? "number" : "text"} placeholder={field.placeholder} />}
              </Form.Item>
            </Col>
          ))}
        </Row>
        <Space>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending}>保存配置</Button>
          <Button icon={<ExperimentOutlined />} onClick={() => test.mutate()} loading={test.isPending}>测试连接</Button>
          {config?.lastTestAt ? <Typography.Text type="secondary">上次测试：{config.lastTestAt}</Typography.Text> : null}
        </Space>
      </Form>
    </Card>
  );
}

export function TenantIntegrationsPage() {
  const catalog = useQuery({ queryKey: ["tenant-integrations"], queryFn: tenantIntegrationsApi.catalog });
  if (catalog.isLoading) return <div style={{ textAlign: "center", padding: 80 }}><Spin size="large" /></div>;
  if (catalog.error || !catalog.data) return <PageHeader title="第三方服务" description="暂时无法读取租户第三方服务配置，请刷新重试。" />;
  const configByProvider = new Map(catalog.data.configs.map((config) => [`${config.capability}:${config.provider}`, config]));
  return (
    <PageHeader
      title="第三方服务"
      description="为当前租户选择并配置短信、支付和文件存储平台。配置按租户共享给各经营空间，业务模块只使用统一适配器。"
      note={{ title: "密钥只在服务端加密保存", description: "页面不会回显 AccessKey、私钥、API 密钥等敏感值；停用平台不会删除配置，重新启用时可继续使用。“测试连接”只发起无副作用探针：支付查询随机交易号、短信查询模板、文件存储 HEAD 随机不存在对象，不会扣款、发短信或写入文件。" }}
      view={<Space orientation="vertical" size={20} style={{ width: "100%" }}>
        <Alert showIcon type="info" icon={<SettingOutlined />} title="一个能力可以配置多个平台" description="支付可以同时启用支付宝和微信支付；短信、文件存储也可以分别配置多个平台，并指定默认平台。保存某个平台时不会覆盖其他平台。" />
        {(["payment", "sms", "file"] as TenantIntegrationCapability[]).map((capability) => {
          const providers = catalog.data.providers.filter((item) => item.capability === capability);
          const configs = catalog.data.configs.filter((item) => item.capability === capability);
          const enabledWithoutDefault = configs.filter((item) => item.enabled && !item.isDefault);
          return (
            <Card key={capability} title={`${CAPABILITY_LABELS[capability]}平台`} size="small">
              {enabledWithoutDefault.length > 0 ? (
                <Alert
                  showIcon
                  type="warning"
                  style={{ marginBottom: 16 }}
                  title={`${enabledWithoutDefault.map((item) => catalog.data.providers.find((provider) => provider.provider === item.provider)?.name ?? item.provider).join("、")}已启用但未设为默认`}
                  description="业务运行只会使用默认平台，请为该能力指定一个默认平台。"
                />
              ) : null}
              <Row gutter={[20, 20]}>
                {providers.map((definition) => (
                  <Col xs={24} xl={12} key={definition.provider}>
                    <ProviderCard definition={definition} config={configByProvider.get(`${definition.capability}:${definition.provider}`)} />
                  </Col>
                ))}
              </Row>
              {providers.length === 0 ? <Empty description="暂无可用平台" /> : null}
            </Card>
          );
        })}
      </Space>}
    />
  );
}
