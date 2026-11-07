import { motion } from "motion/react";
import { CreditCard, MessageSquare, HardDrive } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { InsightMetrics } from "@/components/BusinessInsights";
import directory from "./integrations-source/classes.json";
import "./integrations-source/original.css";
import directoryStyles from "./IntegrationDirectory.module.css";
import { CheckCircleOutlined, CloudServerOutlined, SettingOutlined } from "@/components/ui/icons";
import type {
  SaveTenantIntegrationRequest,
  TenantIntegrationCapability,
  TenantIntegrationConfigSummary,
  TenantIntegrationProviderDefinition
} from "@rental-os/shared";
import { Card, Col, Row, Space, Tag, Typography } from "antd";
import { App, Empty } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert } from "@/components/ui";
import { Input, Switch } from "@/components/ui";
import { ActionButton, AnimatedNumber, Button, Drawer, SearchField, Segmented, SaveButton, Tabs } from "@/components/ui";
import type { FormInstance } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tenantIntegrationsApi } from "@/api/tenantIntegrations";
import { useLocale } from "@/app/locale";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { useServerFormSync } from "@/app/useServerFormSync";
import { isTransientRefreshError } from "@/app/queryClient";

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
  const [testFeedback, setTestFeedback] = useState<"failed" | "live" | "config" | null>(null);
  const save = useMutation({
    mutationFn: async (values: SaveTenantIntegrationRequest) => {
      if (!configCurrent()) throw new Error(t("服务端配置已变更，请重新打开本页核对后再保存"));
      return tenantIntegrationsApi.save(definition.capability, definition.provider, {
      ...values,
      credentials: Object.fromEntries(Object.entries(values.credentials ?? {}).filter(([, value]) => String(value ?? "").trim()))
      });
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["tenant-integrations"] }); message.success(`${t(definition.name)}${t("配置已保存")}`); },
    onError: (error: any) => message.error(error?.response?.data?.message ?? error?.message ?? `${t(definition.name)}${t("配置保存失败")}`)
  });
  const test = useMutation({
    mutationFn: () => tenantIntegrationsApi.test(definition.capability, definition.provider),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["tenant-integrations"] });
      result.ok ? message.success(result.message) : message.warning(result.message);
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? t("连接测试失败"))
  });

  const configCurrent = useServerFormSync(form, config ?? definition, () => {
    form.setFieldsValue({ enabled: config?.enabled ?? false, isDefault: config?.isDefault ?? false, settings: config?.settings ?? {}, credentials: {} });
  });

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
        <Space wrap>
          <SaveButton label={t("保存配置")} form={form} pending={save.isPending} onSave={(values) => save.mutateAsync(values)} />
          <ActionButton variant="secondary" className="arc-action-connect" label={testFeedback === "failed" ? t("连接失败，重试") : t("测试连接")}
            pendingLabel={t("测试中")} successLabel={testFeedback === "live" ? t("连接成功") : t("配置完整（未联网）")}
            pending={test.isPending} disabled={save.isPending} onActionError={() => setTestFeedback("failed")} onAction={async () => {
            setTestFeedback(null);
            const result = await test.mutateAsync();
            if (!result.ok) throw new Error(result.message);
            setTestFeedback(result.mode === "live" ? "live" : "config");
          }} />
          {config?.lastTestAt ? <Typography.Text type="secondary">{t("上次测试")}: {config.lastTestAt}</Typography.Text> : null}
        </Space>
      </Form>
    </Card>
  );
}

export function TenantIntegrationsPage() {
  const { t } = useLocale();
  const reduced = usePrefersReducedMotion();
  const [filter,setFilter] = useState("all");
  const [keyword,setKeyword] = useState("");
  const [layout,setLayout] = useState("cards");
  const [selectedKey,setSelectedKey] = useState<string>();
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
  if (!catalog.data || catalog.error && !isTransientRefreshError(catalog.error)) return <PageHeader title={t("第三方服务")} view={<Alert type="error" showIcon title={t("暂时无法读取租户第三方服务配置，请刷新重试。")} action={<Button onClick={() => catalog.refetch()}>{t("重试")}</Button>} />} />;
  const configByProvider = new Map(catalog.data.configs.map((config) => [`${config.capability}:${config.provider}`, config]));
  const selected = catalog.data.providers.find(item => selectedKey === item.capability + ":" + item.provider);
  const searched = catalog.data.providers.filter(item => (t(item.name)+" "+t(item.description)).toLocaleLowerCase().includes(keyword.toLocaleLowerCase()));
  const visible = searched.filter(item => filter === "all" || filter === "enabled" && configByProvider.get(item.capability+":"+item.provider)?.enabled || item.capability === filter);
  const icons = {payment:CreditCard,sms:MessageSquare,file:HardDrive};
  return <>
    <PageHeader title={t("第三方服务")} summary={<InsightMetrics items={[{label:t("服务平台"),value:visible.length},{label:t("已启用"),value:visible.filter(item=>configByProvider.get(item.capability+":"+item.provider)?.enabled).length},{label:t("已验证"),value:visible.filter(item=>{const config=configByProvider.get(item.capability+":"+item.provider);return config?.enabled&&config.lastTestStatus==="passed"&&config.lastTestMode==="live";}).length}]}/>}
      note={{title:t("密钥只在服务端加密保存"),description:t("页面不会回显 AccessKey、私钥、API 密钥等敏感值；停用平台不会删除配置，重新启用时可继续使用。“测试连接”只发起无副作用探针：支付查询随机交易号、短信查询模板、云存储 HEAD 随机不存在对象，不会扣款、发短信或写入文件。")}}/>
    {catalog.data.configs.some(config=>config.enabled&&!config.isDefault)&&<Alert type="warning" showIcon title={t("已启用但未设为默认")} description={t("业务运行只会使用默认平台，请为该能力指定一个默认平台。")} style={{marginBottom:"var(--space-4)"}}/>}
    <section className={directory.root+" "+directoryStyles.root}>
      <div className={directoryStyles.tools}><SearchField label={t("查找服务平台")} placeholder={t("查找服务平台")} value={keyword} onValueChange={setKeyword}/><Segmented value={layout} onChange={value=>setLayout(String(value))} options={[{value:"cards",label:t("卡片")},{value:"list",label:t("目录")}]}/></div>
      <div className={directoryStyles.tabs}><Segmented value={filter} onChange={value=>setFilter(String(value))} options={[
        {value:"all",label:<>{t("全部")} <AnimatedNumber value={searched.length}/></>},
        {value:"enabled",label:<>{t("已启用")} <AnimatedNumber value={searched.filter(item=>configByProvider.get(item.capability+":"+item.provider)?.enabled).length}/></>},
        ...(["payment","sms","file"] as TenantIntegrationCapability[]).map(cap=>({value:cap,label:<>{t(CAPABILITY_LABELS[cap])} <AnimatedNumber value={searched.filter(item=>item.capability===cap).length}/></>}))
      ]}/></div>
      {(keyword||filter!=="all")&&<Button type="text" onClick={()=>{setKeyword("");setFilter("all");}}>{t("清除筛选")}</Button>}
      <ul className={layout==="cards"?directoryStyles.grid:directory.list}>{visible.map(definition=>{
        const key=definition.capability+":"+definition.provider, config=configByProvider.get(key), Icon=icons[definition.capability];
        const ready=config?.enabled&&config.lastTestMode==="live"&&config.lastTestStatus==="passed";
        return <motion.li layout={reduced?false:"position"} transition={{duration:.2}} key={key} className={directory.card}>
          <span className={directoryStyles.icon}><Icon size={18}/></span><div className={directory.cardBody}>
            <div className={directory.cardTitle}><h2 className={directory.cardName}><button className={directory.cardOpen} onClick={()=>setSelectedKey(key)}>{t(definition.name)}</button></h2><span className={directory.cardCategory}>{t(CAPABILITY_LABELS[definition.capability])}</span></div>
            <p className={directory.cardText}>{t(definition.description)}</p>
          </div><div className={directory.cardActions}>
            <span className={directoryStyles.status} data-ready={ready||undefined}>{t(ready?"已验证":config?.enabled?"待验证":"未启用")}{config?.isDefault?" · "+t("默认"):""}</span>
            <Button size="small" onClick={()=>setSelectedKey(key)}>{t(config?"配置":"设置连接")}</Button>
          </div>
        </motion.li>;
      })}</ul>
      {!visible.length&&<Empty description={t("没有匹配的服务平台")}/>}
    </section>
    <Drawer title={selected?t(selected.name):t("服务配置")} open={Boolean(selected)} onClose={()=>setSelectedKey(undefined)} size={720} destroyOnHidden>
      {selected&&<div className={directoryStyles.cardEditor}><ProviderCard key={selectedKey} definition={selected} config={configByProvider.get(selectedKey!)} providerKey={selectedKey!} registerForm={registerProviderForm} onDefaultChange={handleDefaultChange}/></div>}
    </Drawer>
  </>;
}
