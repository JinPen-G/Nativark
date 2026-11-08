/** Template configuration and delivery observation use the original versioned APIs. Sending and provider checks require an explicit action. */
import type { RentalNotificationSendLogV1, RentalNotificationTemplateV1, SaveRentalNotificationTemplateRequest, SendRentalNotificationRequest, TenantRentalBusinessSettings } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, Row, Space, Tag } from "antd";
import { FileText, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionButton, Alert, App, Button, Checkbox, DataTableRowActions, DataTableText, Form, FormSection, Input, ListFilters, ListSection, Modal, SaveButton, Select, Table, Tabs, useListFilter } from "@/components/ui";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { RecordFacts } from "@/components/RecordDetailLayout";
import { QueryState } from "@/components/QueryState";
import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { useLocale } from "@/app/locale";
import { rentalCoreApi } from "@/api/rentalCore";
import { notificationChannelLabels, notificationEventLabels } from "./ruleOptionLabels";
import type { GovernancePermissions } from "./shared";
import { notificationVariableRows, notificationVariableSchema, type NotificationVariableRow } from "./notificationTemplateForm";
import styles from "./GovernanceForms.module.css";

type TemplateForm = Omit<SaveRentalNotificationTemplateRequest, "variableSchema"> & { variableDefinitions: NotificationVariableRow[] };
const deliveryLabels: Record<RentalNotificationSendLogV1["status"], string> = {
  sent: "服务商已受理", delivered: "已送达", delivery_pending: "等待回执", delivery_failed: "投递失败",
  delivery_uncertain: "结果未知", queued: "待发送", failed: "发送失败", simulated: "模拟", simulation_failed: "模拟失败",
};
const deliveryColor = (status: RentalNotificationSendLogV1["status"]) => status === "delivered" ? "success"
  : status === "sent" || status === "delivery_pending" ? "processing" : status === "simulated" ? "default"
    : status === "queued" || status === "delivery_uncertain" ? "warning" : "error";

export function NotificationsTab({ permissions, settings }: { permissions: GovernancePermissions; settings: TenantRentalBusinessSettings }) {
  const { message } = App.useApp();
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const canManage = permissions.canManageNotifications;
  const [templateEditor, setTemplateEditor] = useState<RentalNotificationTemplateV1 | null>();
  const [sendTemplate, setSendTemplate] = useState<RentalNotificationTemplateV1>();
  const [deliveryTarget, setDeliveryTarget] = useState<RentalNotificationSendLogV1>();
  const deliveryDialog = useModalDismissal(Boolean(deliveryTarget), () => setDeliveryTarget(undefined));
  const [templateForm] = Form.useForm<TemplateForm>();
  const [sendForm] = Form.useForm<SendRentalNotificationRequest>();
  const templateDialog = useModalDismissal(Boolean(templateEditor), () => { setTemplateEditor(undefined); templateForm.resetFields(); });
  const sendDialog = useModalDismissal(Boolean(sendTemplate), () => { setSendTemplate(undefined); sendForm.resetFields(); });
  const templateChannel = Form.useWatch("channel", templateForm);
  const eventLabel = (code: string) => t(notificationEventLabels[code] ?? code);
  const channelLabel = (code: string) => t(notificationChannelLabels[code] ?? code);
  const templates = useQuery({ queryKey: ["rental-core", "notification-templates"], queryFn: rentalCoreApi.notificationTemplates, enabled: canManage });
  const logs = useQuery({ queryKey: ["rental-core", "notification-logs"], queryFn: rentalCoreApi.notificationLogs, enabled: canManage });
  const templateFilter = useListFilter(templates.data, { fields: row => [row.name, row.title, row.eventCode, eventLabel(row.eventCode)], status: row => row.channel });
  const logFilter = useListFilter(logs.data, { fields: row => [row.eventCode, eventLabel(row.eventCode), row.recipient, row.provider, row.providerMessageId], status: row => row.status });
  const refreshLogs = () => queryClient.invalidateQueries({ queryKey: ["rental-core", "notification-logs"] });
  const saveTemplate = useMutation({
    mutationFn: (values: TemplateForm) => {
      const { variableDefinitions, ...rest } = values;
      return rentalCoreApi.saveNotificationTemplate({ ...rest, variableSchema: notificationVariableSchema(variableDefinitions) });
    },
    onSuccess: async () => { templateDialog.dismiss(); await queryClient.invalidateQueries({ queryKey: ["rental-core", "notification-templates"] }); message.success(t("通知模板新版本已保存")); },
    onError: () => message.error(t("模板保存失败，请检查事件、渠道、模板变量和占位符")),
  });
  const sendNotification = useMutation({
    mutationFn: (values: SendRentalNotificationRequest) => rentalCoreApi.sendNotification({ ...values, variables: values.variables ?? {} }),
    onSuccess: async () => { sendDialog.dismiss(); await refreshLogs(); message.success(t("通知已处理并记录投递结果")); },
    onError: () => message.error(t("发送失败，请检查必填变量和接收人")),
  });
  const retryNotification = useMutation({ mutationFn: rentalCoreApi.retryNotification, onSuccess: async result => {
    await refreshLogs(); message.success(t(result.status === "sent" ? "短信已被服务商受理" : result.status === "delivery_failed" ? "服务商确认投递失败，可重新发送" : result.status === "delivered" ? "短信已送达" : "短信仍未完成投递，已保留当前状态"));
  }, onError: () => message.error(t("短信重试失败，请检查短信平台配置和模板编码")) });
  const queryNotificationDelivery = useMutation({ mutationFn: rentalCoreApi.queryNotificationDelivery, onSuccess: async result => {
    await refreshLogs(); message.success(t(result.status === "delivered" ? "短信已送达" : result.status === "delivery_failed" ? "服务商返回短信投递失败" : result.status === "delivery_pending" ? "服务商暂未返回最终回执" : "短信回执状态已更新"));
  }, onError: () => message.error(t("查询短信回执失败，请稍后重试")) });
  const retryDueNotifications = useMutation({ mutationFn: () => rentalCoreApi.retryDueNotifications(), onSuccess: async result => {
    await refreshLogs(); message.success(t("已处理 {attempted} 条到期短信，成功 {sent} 条", { attempted: result.attempted, sent: result.sent }));
  }, onError: () => message.error(t("批量重试失败，请稍后再试")) });
  function openTemplate(row?: RentalNotificationTemplateV1) {
    templateForm.resetFields();
    const { variableSchema, ...existing } = row ?? { variableSchema: {} };
    templateForm.setFieldsValue(row ? { ...existing, variableDefinitions: notificationVariableRows(variableSchema) } : {
      eventCode: settings.notifications.enabledEvents[0] ?? "order.created", channel: settings.notifications.editableChannels[0] ?? "app_push",
      name: "", title: "", body: "", status: "enabled", variableDefinitions: notificationVariableRows({ customerName: { label: "客户名称", required: true }, orderNo: { label: "订单号", required: true } }),
    });
    setTemplateEditor(row ?? ({} as RentalNotificationTemplateV1));
  }
  function openSend(row: RentalNotificationTemplateV1) {
    sendForm.resetFields();
    sendForm.setFieldsValue({ templateId: row.id, recipient: "", variables: Object.fromEntries(Object.keys(row.variableSchema).map(key => [key, ""])) });
    setSendTemplate(row);
  }
  if (!canManage) return <Alert type="warning" showIcon title={t("当前没有通知配置权限")} />;
  return <>
    <Tabs aria-label={t("通知管理")} items={[
      { key: "templates", label: t("模板配置"), children: <QueryState loading={templates.isLoading} error={templates.error} onRetry={() => templates.refetch({ throwOnError: true })}>
        <ListSection controls={<><ListFilters filter={templateFilter} placeholder="模板名称、标题或事件" statusLabel="全部渠道" options={Object.keys(notificationChannelLabels).map(value => ({ value, label: channelLabel(value) }))} />
          <Button type="primary" icon={<Plus size={16} />} onClick={() => openTemplate()}>{t("新增模板")}</Button></>}>
          <Table<RentalNotificationTemplateV1> rowKey="id" onRefresh={() => templates.refetch()} loading={templates.isLoading} refreshing={templates.isFetching}
            dataSource={templateFilter.rows} pagination={templateFilter.pagination} emptyScene={templateFilter.keyword || templateFilter.status ? "search" : "empty"} columns={[
              { title: t("模板"), render: (_, row) => <DataTableText primary={row.name} secondary={`${eventLabel(row.eventCode)} · v${row.version}`} /> },
              { title: t("渠道"), dataIndex: "channel", render: channelLabel }, { title: t("标题"), dataIndex: "title" },
              { title: t("变量"), render: (_, row) => Object.entries(row.variableSchema).map(([name, definition]) => definition.label || name).join("、") || "—" },
              { title: t("状态"), dataIndex: "status", render: value => <Tag color={value === "enabled" ? "success" : "default"}>{t(value === "enabled" ? "已启用" : "已停用")}</Tag> },
              { title: t("操作"), render: (_, row) => <DataTableRowActions details={() => openTemplate(row)} detailLabel={t("编辑模板")} detailAccessibleLabel={`${row.name} · ${t("编辑模板")}`}
                menuLabel={`${row.name} · ${t("更多操作")}`} primary={{ id: "edit", label: t("编辑模板"), icon: Pencil, onSelect: () => openTemplate(row) }}
                actions={[{ id: "send", label: t("测试发送"), icon: Send, disabled: row.status !== "enabled", onSelect: () => openSend(row) }]} /> },
            ]} />
        </ListSection>
      </QueryState> },
      { key: "deliveries", label: t("投递记录"), children: <QueryState loading={logs.isLoading} error={logs.error} onRetry={() => logs.refetch({ throwOnError: true })}>
        <ListSection controls={<><ListFilters filter={logFilter} placeholder="事件、接收人或回执编号" options={Object.entries(deliveryLabels).map(([value, label]) => ({ value, label: t(label) }))} />
          <ActionButton variant="secondary" label={t("重试到期短信")} disabled={retryDueNotifications.isPending} onAction={() => retryDueNotifications.mutateAsync()} /></>}>
          <Table<RentalNotificationSendLogV1> rowKey="id" onRefresh={() => logs.refetch()} loading={logs.isLoading} refreshing={logs.isFetching} dataSource={logFilter.rows}
            pagination={logFilter.pagination} emptyScene={logFilter.keyword || logFilter.status ? "search" : "empty"} columns={[
              { title: t("事件"), render: (_, row) => <DataTableText primary={eventLabel(row.eventCode)} secondary={`${t("模板版本")} v${row.templateVersion}`} /> },
              { title: t("接收人"), render: (_, row) => <DataTableText primary={row.recipient} secondary={channelLabel(row.channel)} /> },
              { title: t("提供商"), dataIndex: "provider", render: value => value === "simulation" ? t("模拟") : value },
              { title: t("状态"), render: (_, row) => <Tag color={deliveryColor(row.status)}>{t(deliveryLabels[row.status])}</Tag> },
              { title: t("时间"), dataIndex: "createdAt", render: value => <DataTableText primary={new Date(value).toLocaleDateString(locale)} secondary={new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} /> },
              { title: t("操作"), render: (_, row) => <Space>
                <Button type="text" size="small" icon={<FileText size={14} />} onClick={() => setDeliveryTarget(row)}>{t("投递详情")}</Button>
                {row.channel === "sms" && ["sent", "delivery_pending", "delivery_uncertain"].includes(row.status) && <ActionButton variant="secondary" label={t("查询回执")} disabled={queryNotificationDelivery.isPending} onAction={() => queryNotificationDelivery.mutateAsync(row.id)} />}
                {row.channel === "sms" && ["queued", "failed", "delivery_failed"].includes(row.status) && <ActionButton variant="secondary" label={t("重试")} disabled={retryNotification.isPending} onAction={() => retryNotification.mutateAsync(row.id)} />}
              </Space> },
            ]} />
        </ListSection>
      </QueryState> },
    ]} />
    <Modal presentation="side" title={templateEditor?.id ? t("编辑通知模板") : t("新增通知模板")} width={720} open={templateDialog.visible} onCancel={templateDialog.dismiss} afterClose={templateDialog.afterClose} destroyOnHidden
      closable={!saveTemplate.isPending} keyboard={!saveTemplate.isPending} maskClosable={!saveTemplate.isPending}
      footer={<><Button disabled={saveTemplate.isPending} onClick={templateDialog.dismiss}>{t("取消")}</Button><SaveButton label={t("保存新版本")} form={templateForm} pending={saveTemplate.isPending} onSave={values => saveTemplate.mutateAsync(values)} /></>}>
      {templateEditor?.id && <p className={styles.context}>{templateEditor.name} · v{templateEditor.version}</p>}
      <Form form={templateForm} className={styles.templateFields} layout="vertical" disabled={saveTemplate.isPending} onFinish={values => saveTemplate.mutate(values)}
        onValuesChange={changed => {
          // Nested fields do not automatically revalidate Form.List's own rules.
          if (changed.variableDefinitions) void templateForm.validateFields([["variableDefinitions"]]).catch(() => undefined);
        }}>
        <Form.Item name="id" hidden><Input /></Form.Item>
        <SettingsWorkspace sections={[
          { key: "profile", label: t("模板资料"), content: <FormSection title={t("模板资料")}>
            <Form.Item name="name" label={t("模板名称")} rules={[{ required: true }]}><Input /></Form.Item>
            <Row gutter={16}>
              <Col xs={24} sm={12}><Form.Item name="eventCode" label={t("事件")} rules={[{ required: true }]}><Select options={settings.notifications.enabledEvents.map(value => ({ value, label: eventLabel(value) }))} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="channel" label={t("渠道")} rules={[{ required: true }]}><Select options={settings.notifications.editableChannels.map(value => ({ value, label: channelLabel(value) }))} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="status" label={t("状态")}><Select options={[{ value: "enabled", label: t("启用") }, { value: "disabled", label: t("停用") }]} /></Form.Item></Col>
            </Row>
          </FormSection> },
          { key: "content", label: t("通知内容"), content: <FormSection title={t("通知内容")} description={t("标题和正文中的变量须在“模板变量”中登记。保存会生成新版本，历史投递仍保留原版本。")}>
            <Form.Item name="title" label={t("标题")} rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="body" label={t("正文")} rules={[{ required: true }]}><Input.TextArea rows={6} /></Form.Item>
            <Form.Item name="providerTemplateCode" label={t("短信服务商模板编码")} extra={t("仅短信渠道使用；填写阿里云模板编码或腾讯云模板 ID。其他渠道留空。")} hidden={templateChannel !== "sms"}><Input placeholder="SMS_123456789" /></Form.Item>
          </FormSection> },
          { key: "variables", label: t("模板变量"), content: <FormSection title={t("模板变量")} description={t("保留变量名称、显示名称和必填设置；标题与正文通过 {{变量名}} 引用。")}>
            <Form.List name="variableDefinitions" rules={[{ validator: async (_rule, rows: NotificationVariableRow[] = []) => {
              try { notificationVariableSchema(rows); } catch (error) { throw new Error(t((error as Error).message)); }
            } }]}>
              {(fields, { add, remove }, { errors }) => <div className={styles.stack}>
                {fields.map(({ key, name }) => <div key={key} className={styles.variableRow}>
                  <Form.Item className={styles.variableField} name={[name, "name"]} label={t("变量名")} rules={[{ required: true, whitespace: true, message: t("请填写变量名") }]}><Input placeholder="orderNo" spellCheck={false} /></Form.Item>
                  <Form.Item className={styles.variableField} name={[name, "definition", "label"]} label={t("显示名称")}><Input /></Form.Item>
                  <div className={styles.variableActions}>
                    <Form.Item name={[name, "definition", "required"]} valuePropName="checked" noStyle><Checkbox>{t("必填")}</Checkbox></Form.Item>
                    <Button type="text" icon={<Trash2 size={16} />} title={t("移除变量")} aria-label={`${t("移除变量")} ${name + 1}`} disabled={saveTemplate.isPending} onClick={() => remove(name)} />
                  </div>
                </div>)}
                {!fields.length && <p className={styles.context}>{t("尚未登记模板变量")}</p>}
                <Form.ErrorList errors={errors} />
                <Button type="text" icon={<Plus size={16} />} disabled={saveTemplate.isPending} onClick={() => add({ name: "", definition: { label: "", required: false } })}>{t("添加变量")}</Button>
              </div>}
            </Form.List>
          </FormSection> },
        ]} />
      </Form>
    </Modal>
    <Modal title={t("测试发送")} open={sendDialog.visible} onCancel={sendDialog.dismiss} afterClose={sendDialog.afterClose} okText={t("发送测试通知")} confirmLoading={sendNotification.isPending}
      closable={!sendNotification.isPending} keyboard={!sendNotification.isPending} maskClosable={!sendNotification.isPending} cancelButtonProps={{ disabled: sendNotification.isPending }}
      onConfirm={() => sendForm.validateFields().then(values => sendNotification.mutateAsync(values))} destroyOnHidden>
      <div className={styles.stack}>
        {sendTemplate && <RecordFacts items={[{ key: "template", label: "模板", value: sendTemplate.name }, { key: "channel", label: "渠道", value: channelLabel(sendTemplate.channel) }]} />}
        <Alert type={sendTemplate?.channel === "sms" ? "warning" : "info"} showIcon title={t(sendTemplate?.channel === "sms"
          ? "测试发送会写入投递记录。已配置短信服务时，可能向接收人发送真实短信。"
          : "当前渠道为模拟投递，只生成投递记录，不发送实际通知。")} />
        <Form form={sendForm} layout="vertical" disabled={sendNotification.isPending} onFinish={values => sendNotification.mutate(values)}>
          <Form.Item name="templateId" hidden><Input /></Form.Item>
          <Form.Item name="recipient" label={t("接收人")} rules={[{ required: true }]}><Input /></Form.Item>
          {sendTemplate && Object.entries(sendTemplate.variableSchema).map(([name, definition]) => <Form.Item key={name} name={["variables", name]} label={definition.label || name} extra={`{{${name}}}`} rules={[{ required: definition.required }]}><Input /></Form.Item>)}
        </Form>
      </div>
    </Modal>
    <Modal presentation="side" title={t("投递详情")} open={deliveryDialog.visible} onCancel={deliveryDialog.dismiss} afterClose={deliveryDialog.afterClose} width={640} footer={null} destroyOnHidden>
      {deliveryTarget && <div className={styles.stack}>
        <RecordFacts items={[
          { key: "event", label: "事件", value: eventLabel(deliveryTarget.eventCode) }, { key: "status", label: "状态", value: <Tag color={deliveryColor(deliveryTarget.status)}>{t(deliveryLabels[deliveryTarget.status])}</Tag> },
          { key: "recipient", label: "接收人", value: deliveryTarget.recipient }, { key: "channel", label: "渠道", value: channelLabel(deliveryTarget.channel) },
          { key: "version", label: "模板版本", value: `v${deliveryTarget.templateVersion}` }, { key: "provider", label: "提供商", value: deliveryTarget.provider === "simulation" ? t("模拟") : deliveryTarget.provider },
          { key: "created", label: "时间", value: new Date(deliveryTarget.createdAt).toLocaleString(locale), wide: true },
          { key: "receipt", label: "外部回执", value: deliveryTarget.providerMessageId, wide: true },
        ]} />
        {deliveryTarget.errorMessage && <Alert type="error" showIcon title={t("失败原因")} description={deliveryTarget.errorMessage} />}
        <ListSection title={t("投递内容")}><strong>{deliveryTarget.renderedTitle || t("无标题")}</strong><p className={styles.messageBody}>{deliveryTarget.renderedBody || "—"}</p></ListSection>
      </div>}
    </Modal>
  </>;
}
