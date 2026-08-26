import {
  CalendarOutlined,
  NotificationOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { RENTAL_PRICING_UNIT_LABELS } from "@store-rental/shared";
import type {
  GrantRentalRewardRequest,
  ImportRentalCalendarRequest,
  RentalCalendarDay,
  SaveRentalCalendarDayRequest,
  RentalNotificationTemplateV1,
  RentalRuleVersion,
  SaveRentalNotificationTemplateRequest,
  SendRentalNotificationRequest,
  TenantRentalBusinessSettings,
} from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

type TabKey =
  | "category"
  | "rules"
  | "calendar"
  | "membership"
  | "notifications";
type ImportForm = Omit<ImportRentalCalendarRequest, "days"> & {
  daysText: string;
};
type TemplateForm = Omit<
  SaveRentalNotificationTemplateRequest,
  "variableSchema"
> & { variableSchemaText: string };
type SendForm = Omit<SendRentalNotificationRequest, "variables"> & {
  variablesText: string;
};
const pricingUnitLabels = RENTAL_PRICING_UNIT_LABELS;
const currentYear = new Date().getFullYear();
const modeLabels: Record<string, string> = {
  store_pickup_return: "门店取还",
  partner_pickup_return: "合作商取还",
  warehouse_pickup_return: "仓库取还",
  locker_pickup_return: "自提柜取还",
  delivery: "配送",
  onsite_delivery: "现场交付",
};

export function RentalGovernancePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("category");
  const [year, setYear] = useState(currentYear);
  const [ruleEditor, setRuleEditor] = useState<RentalRuleVersion>();
  const [calendarDay, setCalendarDay] = useState<RentalCalendarDay>();
  const [importOpen, setImportOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  /** 待移除覆盖的日期。撤销原因必填，因此走确认弹窗而不是直接 DELETE。 */
  const [revertTarget, setRevertTarget] = useState<RentalCalendarDay>();
  const [templateEditor, setTemplateEditor] =
    useState<RentalNotificationTemplateV1 | null>();
  const [sendTemplate, setSendTemplate] =
    useState<RentalNotificationTemplateV1>();
  const [settingsForm] = Form.useForm<TenantRentalBusinessSettings>();
  const [ruleForm] = Form.useForm<
    RentalRuleVersion["config"] & { changeReason: string }
  >();
  const [calendarDayForm] = Form.useForm<SaveRentalCalendarDayRequest>();
  const [importForm] = Form.useForm<ImportForm>();
  const [publishForm] = Form.useForm<{ changeReason: string }>();
  const [revertForm] = Form.useForm<{ overrideReason: string }>();
  const [rewardForm] = Form.useForm<GrantRentalRewardRequest>();
  const [templateForm] = Form.useForm<TemplateForm>();
  const [sendForm] = Form.useForm<SendForm>();
  const categories = useQuery({
    queryKey: ["rental-core", "categories"],
    queryFn: rentalCoreApi.categories,
  });
  const profile = useQuery({
    queryKey: ["rental-core", "profile"],
    queryFn: rentalCoreApi.profile,
  });
  const settings = useQuery({
    queryKey: ["rental-core", "business-settings"],
    queryFn: rentalCoreApi.businessSettings,
  });
  const rules = useQuery({
    queryKey: ["rental-core", "rule-versions"],
    queryFn: rentalCoreApi.ruleVersions,
  });
  const calendar = useQuery({
    queryKey: ["rental-core", "calendar", year],
    queryFn: () => rentalCoreApi.calendar(year),
  });
  const rewards = useQuery({
    queryKey: ["rental-core", "rewards"],
    queryFn: () => rentalCoreApi.rewards(),
  });
  const benefitAccounts = useQuery({
    queryKey: ["rental-core", "benefit-accounts"],
    queryFn: () => rentalCoreApi.benefitAccounts(),
  });
  const couponTemplates = useQuery({
    queryKey: ["rental-core", "coupon-templates"],
    queryFn: rentalCoreApi.couponTemplates,
  });
  const templates = useQuery({
    queryKey: ["rental-core", "notification-templates"],
    queryFn: rentalCoreApi.notificationTemplates,
  });
  const logs = useQuery({
    queryKey: ["rental-core", "notification-logs"],
    queryFn: rentalCoreApi.notificationLogs,
  });
  const category = useMemo(
    () =>
      categories.data?.find((item) => item.code === profile.data?.categoryCode),
    [categories.data, profile.data?.categoryCode],
  );
  useEffect(() => {
    if (settings.data) settingsForm.setFieldsValue(settings.data);
  }, [settings.data, settingsForm]);

  const saveSettings = useMutation({
    mutationFn: (values: TenantRentalBusinessSettings) => {
      const {
        tenantId: _tenant,
        categoryCode: _category,
        configVersion: _version,
        updatedAt: _updatedAt,
        updatedBy: _updatedBy,
        ...body
      } = values;
      return rentalCoreApi.saveBusinessSettings(body);
    },
    onSuccess: async (result) => {
      settingsForm.setFieldsValue(result);
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "business-settings"],
      });
      message.success("租户经营设置已保存");
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "保存租户设置失败，请检查填写内容",
      ),
  });
  const saveRule = useMutation({
    mutationFn: (
      values: RentalRuleVersion["config"] & { changeReason: string },
    ) => {
      const { changeReason, ...config } = values;
      return rentalCoreApi.saveRuleVersion({
        config,
        changeReason,
        publish: true,
      });
    },
    onSuccess: async () => {
      setRuleEditor(undefined);
      ruleForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "rule-versions"],
      });
      message.success("租赁规则新版本已发布");
    },
    onError: () => message.error("规则发布失败，请检查品类能力和租户设置"),
  });
  const saveDay = useMutation({
    mutationFn: (value: SaveRentalCalendarDayRequest) =>
      rentalCoreApi.saveCalendarDay(year, value),
    onSuccess: async () => {
      setCalendarDay(undefined);
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar", year],
      });
      message.success("租户日历覆盖已保存");
    },
    onError: () => message.error("日期或价格系数无效"),
  });
  const importCalendar = useMutation({
    mutationFn: (values: ImportForm) => {
      const { daysText, ...rest } = values;
      return rentalCoreApi.importCalendar({
        ...rest,
        year,
        days: JSON.parse(daysText) as ImportRentalCalendarRequest["days"],
      });
    },
    onSuccess: async (result) => {
      setImportOpen(false);
      importForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar", year],
      });
      // 保留的人工覆盖必须显式告知：导入静默跳过这些日期时，运营会以为官方值已生效。
      const preserved = result?.importPreservedOverrides ?? [];
      if (preserved.length) {
        message.warning(
          `官方日历已导入草稿。${preserved.length} 个日期存在人工覆盖，已保留原覆盖：${preserved.join("、")}`,
        );
      } else {
        message.success("官方日历已导入草稿，请核对后发布");
      }
    },
    onError: () => message.error("导入失败，请检查官方来源、年度和 JSON 数据"),
  });
  const publishCalendar = useMutation({
    mutationFn: (changeReason: string) =>
      rentalCoreApi.publishCalendar(year, { changeReason }),
    onSuccess: async () => {
      setPublishOpen(false);
      publishForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar", year],
      });
      message.success("年度营业日历已发布，后续报价将记录该版本");
    },
    onError: () =>
      message.error("发布失败：需填写变更原因，且中国大陆日历必须先导入官方来源"),
  });
  const removeDayOverride = useMutation({
    mutationFn: ({ date, overrideReason }: { date: string; overrideReason: string }) =>
      rentalCoreApi.removeCalendarDayOverride(year, date, { overrideReason }),
    onSuccess: async () => {
      setRevertTarget(undefined);
      revertForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar", year],
      });
      message.success("人工覆盖已移除，该日期恢复为官方日历或每周模板");
    },
    onError: () => message.error("移除失败：该日期没有人工覆盖，或未填写调整原因"),
  });
  const grantReward = useMutation({
    mutationFn: rentalCoreApi.grantReward,
    onSuccess: async () => {
      rewardForm.resetFields();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "rewards"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "benefit-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }),
      ]);
      message.success("奖励流水已按幂等键生成");
    },
    onError: () =>
      message.error("生成失败：规则未启用、触发条件不匹配或参数不完整"),
  });
  const reverseReward = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rentalCoreApi.reverseReward(id, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "rewards"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "benefit-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }),
      ]);
      message.success("奖励已撤销并保留流水");
    },
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
      message.success("通知已通过 Mock 适配器发送并记录回执");
    },
    onError: () => message.error("发送失败，请检查必填变量和接收人"),
  });

  function openRule() {
    const current =
      rules.data?.find((item) => item.status === "published") ??
      rules.data?.[0];
    if (!current) return;
    ruleForm.setFieldsValue({
      ...structuredClone(current.config),
      changeReason: "调整租赁业务规则",
    });
    setRuleEditor(current);
  }
  function openDay(row: RentalCalendarDay) {
    // source 由服务端固定为 tenant_override，不作为表单字段提交。
    const { source: _source, overrideBy: _by, overrideAt: _at, overriddenFrom: _from, ...editable } = row;
    calendarDayForm.setFieldsValue({ ...editable, overrideReason: row.overrideReason ?? "" });
    setCalendarDay(row);
  }
  function openTemplate(row?: RentalNotificationTemplateV1) {
    templateForm.setFieldsValue(
      row
        ? {
            ...row,
            variableSchemaText: JSON.stringify(row.variableSchema, null, 2),
          }
        : {
            eventCode:
              settings.data?.notifications.enabledEvents[0] ?? "order.created",
            channel:
              settings.data?.notifications.editableChannels[0] ?? "app_push",
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

  const currentRule = rules.data?.find((item) => item.status === "published");
  return (
    <>
      <PageHeader
        title="品类与业务规则"
        description="租户经营品类决定允许范围；价格、日历、规则、奖励与通知均按版本留痕。"
        extra={
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saveSettings.isPending}
            onClick={() => settingsForm.submit()}
          >
            保存租户设置
          </Button>
        }
      />
      <Tabs
        className="standalone-tabs"
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={[
          { key: "category", label: "品类与租赁方式" },
          {
            key: "rules",
            label: (
              <span>
                <SafetyCertificateOutlined />
                业务规则
              </span>
            ),
          },
          {
            key: "calendar",
            label: (
              <span>
                <CalendarOutlined />
                营业日历
              </span>
            ),
          },
          {
            key: "membership",
            label: (
              <span>
                <TeamOutlined />
                会员激励
              </span>
            ),
          },
          {
            key: "notifications",
            label: (
              <span>
                <NotificationOutlined />
                通知模板
              </span>
            ),
          },
        ]}
      />
      <QueryState
        loading={settings.isLoading || profile.isLoading}
        error={settings.error || profile.error}
      >
        {settings.data && category && (
          <Form<TenantRentalBusinessSettings>
            form={settingsForm}
            layout="vertical"
            onFinish={() =>
              // 提交整个 store 而非仅当前 tab 已注册的字段：设置分 tab 条件渲染，未挂载
              // 分组（如另一 tab 的 calendar/notifications）以及无 Form.Item 的字段（timeZone、
              // weeklyHours）都只在 store 里。只交已注册字段会让 PUT 缺组而整体 400，
              // 还会把时区与每周时段静默抹掉。getFieldsValue(true) 取回随 setFieldsValue 载入的全量。
              saveSettings.mutate(settingsForm.getFieldsValue(true))
            }
          >
            {tab === "category" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert
                  type="info"
                  showIcon
                  message={`${category.name} · 模型 ${category.version}`}
                  description="经营品类创建后固定；租户只能在品类支持的计价、履约、库存、预授权和资质能力内配置。"
                />
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={12}>
                    <Card title="计价方式">
                      <Form.Item
                        name={["pricing", "enabledUnits"]}
                        label="启用计价单位"
                      >
                        <Select
                          mode="multiple"
                          options={category.businessModel.pricingUnits.map(
                            (value) => ({
                              value,
                              label: pricingUnitLabels[value] ?? value,
                            }),
                          )}
                        />
                      </Form.Item>
                      <Form.Item
                        name={["pricing", "defaultUnit"]}
                        label="默认单位"
                      >
                        <Select
                          options={category.businessModel.pricingUnits.map(
                            (value) => ({
                              value,
                              label: pricingUnitLabels[value] ?? value,
                            }),
                          )}
                        />
                      </Form.Item>
                      <Form.Item
                        name={["pricing", "holidayPricingEnabled"]}
                        label="启用日历差异定价"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card title="租赁与履约方式">
                      <Form.Item
                        name={["fulfillment", "enabledModes"]}
                        label="启用方式"
                      >
                        <Select
                          mode="multiple"
                          options={category.businessModel.fulfillmentModes.map(
                            (value) => ({
                              value,
                              label: modeLabels[value] ?? value,
                            }),
                          )}
                        />
                      </Form.Item>
                      <Form.Item
                        name={["fulfillment", "allowDifferentReturnLocation"]}
                        label="允许异地归还"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                      <Space wrap>
                        {category.businessModel.locationTypes.map((value) => (
                          <Tag key={value}>{value}</Tag>
                        ))}
                      </Space>
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card title="支付、押金和预授权">
                      <Row gutter={12}>
                        <Col span={12}>
                          <Form.Item
                            name={["payment", "timing"]}
                            label="支付时点"
                          >
                            <Select
                              options={[
                                { value: "order", label: "下单" },
                                { value: "confirmation", label: "确认" },
                                { value: "pickup", label: "领取" },
                                { value: "offline_terms", label: "线下账期" },
                              ]}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item
                            name={["payment", "depositMode"]}
                            label="押金方式"
                          >
                            <Select
                              options={[
                                { value: "none", label: "无" },
                                { value: "fixed", label: "固定" },
                                { value: "price_multiple", label: "价格倍数" },
                                ...(category.businessModel
                                  .supportsPreauthorization
                                  ? [
                                      {
                                        value: "preauthorization",
                                        label: "预授权",
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item
                        name={["payment", "preauthorizationRequired"]}
                        label="必须预授权"
                        valuePropName="checked"
                      >
                        <Switch
                          disabled={
                            !category.businessModel.supportsPreauthorization
                          }
                        />
                      </Form.Item>
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card title="逾期基础设置">
                      <Row gutter={12}>
                        <Col span={8}>
                          <Form.Item
                            name={["overdue", "graceMinutes"]}
                            label="宽限分钟"
                          >
                            <InputNumber min={0} />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            name={["overdue", "feeMode"]}
                            label="收费方式"
                          >
                            <Select
                              options={[
                                "none",
                                "hourly",
                                "next_period",
                                "multiplier",
                                "manual_review",
                              ].map((value) => ({ value, label: value }))}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            name={["overdue", "feeMultiplier"]}
                            label="费用系数"
                          >
                            <InputNumber min={0} step={0.1} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                </Row>
              </Space>
            )}
            {tab === "rules" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div className="table-toolbar">
                  <Space>
                    <Tag color="success">已发布 v{currentRule?.version}</Tag>
                    <Typography.Text type="secondary">
                      订单与报价保存采用的规则版本
                    </Typography.Text>
                  </Space>
                  <Button type="primary" onClick={openRule}>
                    发布新版本
                  </Button>
                </div>
                {currentRule && (
                  <Card>
                    <Descriptions
                      column={{ xs: 1, md: 2, xl: 3 }}
                      items={[
                        {
                          key: "payment",
                          label: "支付与占位",
                          children: `${currentRule.config.payment.timing} · ${currentRule.config.payment.unpaidHoldMinutes} 分钟`,
                        },
                        {
                          key: "deposit",
                          label: "押金/预授权",
                          children: `${currentRule.config.payment.depositMode} · ${currentRule.config.payment.preauthorizationRequired ? "必需" : "非必需"}`,
                        },
                        {
                          key: "inspection",
                          label: "交接检查",
                          children: `${currentRule.config.fulfillment.pickupInspectionRequired ? "领取必检" : "领取选检"} / ${currentRule.config.fulfillment.returnInspectionRequired ? "归还必检" : "归还选检"}`,
                        },
                        {
                          key: "overdue",
                          label: "逾期",
                          children: `${currentRule.config.overdue.graceMinutes} 分钟 · ${currentRule.config.overdue.feeMode}`,
                        },
                        {
                          key: "cancel",
                          label: "取消",
                          children: `${currentRule.config.cancellation.freeBeforeHours} 小时前免费`,
                        },
                        {
                          key: "qualification",
                          label: "资质",
                          children: currentRule.config.qualification.required
                            ? currentRule.config.qualification.documentTypes.join(
                                "、",
                              )
                            : "不要求",
                        },
                      ]}
                    />
                  </Card>
                )}
                <Card title="版本历史">
                  <Table<RentalRuleVersion>
                    rowKey="id"
                    pagination={false}
                    dataSource={rules.data ?? []}
                    columns={[
                      { title: "版本", dataIndex: "version" },
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (value) => <Tag>{value}</Tag>,
                      },
                      { title: "变更原因", dataIndex: "changeReason" },
                      { title: "操作人", dataIndex: "createdBy" },
                      { title: "创建时间", dataIndex: "createdAt" },
                    ]}
                  />
                </Card>
              </Space>
            )}
            {tab === "calendar" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div className="table-toolbar">
                  <Space>
                    <Select
                      value={year}
                      onChange={setYear}
                      options={[
                        currentYear - 1,
                        currentYear,
                        currentYear + 1,
                      ].map((value) => ({ value, label: `${value} 年` }))}
                    />
                    <Tag
                      color={
                        calendar.data?.status === "published"
                          ? "success"
                          : "warning"
                      }
                    >
                      {calendar.data?.status} · v{calendar.data?.version}
                    </Tag>
                    <Typography.Text type="secondary">
                      {calendar.data?.sourceName ?? "尚未导入官方来源"}
                    </Typography.Text>
                  </Space>
                  <Space>
                    <Button
                      onClick={() => {
                        importForm.setFieldsValue({
                          year,
                          region: "CN",
                          sourceName: "国务院办公厅年度放假通知",
                          sourceUrl: "https://www.gov.cn/",
                          sourcePublishedAt: new Date().toISOString(),
                          daysText: "[]",
                        });
                        setImportOpen(true);
                      }}
                    >
                      导入官方日历
                    </Button>
                    <Button
                      type="primary"
                      loading={publishCalendar.isPending}
                      onClick={() => {
                        publishForm.resetFields();
                        setPublishOpen(true);
                      }}
                    >
                      发布年度版本
                    </Button>
                  </Space>
                </div>
                <Alert
                  type="info"
                  showIcon
                  message="法定节假日与调休工作日必须来自有来源记录的年度数据"
                  description="租户可以覆盖特殊营业日、停业日和旺季价格系数；报价会记录命中的年度日历版本。"
                />
                <Card className="data-panel">
                  <Table<RentalCalendarDay>
                    rowKey="date"
                    size="small"
                    dataSource={calendar.data?.days ?? []}
                    pagination={{ pageSize: 31, showSizeChanger: false }}
                    columns={[
                      { title: "日期", dataIndex: "date" },
                      {
                        title: "类型",
                        dataIndex: "dayType",
                        render: (value) => <Tag>{value}</Tag>,
                      },
                      { title: "名称", dataIndex: "name" },
                      { title: "价格系数", dataIndex: "pricingMultiplier" },
                      {
                        title: "停业",
                        dataIndex: "closed",
                        render: (value) => (value ? "是" : "否"),
                      },
                      { title: "来源", dataIndex: "source" },
                      {
                        title: "被覆盖的原始值",
                        // 需求 4.5.3：日期详情必须能说明当前结果的来源并展示被覆盖的原始值。
                        // 只显示"来源=人工覆盖"而不显示原值，运营无法判断撤销后会恢复成什么。
                        render: (_, row) =>
                          row.source === "tenant_override" ? (
                            <Space direction="vertical" size={0}>
                              <Typography.Text style={{ fontSize: 12 }}>
                                {row.overriddenFrom
                                  ? `${row.overriddenFrom.name} · ${row.overriddenFrom.dayType} · ×${row.overriddenFrom.pricingMultiplier}`
                                  : "每周模板"}
                              </Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {row.overrideReason ?? "未记录原因"}
                                {row.overrideBy ? ` · ${row.overrideBy}` : ""}
                              </Typography.Text>
                            </Space>
                          ) : (
                            <Typography.Text type="secondary">—</Typography.Text>
                          ),
                      },
                      {
                        title: "操作",
                        render: (_, row) => (
                          <Space size={0}>
                            <Button type="link" onClick={() => openDay(row)}>
                              租户覆盖
                            </Button>
                            {row.source === "tenant_override" && (
                              <Button
                                type="link"
                                danger
                                onClick={() => {
                                  revertForm.resetFields();
                                  setRevertTarget(row);
                                }}
                              >
                                移除覆盖
                              </Button>
                            )}
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Card>
              </Space>
            )}
            {tab === "membership" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert
                  type="info"
                  showIcon
                  message="注册、实名审核和首单完成会自动触发奖励判断"
                  description="下方人工入口只用于补偿与联调；自动事件使用客户事件幂等键。积分、营销余额和奖励券会进入 Rental Core 权益账户；营销余额不是支付机构资金账户。"
                />
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={12}>
                    <Card title="注册赠礼">
                      <Form.Item
                        name={["membership", "signupRewardEnabled"]}
                        label="启用"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                      <Row gutter={12}>
                        <Col span={12}>
                          <Form.Item
                            name={["membership", "signupRewardType"]}
                            label="奖励类型"
                          >
                            <Select
                              options={["points", "balance", "coupon"].map(
                                (value) => ({ value, label: value }),
                              )}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item
                            name={["membership", "signupRewardAmount"]}
                            label="数量"
                          >
                            <InputNumber min={0} />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item
                        name={["membership", "signupRewardCouponTemplateId"]}
                        label="赠送券模板（奖励类型为优惠券时必选）"
                      >
                        <Select
                          allowClear
                          options={(couponTemplates.data ?? [])
                            .filter((item) => item.status === "enabled")
                            .map((item) => ({ value: item.id, label: item.name }))}
                        />
                      </Form.Item>
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card title="邀请奖励">
                      <Form.Item
                        name={["membership", "referralRewardEnabled"]}
                        label="启用"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        name={["membership", "referralTrigger"]}
                        label="奖励触发节点"
                      >
                        <Select
                          options={[
                            {
                              value: "registration",
                              label: "被邀请人完成注册",
                            },
                            {
                              value: "identity_verified",
                              label: "被邀请人通过实名审核",
                            },
                            {
                              value: "first_order_completed",
                              label: "被邀请人完成首单",
                            },
                          ]}
                        />
                      </Form.Item>
                      <Row gutter={12}>
                        <Col span={8}>
                          <Form.Item
                            name={["membership", "referralRewardType"]}
                            label="类型"
                          >
                            <Select
                              options={["points", "balance", "coupon"].map(
                                (value) => ({ value, label: value }),
                              )}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            name={["membership", "referrerRewardAmount"]}
                            label="邀请人"
                          >
                            <InputNumber min={0} />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            name={["membership", "inviteeRewardAmount"]}
                            label="被邀请人"
                          >
                            <InputNumber min={0} />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item
                        name={["membership", "referralRewardCouponTemplateId"]}
                        label="邀请奖励券模板（奖励类型为优惠券时必选）"
                      >
                        <Select
                          allowClear
                          options={(couponTemplates.data ?? [])
                            .filter((item) => item.status === "enabled")
                            .map((item) => ({ value: item.id, label: item.name }))}
                        />
                      </Form.Item>
                    </Card>
                  </Col>
                </Row>
                <Card title="人工补发奖励流水">
                  <Form
                    form={rewardForm}
                    layout="inline"
                    onFinish={(values) => grantReward.mutate(values)}
                  >
                    <Form.Item
                      name="customerId"
                      label="客户"
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item name="triggerType" label="触发">
                      <Select
                        style={{ width: 180 }}
                        options={[
                          { value: "registration", label: "注册赠礼" },
                          { value: "identity_verified", label: "实名通过" },
                          { value: "first_order_completed", label: "首单完成" },
                          { value: "referral", label: "直接邀请补发" },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name="relatedCustomerId" label="关联客户">
                      <Input />
                    </Form.Item>
                    <Form.Item
                      name="idempotencyKey"
                      label="业务幂等键"
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Button
                      htmlType="submit"
                      type="primary"
                      loading={grantReward.isPending}
                    >
                      生成并入账
                    </Button>
                  </Form>
                </Card>
                <Card title="客户权益账户">
                  <Table
                    rowKey="customerId"
                    dataSource={benefitAccounts.data ?? []}
                    columns={[
                      { title: "客户", dataIndex: "customerId" },
                      { title: "积分", dataIndex: "pointsBalance" },
                      { title: "营销余额", dataIndex: "marketingBalance", render: (value) => `¥${Number(value).toFixed(2)}` },
                      { title: "可用奖励券", dataIndex: "availableRewardCouponCount" },
                      { title: "更新时间", dataIndex: "updatedAt" },
                    ]}
                  />
                </Card>
                <Card title="奖励流水">
                  <Table
                    rowKey="id"
                    dataSource={rewards.data ?? []}
                    columns={[
                      { title: "客户", dataIndex: "customerId" },
                      {
                        title: "奖励",
                        render: (_, row) => `${row.rewardType} ${row.amount}`,
                      },
                      { title: "触发", dataIndex: "triggerType" },
                      { title: "幂等键", dataIndex: "idempotencyKey" },
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (value) => <Tag>{value}</Tag>,
                      },
                      { title: "原因", dataIndex: "reason" },
                      {
                        title: "操作",
                        render: (_, row) =>
                          row.status === "granted" ? (
                            <Button
                              danger
                              type="link"
                              onClick={() =>
                                Modal.confirm({
                                  title: "撤销奖励",
                                  content: "撤销会保留原流水与撤销时间。",
                                  onOk: () =>
                                    reverseReward.mutate({
                                      id: row.id,
                                      reason: "运营人工撤销",
                                    }),
                                })
                              }
                            >
                              撤销
                            </Button>
                          ) : (
                            "-"
                          ),
                      },
                    ]}
                  />
                </Card>
              </Space>
            )}
            {tab === "notifications" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div className="table-toolbar">
                  <Typography.Text type="secondary">
                    只有租户设置已启用的事件与渠道可以保存模板；发送时严格校验变量
                    schema。
                  </Typography.Text>
                  <Button type="primary" onClick={() => openTemplate()}>
                    新增模板
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
                              {row.eventCode} · v{row.version}
                            </span>
                          </>
                        ),
                      },
                      {
                        title: "渠道",
                        dataIndex: "channel",
                        render: (value) => <Tag>{value}</Tag>,
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
                              测试发送
                            </Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Card>
                <Card title="发送日志与供应商回执">
                  <Table
                    rowKey="id"
                    dataSource={logs.data ?? []}
                    columns={[
                      { title: "事件", dataIndex: "eventCode" },
                      {
                        title: "渠道/接收人",
                        render: (_, row) => `${row.channel} · ${row.recipient}`,
                      },
                      { title: "模板版本", dataIndex: "templateVersion" },
                      { title: "提供商", dataIndex: "provider" },
                      { title: "回执", dataIndex: "providerMessageId" },
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (value) => (
                          <Tag color={value === "sent" ? "success" : "error"}>
                            {value}
                          </Tag>
                        ),
                      },
                      { title: "时间", dataIndex: "createdAt" },
                    ]}
                  />
                </Card>
              </Space>
            )}
          </Form>
        )}
      </QueryState>

      <Drawer
        title={`发布规则新版本 · 当前 v${ruleEditor?.version ?? ""}`}
        width={760}
        open={Boolean(ruleEditor)}
        onClose={() => setRuleEditor(undefined)}
        destroyOnHidden
        extra={
          <Button
            type="primary"
            loading={saveRule.isPending}
            onClick={() => ruleForm.submit()}
          >
            发布
          </Button>
        }
      >
        <Form
          form={ruleForm}
          layout="vertical"
          onFinish={(values) => saveRule.mutate(values)}
        >
          <Card size="small" title="计价规则">
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item
                  name={["pricing", "shiftHours"]}
                  label="班次时长（小时）"
                  tooltip="仅按班次计价时生效。留空按 8 小时。"
                >
                  <InputNumber min={0.5} max={24} step={0.5} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item
                  name={["pricing", "shiftStartHours"]}
                  label="班次起始小时"
                  tooltip="按营业时区的当地小时，例如 0、8、16 表示三班制。填了边界就按「跨过几个班次窗口」计费；留空则按班次时长整除。"
                >
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="留空表示不按边界计费"
                    options={Array.from({ length: 24 }, (_, hour) => ({
                      value: hour,
                      label: `${String(hour).padStart(2, "0")}:00`,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card size="small" title="支付与履约">
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name={["payment", "timing"]} label="支付时点">
                  <Select
                    options={[
                      "order",
                      "confirmation",
                      "pickup",
                      "offline_terms",
                    ].map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["payment", "depositMode"]} label="押金方式">
                  <Select
                    options={[
                      "none",
                      "fixed",
                      "price_multiple",
                      "preauthorization",
                    ].map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["payment", "unpaidHoldMinutes"]}
                  label="待支付保留分钟"
                >
                  <InputNumber min={1} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["payment", "preauthorizationRequired"]}
                  label="必须预授权"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["fulfillment", "pickupInspectionRequired"]}
                  label="领取必检"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["fulfillment", "returnInspectionRequired"]}
                  label="归还必检"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["fulfillment", "evidenceRequired"]}
                  label="必须影像证据"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["fulfillment", "allowDifferentReturnLocation"]}
                  label="允许异地归还"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Card size="small" title="超时、取消与损坏" style={{ marginTop: 12 }}>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item
                  name={["overdue", "graceMinutes"]}
                  label="逾期宽限分钟"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["overdue", "feeMode"]} label="逾期收费">
                  <Select
                    options={[
                      "none",
                      "hourly",
                      "next_period",
                      "multiplier",
                      "manual_review",
                    ].map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["overdue", "feeMultiplier"]} label="逾期倍率">
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["overdue", "maximumFee"]} label="逾期封顶">
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "freeBeforeHours"]}
                  label="免费取消小时前"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "lateFeeType"]}
                  label="晚取消收费"
                >
                  <Select
                    options={["none", "fixed_amount", "percentage"].map(
                      (value) => ({ value, label: value }),
                    )}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "lateFeeValue"]}
                  label="晚取消费用值"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "weatherExceptionEnabled"]}
                  label="天气例外"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["damage", "manualReviewRequired"]}
                  label="损坏人工核定"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["damage", "chargeLimit"]}
                  label="损坏收费封顶"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Card size="small" title="资质" style={{ marginTop: 12 }}>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item
                  name={["qualification", "required"]}
                  label="必须审核资质"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["qualification", "documentTypes"]}
                  label="证件类型"
                >
                  <Select mode="tags" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["qualification", "minimumValidityDays"]}
                  label="最少剩余有效天数"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Form.Item
            name="changeReason"
            label="变更原因"
            rules={[{ required: true }]}
            style={{ marginTop: 16 }}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>
      <Drawer
        title={`覆盖营业日 · ${calendarDay?.date ?? ""}`}
        width={480}
        open={Boolean(calendarDay)}
        onClose={() => setCalendarDay(undefined)}
        destroyOnHidden
        extra={
          <Button
            type="primary"
            loading={saveDay.isPending}
            onClick={() => calendarDayForm.submit()}
          >
            保存覆盖
          </Button>
        }
      >
        <Form
          form={calendarDayForm}
          layout="vertical"
          onFinish={(values) => saveDay.mutate(values)}
        >
          <Form.Item name="date" label="日期">
            <Input disabled />
          </Form.Item>
          <Form.Item name="dayType" label="日期类型">
            <Select
              options={[
                "workday",
                "weekend",
                "statutory_holiday",
                "makeup_workday",
                "tenant_special",
              ].map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item name="name" label="名称">
            <Input />
          </Form.Item>
          <Form.Item name="pricingMultiplier" label="价格系数">
            <InputNumber min={0} step={0.05} />
          </Form.Item>
          <Form.Item
            name="overrideReason"
            label="调整原因"
            rules={[{ required: true }]}
            tooltip="人工覆盖必须留下原因；操作人与调整时间由服务端记录。移除覆盖会恢复到官方日历或每周模板的原值。"
          >
            <Input />
          </Form.Item>
          <Form.Item name="closed" label="停业" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="source" hidden>
            <Input />
          </Form.Item>
        </Form>
      </Drawer>
      <Drawer
        title={`导入 ${year} 年官方日历`}
        width={680}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        destroyOnHidden
        extra={
          <Button
            type="primary"
            loading={importCalendar.isPending}
            onClick={() => importForm.submit()}
          >
            导入草稿
          </Button>
        }
      >
        <Form
          form={importForm}
          layout="vertical"
          onFinish={(values) => importCalendar.mutate(values)}
        >
          <Alert
            type="warning"
            showIcon
            message="只接受可信官方来源"
            description="系统记录来源名称、HTTPS 地址、发布日期和导入时间；发布前应人工核对调休工作日。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="sourceName"
            label="来源名称"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="sourceUrl"
            label="来源 URL"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="sourcePublishedAt"
            label="来源发布日期"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="region" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="daysText"
            label="官方日期 JSON"
            rules={[{ required: true }]}
          >
            <Input.TextArea
              rows={14}
              placeholder='[{"date":"2026-10-01","dayType":"statutory_holiday","name":"国庆节"}]'
            />
          </Form.Item>
        </Form>
      </Drawer>
      <Modal
        title="发布年度营业日历"
        open={publishOpen}
        onCancel={() => setPublishOpen(false)}
        onOk={() => publishForm.submit()}
        confirmLoading={publishCalendar.isPending}
        okText="发布"
        destroyOnHidden
      >
        <Form
          form={publishForm}
          layout="vertical"
          onFinish={(values) => publishCalendar.mutate(values.changeReason)}
        >
          <Alert
            type="info"
            showIcon
            message="发布后不可原地修改"
            description="当前已发布版本会被标记为「已被替代」并保留，历史报价仍可追溯原版本；变更原因与相对上一版本的日期差异会一并记录。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="changeReason"
            label="变更原因"
            rules={[
              { required: true, whitespace: true, message: "请填写变更原因" },
            ]}
          >
            <Input.TextArea rows={3} placeholder="例如：按国务院办公厅通知更新国庆调休" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`移除 ${revertTarget?.date ?? ""} 的人工覆盖`}
        open={Boolean(revertTarget)}
        onCancel={() => setRevertTarget(undefined)}
        onOk={() => revertForm.submit()}
        confirmLoading={removeDayOverride.isPending}
        okText="移除覆盖"
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <Form
          form={revertForm}
          layout="vertical"
          onFinish={(values) =>
            revertTarget &&
            removeDayOverride.mutate({
              date: revertTarget.date,
              overrideReason: values.overrideReason,
            })
          }
        >
          <Alert
            type="warning"
            showIcon
            message={
              revertTarget?.overriddenFrom
                ? `将恢复为：${revertTarget.overriddenFrom.name} · ${revertTarget.overriddenFrom.dayType} · 价格系数 ×${revertTarget.overriddenFrom.pricingMultiplier}`
                : "该日期没有官方原值，将按每周模板重算"
            }
            description="移除不会把该日期变成空白日；原覆盖内容、撤销原因与操作人会进入审计流水。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="overrideReason"
            label="调整原因"
            rules={[
              { required: true, whitespace: true, message: "请填写移除原因" },
            ]}
          >
            <Input.TextArea rows={3} placeholder="例如：误将国庆首日标为停业，恢复官方安排" />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        title={
          templateForm.getFieldValue("id") ? "编辑通知模板" : "新增通知模板"
        }
        width={680}
        open={Boolean(templateEditor)}
        onClose={() => setTemplateEditor(null)}
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
                    settings.data?.notifications.enabledEvents ?? []
                  ).map((value) => ({ value, label: value }))}
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
                    settings.data?.notifications.editableChannels ?? []
                  ).map((value) => ({ value, label: value }))}
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
