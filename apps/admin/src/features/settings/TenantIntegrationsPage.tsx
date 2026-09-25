import { CheckCircleOutlined, CloudServerOutlined, ExperimentOutlined, SaveOutlined, SettingOutlined } from "@ant-design/icons";
import type {
  SaveTenantIntegrationRequest,
  TenantIntegrationCapability,
  TenantIntegrationConfigSummary,
  TenantIntegrationProviderDefinition
} from "@rental-os/shared";
import { Alert, App, Button, Card, Col, Empty, Form, Input, Row, Space, Switch, Tabs, Tag, Typography } from "antd";
import type { FormInstance } from "antd";
import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tenantIntegrationsApi } from "@/api/tenantIntegrations";
import { useLocale } from "@/app/locale";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";

const CAPABILITY_LABELS: Record<TenantIntegrationCapability, string> = { sms: "短信", payment: "支付", file: "云存储" };
const CAPABILITY_TAB_LABELS: Record<TenantIntegrationCapability, string> = { sms: "短信配置", payment: "支付配置", file: "云存储配置" };

function ProviderCard({
  definition,
  config,
  providerKey,
  registerForm,
  onDefaultChange
}: {
  definition: TenantIntegrationProviderDefinition;
  config?: TenantIntegrationConfigSummary;
  providerKey: string;
  registerForm: (key: string, form?: FormInstance<SaveTenantIntegrationRequest>) => void;
  onDefaultChange: (key: string, checked: boolean) => void;
}) {
  const { t } = useLocale();
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
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["tenant-integrations"] }); message.success(`${t(definition.name)}${t("配置已保存")}`); },
    onError: (error: any) => message.error(error?.response?.data?.message ?? `${t(definition.name)}${t("配置保存失败")}`)
  });
  const test = useMutation({
    mutationFn: () => tenantIntegrationsApi.test(definition.capability, definition.provider),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["tenant-integrations"] });
      result.ok ? message.success(result.message) : message.warning(result.message);
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? t("连接测试失败"))
  });

  useEffect(() => {
    form.setFieldsValue({ enabled: config?.enabled ?? false, isDefault: config?.isDefault ?? false, settings: config?.settings ?? {}, credentials: {} });
  }, [config, form]);

  useEffect(() => {
    registerForm(providerKey, form);
    return () => registerForm(providerKey);
  }, [form, providerKey, registerForm]);

  return (
    <Card
      size="small"
      title={<Space><CloudServerOutlined /><span>{t(definition.name)}</span>{config?.enabled ? <Tag color="success">{t("已启用")}</Tag> : <Tag>{t("未启用")}</Tag>}{config?.isDefault ? <Tag color="processing">{t("默认")}</Tag> : null}</Space>}
      extra={config?.lastTestStatus === "passed" && config.lastTestMode === "live"
        ? <Tag icon={<CheckCircleOutlined />} color="success">{t("已验证")}</Tag>
        : config?.lastTestStatus === "passed"
          ? <Tag color="processing">{t("配置完整（未联网）")}</Tag>
          : config?.lastTestStatus === "failed" && config.lastTestMode === "live"
            ? <Tag color="error">{t("连接失败")}</Tag>
            : config?.lastTestStatus === "failed"
              ? <Tag color="error">{t("配置不完整")}</Tag>
              : null}
    >
      <Typography.Paragraph type="secondary">{t(definition.description)}</Typography.Paragraph>
      {config?.enabled && !liveVerified ? (
        <Alert
          showIcon
          type={config.lastTestStatus === "failed" ? "error" : "warning"}
          style={{ marginBottom: 16 }}
          title={config.lastTestStatus === "failed" ? t("连接测试未通过，业务暂不可用") : t("尚未通过真实连接测试，业务暂不可用")}
          description={t("配置可以先保存，但支付下单、短信发送和文件上传等新业务调用会被服务端拒绝。请先补齐配置并点击“测试连接”，测试通过后才会进入真实运行链。")}
        />
      ) : null}
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
        <Space size="large" align="start" style={{ marginBottom: 12 }}>
          <Form.Item
            name="enabled"
            label={t("启用此平台")}
            tooltip={t("允许系统调用这个平台；保存后还需要通过“测试连接”才能真正用于业务。")}
            extra={t("关闭后保留配置，但业务不会调用。")}
            valuePropName="checked"
            style={{ marginBottom: 0 }}
          >
            <Switch onChange={(checked) => {
              if (!checked) {
                form.setFieldValue("isDefault", false);
                onDefaultChange(providerKey, false);
              }
            }} />
          </Form.Item>
          <Form.Item
            name="isDefault"
            label={t("设为该能力默认平台")}
            tooltip={t("同一种能力可以配置多个平台，但实际支付、短信或文件调用只使用默认平台。")}
            extra={t("同一能力只能有一个默认平台。")}
            valuePropName="checked"
            style={{ marginBottom: 0 }}
          >
            <Switch disabled={!enabled} onChange={(checked) => onDefaultChange(providerKey, checked)} />
          </Form.Item>
        </Space>
        <Row gutter={[12, 0]}>
          {definition.fields.map((field) => (
            <Col xs={24} md={12} key={field.key}>
              <Form.Item
                name={[field.secret ? "credentials" : "settings", field.key]}
                label={t(field.label)}
                valuePropName={field.inputType === "boolean" ? "checked" : undefined}
                rules={[{ required: field.required && !field.secret, message: `${t("请输入")}${t(field.label)}` }]}
                extra={field.secret && config?.secrets.fields.includes(field.key) ? t("已配置；留空保持原密钥不变") : field.description ? t(field.description) : undefined}
              >
                {field.secret
                  ? <Input.Password placeholder={config?.secrets.fields.includes(field.key) ? t("已配置（留空不修改）") : field.placeholder ? t(field.placeholder) : undefined} />
                  : field.inputType === "boolean"
                    ? <Switch />
                    : <Input type={field.inputType === "url" ? "url" : field.inputType === "number" ? "number" : "text"} placeholder={field.placeholder} />}
              </Form.Item>
            </Col>
          ))}
        </Row>
        <Space>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending}>{t("保存配置")}</Button>
          <Button icon={<ExperimentOutlined />} onClick={() => test.mutate()} loading={test.isPending}>{t("测试连接")}</Button>
          {config?.lastTestAt ? <Typography.Text type="secondary">{t("上次测试")}: {config.lastTestAt}</Typography.Text> : null}
        </Space>
      </Form>
    </Card>
  );
}

export function TenantIntegrationsPage() {
  const { t } = useLocale();
  const catalog = useQuery({ queryKey: ["tenant-integrations"], queryFn: tenantIntegrationsApi.catalog });
  const providerForms = useRef(new Map<string, FormInstance<SaveTenantIntegrationRequest>>());
  const registerProviderForm = useCallback((key: string, form?: FormInstance<SaveTenantIntegrationRequest>) => {
    if (form) providerForms.current.set(key, form);
    else providerForms.current.delete(key);
  }, []);
  const handleDefaultChange = useCallback((key: string, checked: boolean) => {
    if (!checked) return;
    const capabilityPrefix = `${key.slice(0, key.indexOf(":"))}:`;
    for (const [otherKey, otherForm] of providerForms.current) {
      if (otherKey !== key && otherKey.startsWith(capabilityPrefix)) otherForm.setFieldValue("isDefault", false);
    }
  }, []);
  if (catalog.isLoading) return <div style={{ textAlign: "center", padding: 80 }}><LoadingState /></div>;
  if (catalog.error || !catalog.data) return <PageHeader title={t("第三方服务")} description={t("暂时无法读取租户第三方服务配置，请刷新重试。")} />;
  const configByProvider = new Map(catalog.data.configs.map((config) => [`${config.capability}:${config.provider}`, config]));
  return (
    <PageHeader
      title={t("第三方服务")}
      description={t("为当前租户选择并配置支付、短信和云存储平台。配置按租户共享给各经营空间，业务模块只使用统一适配器。")}
      note={{ title: t("密钥只在服务端加密保存"), description: t("页面不会回显 AccessKey、私钥、API 密钥等敏感值；停用平台不会删除配置，重新启用时可继续使用。“测试连接”只发起无副作用探针：支付查询随机交易号、短信查询模板、云存储 HEAD 随机不存在对象，不会扣款、发短信或写入文件。") }}
      view={<Space orientation="vertical" size={20} style={{ width: "100%" }}>
        <Alert showIcon type="info" icon={<SettingOutlined />} title={t("一个能力可以配置多个平台")} description={t("支付可以同时启用支付宝和微信支付；短信、云存储也可以分别配置多个平台，并指定默认平台。保存某个平台时不会覆盖其他平台。")} />
        <Tabs
          tabBarGutter={32}
          items={(["payment", "sms", "file"] as TenantIntegrationCapability[]).map((capability) => {
            const providers = catalog.data.providers.filter((item) => item.capability === capability);
            const configs = catalog.data.configs.filter((item) => item.capability === capability);
            const enabledWithoutDefault = configs.filter((item) => item.enabled && !item.isDefault);
            return {
              key: capability,
              label: t(CAPABILITY_TAB_LABELS[capability]),
              children: (
                <>
                  {enabledWithoutDefault.length > 0 ? (
                    <Alert
                      showIcon
                      type="warning"
                      style={{ marginBottom: 16 }}
                      title={`${enabledWithoutDefault.map((item) => t(catalog.data.providers.find((provider) => provider.provider === item.provider)?.name ?? item.provider)).join(", ")} ${t("已启用但未设为默认")}`}
                      description={t("业务运行只会使用默认平台，请为该能力指定一个默认平台。")}
                    />
                  ) : null}
                  <Row gutter={[20, 20]}>
                    {providers.map((definition) => (
                      <Col xs={24} xl={12} key={definition.provider}>
                        <ProviderCard
                          definition={definition}
                          config={configByProvider.get(`${definition.capability}:${definition.provider}`)}
                          providerKey={`${definition.capability}:${definition.provider}`}
                          registerForm={registerProviderForm}
                          onDefaultChange={handleDefaultChange}
                        />
                      </Col>
                    ))}
                  </Row>
                  {providers.length === 0 ? <Empty description={t("暂无可用平台")} /> : null}
                </>
              )
            };
          })}
        />
      </Space>}
    />
  );
}
