import type {
  RentalNotificationTemplateV1,
  SaveRentalNotificationTemplateRequest,
  SendRentalNotificationRequest,
  TenantRentalBusinessSettings,
} from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { notificationChannelLabels, notificationEventLabels } from "./ruleOptionLabels";
import type { GovernancePermissions } from "./shared";

/** 已知事件编码显示中文；未知编码兜底显示原始代码，并包成明显是「代码」的样式。 */
function eventLabel(code: string) {
  return notificationEventLabels[code] ?? <Typography.Text code>{code}</Typography.Text>;
}

type TemplateForm = Omit<
  SaveRentalNotificationTemplateRequest,
  "variableSchema"
> & { variableSchemaText: string };
type SendForm = Omit<SendRentalNotificationRequest, "variables"> & {
  variablesText: string;
};

/**
 * 「通知模板」页签：模板版本、投递记录、短信回执查询/重试，以及模板编辑抽屉与模拟发送弹窗。
 * 只有租户设置已启用的事件与渠道可以保存模板，因此需要外壳传入已载入的设置。
 */
export function NotificationsTab({ permissions, settings }: { permissions: GovernancePermissions; settings: TenantRentalBusinessSettings }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  // 通知模板走 rules:manage，单有发布权限不覆盖它；与外壳的页签判定同一口径。
  const canSeeNotifications = permissions.canEditRules || permissions.canManagePrice || permissions.canManageParams;
  const [templateEditor, setTemplateEditor] =
    useState<RentalNotificationTemplateV1 | null>();
  const [sendTemplate, setSendTemplate] =
    useState<RentalNotificationTemplateV1>();
  const [templateForm] = Form.useForm<TemplateForm>();
  const [sendForm] = Form.useForm<SendForm>();

  const templates = useQuery({
    queryKey: ["rental-core", "notification-templates"],
    queryFn: rentalCoreApi.notificationTemplates,
    enabled: canSeeNotifications,
  });
  const logs = useQuery({
    queryKey: ["rental-core", "notification-logs"],
    queryFn: rentalCoreApi.notificationLogs,
    enabled: canSeeNotifications,
  });

  const saveTemplate = useMutation({
    mutationFn: (values: TemplateForm) => {
      const { variableSchemaText, ...rest } = values;
      return rentalCoreApi.saveNotificationTemplate({
        ...rest,
        variableSchema: JSON.parse(variableSchemaText),
      });
    },
    onSuccess: async () => {
      setTemplateEditor(null);
      templateForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "notification-templates"],
      });
      message.success("通知模板新版本已保存");
    },
    onError: () =>
      message.error("模板保存失败，请检查事件、渠道、变量 schema 和占位符"),
  });
  const sendNotification = useMutation({
    mutationFn: (values: SendForm) => {
      const { variablesText, ...rest } = values;
      return rentalCoreApi.sendNotification({
        ...rest,
        variables: JSON.parse(variablesText),
      });
    },
    onSuccess: async () => {
      setSendTemplate(undefined);
      sendForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "notification-logs"],
      });
      message.success("通知已处理并记录投递结果");
    },
    onError: () => message.error("发送失败，请检查必填变量和接收人"),
  });
  const retryNotification = useMutation({
    mutationFn: (id: string) => rentalCoreApi.retryNotification(id),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "notification-logs"] });
      message.success(result.status === "sent" ? "短信已被服务商受理" : result.status === "delivery_failed" ? "服务商确认投递失败，可重新发送" : result.status === "delivered" ? "短信已送达" : "短信仍未完成投递，已保留当前状态");
    },
    onError: () => message.error("短信重试失败，请检查短信平台配置和模板编码"),
  });
  const queryNotificationDelivery = useMutation({
    mutationFn: (id: string) => rentalCoreApi.queryNotificationDelivery(id),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "notification-logs"] });
      message.success(result.status === "delivered" ? "短信已送达" : result.status === "delivery_failed" ? "服务商返回短信投递失败" : result.status === "delivery_pending" ? "服务商暂未返回最终回执" : "短信回执状态已更新");
    },
    onError: () => message.error("查询短信回执失败，请稍后重试"),
  });
  const retryDueNotifications = useMutation({
    mutationFn: () => rentalCoreApi.retryDueNotifications(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "notification-logs"] });
      message.success(`已处理 ${result.attempted} 条到期短信，成功 ${result.sent} 条`);
    },
    onError: () => message.error("批量重试失败，请稍后再试"),
  });

  function openTemplate(row?: RentalNotificationTemplateV1) {
    templateForm.setFieldsValue(
      row
        ? {
            ...row,
            variableSchemaText: JSON.stringify(row.variableSchema, null, 2),
          }
        : {
            eventCode:
              settings.notifications.enabledEvents[0] ?? "order.created",
            channel:
              settings.notifications.editableChannels[0] ?? "app_push",
            name: "",
            title: "",
            body: "",
            variableSchemaText: JSON.stringify(
              {
                customerName: { label: "客户名称", required: true },
                orderNo: { label: "订单号", required: true },
              },
              null,
              2,
            ),
            status: "enabled",
          },
    );
    setTemplateEditor(row ?? ({} as RentalNotificationTemplateV1));
  }
  function openSend(row: RentalNotificationTemplateV1) {
    sendForm.setFieldsValue({
      templateId: row.id,
      recipient: "demo-recipient",
      variablesText: JSON.stringify(
        Object.fromEntries(
          Object.keys(row.variableSchema).map((key) => [
            key,
            key === "orderNo" ? "RC-DEMO-001" : "演示客户",
          ]),
        ),
        null,
        2,
      ),
    });
    setSendTemplate(row);
  }

  return (
    <>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <div className="table-toolbar">
          <Typography.Text type="secondary">
            只有租户设置已启用的事件与渠道可以保存模板；发送时严格校验变量
            schema。
          </Typography.Text>
          <Button type="primary" onClick={() => openTemplate()}>
            新增模板
          </Button>
          <Button loading={retryDueNotifications.isPending} onClick={() => retryDueNotifications.mutate()}>
            重试到期短信
          </Button>
        </div>
        <Card title="通知模板">
          <Table<RentalNotificationTemplateV1>
            rowKey="id"
            dataSource={templates.data ?? []}
            columns={[
              {
                title: "模板",
                render: (_, row) => (
                  <>
                    <b>{row.name}</b>
                    <br />
                    <span className="muted">
                      {eventLabel(row.eventCode)} · v{row.version}
                    </span>
                  </>
                ),
              },
              {
                title: "渠道",
                dataIndex: "channel",
                render: (value) => <Tag>{notificationChannelLabels[value] ?? value}</Tag>,
              },
              { title: "标题", dataIndex: "title" },
              {
                title: "变量",
                render: (_, row) =>
                  Object.keys(row.variableSchema).join("、"),
              },
              { title: "状态", dataIndex: "status" },
              {
                title: "操作",
                render: (_, row) => (
                  <Space>
                    <Button
                      type="link"
                      onClick={() => openTemplate(row)}
                    >
                      编辑
                    </Button>
                    <Button type="link" onClick={() => openSend(row)}>
                      模拟发送
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </Card>
        <Card title="通知记录">
          <Table
            rowKey="id"
            dataSource={logs.data ?? []}
            columns={[
              { title: "事件", dataIndex: "eventCode", render: (value: string) => eventLabel(value) },
              {
                title: "渠道/接收人",
                render: (_, row) => (
                  <>
                    {notificationChannelLabels[row.channel] ?? row.channel} · {row.recipient}
                  </>
                ),
              },
              { title: "模板版本", dataIndex: "templateVersion" },
              { title: "提供商", dataIndex: "provider" },
              { title: "外部回执", dataIndex: "providerMessageId", render: (value) => value || "—" },
              {
                title: "状态",
                dataIndex: "status",
                render: (value) => (
                  <Tag color={value === "delivered" ? "success" : value === "sent" || value === "delivery_pending" ? "processing" : value === "simulated" ? "default" : value === "queued" || value === "delivery_uncertain" ? "warning" : "error"}>
                    {{ sent: "服务商已受理", delivered: "已送达", delivery_pending: "等待回执", delivery_failed: "投递失败", delivery_uncertain: "结果未知", queued: "待发送", failed: "发送失败", simulated: "模拟", simulation_failed: "模拟失败" }[value as string] ?? value}
                  </Tag>
                ),
              },
              { title: "时间", dataIndex: "createdAt" },
              {
                title: "操作",
                render: (_, row) => row.channel !== "sms" ? "—" : (
                  <Space>
                    {["sent", "delivery_pending", "delivery_uncertain"].includes(row.status) && (
                      <Button type="link" loading={queryNotificationDelivery.isPending} onClick={() => queryNotificationDelivery.mutate(row.id)}>
                        查询回执
                      </Button>
                    )}
                    {["queued", "failed", "delivery_failed"].includes(row.status) && (
                      <Button type="link" loading={retryNotification.isPending} onClick={() => retryNotification.mutate(row.id)}>
                        重试
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      </Space>

      <Drawer
        title={templateEditor?.id ? "编辑通知模板" : "新增通知模板"}
        size={680}
        open={Boolean(templateEditor)}
        onClose={() => setTemplateEditor(null)}
        forceRender
        destroyOnHidden
        extra={
          <Button
            type="primary"
            loading={saveTemplate.isPending}
            onClick={() => templateForm.submit()}
          >
            保存新版本
          </Button>
        }
      >
        <Form
          form={templateForm}
          layout="vertical"
          onFinish={(values) => saveTemplate.mutate(values)}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="eventCode"
                label="事件"
                rules={[{ required: true }]}
              >
                <Select
                  options={(
                    settings.notifications.enabledEvents ?? []
                  ).map((value) => ({ value, label: eventLabel(value) }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="channel"
                label="渠道"
                rules={[{ required: true }]}
              >
                <Select
                  options={(
                    settings.notifications.editableChannels ?? []
                  ).map((value) => ({ value, label: notificationChannelLabels[value] ?? value }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="name" label="模板名称">
            <Input />
          </Form.Item>
          <Form.Item name="title" label="标题">
            <Input />
          </Form.Item>
          <Form.Item name="body" label="正文">
            <Input.TextArea rows={5} />
          </Form.Item>
          <Form.Item
            name="providerTemplateCode"
            label="短信服务商模板编码"
            tooltip="仅短信渠道使用；填写阿里云模板编码或腾讯云模板 ID。其他渠道留空。"
          >
            <Input placeholder="例如 SMS_123456789" />
          </Form.Item>
          <Form.Item name="variableSchemaText" label="变量 schema（JSON）">
            <Input.TextArea rows={8} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: "enabled", label: "启用" },
                { value: "disabled", label: "停用" },
              ]}
            />
          </Form.Item>
        </Form>
      </Drawer>
      <Modal
        title={`测试发送 · ${sendTemplate?.name ?? ""}`}
        open={Boolean(sendTemplate)}
        onCancel={() => setSendTemplate(undefined)}
        onOk={() => sendForm.submit()}
        confirmLoading={sendNotification.isPending}
        forceRender
        destroyOnHidden
      >
        <Form
          form={sendForm}
          layout="vertical"
          onFinish={(values) => sendNotification.mutate(values)}
        >
          <Form.Item name="templateId" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="recipient"
            label="接收人"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="variablesText"
            label="变量 JSON"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={8} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
