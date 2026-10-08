import { SaveButton } from "@/components/ui";
import { BellOutlined, PlayCircleOutlined, SaveOutlined } from "@ant-design/icons";
import type { InvokeMockAdapterRequest, SendMockNotificationRequest, SystemSecurityBaselineConfig } from "@rental-os/shared";
import { Card, Col, Descriptions, InputNumber, Row, Space, Tag, Typography } from "antd";
import { App } from "@/components/ui";
import { Form } from "@/components/ui";
import { Table } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { Button, Drawer, Tabs } from "@/components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/api/platform";
import { platformOpsApi } from "@/api/platformOps";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const capabilityLabels: Record<string, string> = { payment: "支付", pre_auth: "预授权", sms: "短信", email: "邮件", app_push: "应用推送", e_contract: "电子合同", tbox: "TBox", ai_dispatch: "智能调度", export: "数据导出", print: "打印", file: "文件" };

type AdapterFormValues = Omit<InvokeMockAdapterRequest, "payload" | "operator"> & { payloadText?: string };
type ConfirmationFormValues = { action: string; confirmationCode?: string };

export function PlatformOperationsPage() {
  const { message, modal } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const operator = useAuthStore((state) => state.user?.displayName ?? "租户管理员");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [toolResult, setToolResult] = useState<unknown>();
  const [securityForm] = Form.useForm<SystemSecurityBaselineConfig>();
  const [notificationForm] = Form.useForm<SendMockNotificationRequest>();
  const [adapterForm] = Form.useForm<AdapterFormValues>();
  const [confirmationForm] = Form.useForm<ConfirmationFormValues>();
  const infra = useQuery({ queryKey: ["integrations"], queryFn: platformOpsApi.integrations });
  const security = useQuery({ queryKey: ["security-baseline"], queryFn: api.securityBaseline });
  useEffect(() => { if (security.data) securityForm.setFieldsValue(security.data); }, [security.data, securityForm]);
  const saveSecurity = useMutation({ mutationFn: (config: SystemSecurityBaselineConfig) => api.saveSecurityBaseline(config, operator), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["security-baseline"] }); message.success(t("安全基线已保存")); }, onError: () => message.error(t("安全基线保存失败")) });
  const sendNotification = useMutation({ mutationFn: platformOpsApi.sendNotification, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["integrations"] }); setNotificationOpen(false); notificationForm.resetFields(); message.success(t("模拟通知已写入发送日志")); }, onError: () => message.error(t("模拟通知发送失败")) });
  const runJob = useMutation({ mutationFn: platformOpsApi.runJob, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["integrations"] }); message.success(t("任务已执行并刷新状态")); }, onError: () => message.error(t("任务执行失败")) });
  const invokeAdapter = useMutation({ mutationFn: (values: AdapterFormValues) => platformOpsApi.invokeMockAdapter({ ...values, payload: values.payloadText ? JSON.parse(values.payloadText) as Record<string, unknown> : {}, operator }), onSuccess: async (result) => { setToolResult(result); await queryClient.invalidateQueries({ queryKey: ["integrations"] }); message.success(t("Mock 适配器调用完成")); }, onError: () => message.error(t("调用失败，请检查 JSON 与适配器参数")) });
  const checkConfirmation = useMutation({ mutationFn: (values: ConfirmationFormValues) => api.checkSecondConfirmation(values.action, values.confirmationCode), onSuccess: (result) => setToolResult(result), onError: () => message.error(t("二次确认检查失败")) });

  function confirmRun(id: string, jobType: string) {
    modal.confirm({ title: `${t("立即执行任务")} ${jobType}?`, content: t("该操作会写入异步任务执行结果。当前内置任务为 mock/本地能力，接入真实外部系统前需重新评估影响。"), okText: t("执行任务"), onOk: () => runJob.mutateAsync(id) });
  }

  return (
    <>
      <PageHeader title={t("平台运维中心")} description={t("查看集成能力、文件、通知与异步任务，并维护登录和敏感信息安全基线。")} note={{ title: t("能力状态以实际提供方为准"), description: t("mode=mock/reserved 只代表接口和留痕已预留，不代表支付、短信、电子签章或设备厂商已完成生产接入。") }} extra={<Button type="primary" icon={<BellOutlined />} onClick={() => setNotificationOpen(true)}>{t("模拟通知")}</Button>} />
      <Card className="tabbed-workspace">
        <Tabs className="standalone-tabs" items={[
          {
            key: "capabilities",
            label: t("集成能力"),
            children: <QueryState loading={infra.isLoading} error={infra.error}><Table rowKey="capability" dataSource={infra.data?.capabilities ?? []} columns={[
              { title: t("能力"), render: (_, record) => <><b>{t(capabilityLabels[record.capability] ?? record.name)}</b><br /><span className="muted">{record.provider}</span></> },
              { title: t("模式"), dataIndex: "mode", render: (value) => <Tag color={value === "real" ? "success" : value === "mock" ? "blue" : "default"}>{value}</Tag> },
              { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{t(value)}</Tag> },
              { title: t("调用次数"), dataIndex: "totalLogs" },
              { title: t("说明"), dataIndex: "description" },
              { title: t("下一接入点"), dataIndex: "nextIntegrationPoint" }
            ]} /></QueryState>
          },
          {
            key: "files",
            label: `${t("文件")} (${infra.data?.files.length ?? 0})`,
            children: <QueryState loading={infra.isLoading} error={infra.error}><Table rowKey="id" dataSource={infra.data?.files ?? []} columns={[
              { title: t("文件"), render: (_, record) => <><b>{record.fileName}</b><br /><span className="muted">{record.mimeType}</span></> },
              { title: t("业务模块"), dataIndex: "businessModule" },
              { title: t("业务类型"), dataIndex: "businessType" },
              { title: t("场景"), dataIndex: "uploadScene" },
              { title: t("存储"), render: (_, record) => `${record.storageProvider} / ${t("受保护对象引用")}` },
              { title: t("上传时间"), dataIndex: "createdAt" },
              { title: t("状态"), dataIndex: "status", render: (value) => <Tag>{t(value)}</Tag> }
            ]} /></QueryState>
          },
          {
            key: "notifications",
            label: `${t("通知日志")} (${infra.data?.notificationLogs.length ?? 0})`,
            children: <QueryState loading={infra.isLoading} error={infra.error}><Table rowKey="id" dataSource={infra.data?.notificationLogs ?? []} columns={[
              { title: t("模板 / 业务"), render: (_, record) => <><b>{record.templateCode ?? t("自定义")}</b><br /><span className="muted">{record.businessType} · {record.businessId ?? "—"}</span></> },
              { title: t("接收方"), render: (_, record) => `${record.targetName ?? record.targetType} ${record.targetMasked ?? ""}` },
              { title: t("渠道"), dataIndex: "channels", render: (values: string[]) => <Space>{values.map((value) => <Tag key={value}>{t(value)}</Tag>)}</Space> },
              { title: t("提供方"), dataIndex: "provider" },
              { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "mock_success" ? "blue" : "default"}>{t(value)}</Tag> },
              { title: t("时间"), render: (_, record) => record.sentAt ?? record.createdAt }
            ]} /></QueryState>
          },
          {
            key: "jobs",
            label: `${t("异步任务")} (${infra.data?.jobs.length ?? 0})`,
            children: <QueryState loading={infra.isLoading} error={infra.error}><Table rowKey="id" dataSource={infra.data?.jobs ?? []} columns={[
              { title: t("任务类型"), dataIndex: "jobType", render: (value, record) => <><b>{value}</b><br /><span className="muted">{record.businessType ?? t("平台")} · {record.businessId ?? "—"}</span></> },
              { title: t("计划时间"), dataIndex: "scheduledAt", render: (value) => value ?? t("立即") },
              { title: t("尝试次数"), render: (_, record) => `${record.attempt} / ${record.maxAttempts}` },
              { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "success" ? "success" : value === "failed" ? "error" : value === "queued" ? "warning" : "processing"}>{t(value)}</Tag> },
              { title: t("更新时间"), dataIndex: "updatedAt" },
              { title: t("操作"), render: (_, record) => <Button type="link" icon={<PlayCircleOutlined />} disabled={record.status === "running"} loading={runJob.isPending} onClick={() => confirmRun(record.id, record.jobType)}>{t("立即执行")}</Button> }
            ]} /></QueryState>
          },
          {
            key: "adapter-tools",
            label: t("适配器与二次确认测试"),
            children: <Row gutter={[20, 20]}>
              <Col xs={24} xl={12}><Card size="small" title={t("Mock 适配器调用")}><Form<AdapterFormValues> form={adapterForm} layout="vertical" initialValues={{ provider: "mock", capability: "payment", operation: "health_check", payloadText: "{}" }} onFinish={(values) => invokeAdapter.mutate(values)}>
                <Row gutter={12}><Col span={12}><Form.Item name="provider" label={t("提供方")} rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="capability" label={t("能力")} rules={[{ required: true }]}><Select options={Object.entries(capabilityLabels).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item></Col></Row>
                <Form.Item name="operation" label={t("操作")} rules={[{ required: true }]}><Input /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="businessType" label={t("业务类型")}><Input /></Form.Item></Col><Col span={12}><Form.Item name="businessId" label={t("业务 ID")}><Input /></Form.Item></Col></Row><Form.Item name="payloadText" label={t("请求 JSON")}><Input.TextArea rows={6} /></Form.Item><SaveButton  label={t("执行 Mock 调用")} form={adapterForm} pending={invokeAdapter.isPending} onSave={(values) => invokeAdapter.mutateAsync(values)} />
              </Form></Card></Col>
              <Col xs={24} xl={12}><Card size="small" title={t("高风险操作二次确认检查")}><Form<ConfirmationFormValues> form={confirmationForm} layout="vertical" initialValues={{ action: "vehicle_remote_unlock" }} onFinish={(values) => checkConfirmation.mutate(values)}><Form.Item name="action" label={t("动作编码")} rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="confirmationCode" label={t("确认码")}><Input.Password /></Form.Item><SaveButton  label={t("检查确认要求")} form={confirmationForm} pending={checkConfirmation.isPending} onSave={(values) => checkConfirmation.mutateAsync(values)} /></Form>
                <Typography.Title level={5} style={{ marginTop: 20 }}>{t("最近结果")}</Typography.Title><Input.TextArea readOnly autoSize={{ minRows: 8, maxRows: 18 }} value={toolResult ? JSON.stringify(toolResult, null, 2) : t("尚未执行")} />
              </Card></Col>
            </Row>
          },
          {
            key: "security",
            label: t("安全基线"),
            children: <QueryState loading={security.isLoading} error={security.error}><Form form={securityForm} layout="vertical" onFinish={(values) => saveSecurity.mutate(values)}>
              <Row gutter={[24, 8]}>
                <Col xs={24} xl={12}>
                  <Card size="small" title={t("登录限流")}>
                    <Form.Item name={["loginRateLimit", "enabled"]} label={t("启用失败锁定")} valuePropName="checked"><Switch /></Form.Item>
                    <Row gutter={12}>
                      <Col span={8}><Form.Item name={["loginRateLimit", "maxFailures"]} label={t("最大失败次数")}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col span={8}><Form.Item name={["loginRateLimit", "windowMinutes"]} label={t("统计窗口(分)")}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col span={8}><Form.Item name={["loginRateLimit", "lockMinutes"]} label={t("锁定时长(分)")}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
                    </Row>
                  </Card>
                </Col>
                <Col xs={24} xl={12}>
                  <Card size="small" title={t("密码策略")}>
                    <Row gutter={12}>
                      <Col span={8}><Form.Item name={["passwordPolicy", "minLength"]} label={t("最小长度")}><InputNumber min={8} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col span={8}><Form.Item name={["passwordPolicy", "expireDays"]} label={t("有效天数")}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                    </Row>
                    <Space size="large"><Form.Item name={["passwordPolicy", "requireLetter"]} label={t("必须含字母")} valuePropName="checked"><Switch /></Form.Item><Form.Item name={["passwordPolicy", "requireNumber"]} label={t("必须含数字")} valuePropName="checked"><Switch /></Form.Item><Form.Item name={["passwordPolicy", "disallowDefaultPassword"]} label={t("禁用默认密码")} valuePropName="checked"><Switch /></Form.Item></Space>
                  </Card>
                </Col>
                <Col xs={24} xl={12}>
                  <Card size="small" title={t("敏感信息脱敏")}>
                    <Space wrap size="large">{[["phone", "手机号"], ["identityNo", "身份证"], ["driverLicenseNo", "资质证件"], ["email", "邮箱"], ["apiKey", "API Key"]].map(([key, label]) => <Form.Item key={key} name={["masking", key]} label={t(label)} valuePropName="checked"><Switch /></Form.Item>)}</Space>
                  </Card>
                </Col>
                <Col xs={24} xl={12}>
                  <Card size="small" title={t("高风险操作二次确认")}>
                    <Form.Item name={["secondConfirmation", "enabled"]} label={t("启用")} valuePropName="checked"><Switch /></Form.Item>
                    <Form.Item name={["secondConfirmation", "actions"]} label={t("受控动作")}><Select mode="tags" tokenSeparators={[","]} /></Form.Item>
                  </Card>
                </Col>
              </Row>
              <div className="form-actions"><SaveButton  label={t("保存安全基线")} form={securityForm} pending={saveSecurity.isPending} onSave={(values) => saveSecurity.mutateAsync(values)} /></div>
            </Form></QueryState>
          }
        ]} />
      </Card>

      <Drawer title={t("发送模拟通知")} open={notificationOpen} size={480} destroyOnHidden onClose={() => setNotificationOpen(false)} extra={<SaveButton  label={t("写入发送日志")} form={notificationForm} pending={sendNotification.isPending} onSave={(values) => sendNotification.mutateAsync({ ...values, operator })} />}>
        <Typography.Paragraph type="secondary">{t("该功能使用 mock provider，只验证模板变量、渠道选择和审计留痕。")}</Typography.Paragraph>
        <Form<SendMockNotificationRequest> form={notificationForm} layout="vertical" initialValues={{ businessType: "rental_order", targetType: "member", channels: ["APP"] }} onFinish={(values) => sendNotification.mutate({ ...values, operator })}>
          <Form.Item name="templateCode" label={t("通知模板")}><Select allowClear options={(infra.data?.notificationTemplates ?? []).filter((item) => item.enabled).map((item) => ({ value: item.code, label: `${item.name} · ${item.code}` }))} /></Form.Item>
          <Form.Item name="businessType" label={t("业务类型")} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="businessId" label={t("业务 ID")}><Input /></Form.Item>
          <Form.Item name="targetType" label={t("接收方类型")} rules={[{ required: true }]}><Select options={[{ value: "member", label: t("个人会员") }, { value: "corporate", label: t("企业客户") }, { value: "operator", label: t("运营人员") }]} /></Form.Item>
          <Form.Item name="targetName" label={t("接收方名称")}><Input /></Form.Item>
          <Form.Item name="targetMasked" label={t("脱敏联系方式")}><Input placeholder={t("例如 138****0000")} /></Form.Item>
          <Form.Item name="channels" label={t("渠道")} rules={[{ required: true }]}><Select mode="multiple" options={[{ value: "APP", label: "APP" }, { value: "SMS", label: t("短信（mock）") }, { value: "EMAIL", label: t("邮件（mock）") }]} /></Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
