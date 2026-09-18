import type { RentalCategoryDefinition, RentalRuleVersion } from "@rental-os/shared";
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
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { QueryState } from "@/components/QueryState";
import { normalizeSecurityRules } from "@/features/settings/securityRuleForm";
import {
  errorText,
  preauthorizationRuleLabels,
  ruleSecurityGroups,
  securityRuleLabels,
  type GovernancePermissions,
} from "./shared";

/** 规则版本五态（需求 4.6.1）。服务端按当前时间现算，前端只负责显示。 */
const ruleStatusLabels: Record<string, string> = {
  draft: "草稿",
  pending: "待生效",
  published: "已生效",
  superseded: "已被替代",
  void: "已作废",
};
const ruleStatusColors: Record<string, string> = {
  draft: "default",
  pending: "processing",
  published: "success",
  superseded: "warning",
  void: "error",
};
/** 规则版本审计动作（需求 4.6.14）。 */
const ruleAuditActionLabels: Record<string, string> = {
  publish: "发布",
  restore: "恢复为草稿",
  void: "作废",
};

type RuleForm = RentalRuleVersion["config"] & { changeReason: string };

/**
 * 「业务规则」页签：版本链、发布/恢复/作废审计，以及规则草稿编辑抽屉与三个原因弹窗。
 * 规则版本只追加不改写（需求 4.6.1）；编辑草稿与发布分权（需求 4.6.14）。
 */
export function RulesTab({ permissions, category }: { permissions: GovernancePermissions; category: RentalCategoryDefinition }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { canEditRules, canPublishRules, canSeeRules } = permissions;
  const [ruleEditor, setRuleEditor] = useState<RentalRuleVersion>();
  /** 待发布的草稿。发布原因必填、生效时点可选，因此走独立弹窗并带影响预览。 */
  const [rulePublishTarget, setRulePublishTarget] = useState<RentalRuleVersion>();
  /** 预览用的生效时点（ISO）。与表单分开存，表单值变化才好触发重新预览。 */
  const [rulePublishEffectiveFrom, setRulePublishEffectiveFrom] = useState<string>();
  /** 待恢复的历史规则版本（需求 4.6.1：只能生成新草稿，不得原地改回）。 */
  const [ruleRestoreTarget, setRuleRestoreTarget] = useState<RentalRuleVersion>();
  /** 待作废的待生效或已生效规则版本。 */
  const [ruleVoidTarget, setRuleVoidTarget] = useState<RentalRuleVersion>();
  const [ruleForm] = Form.useForm<RuleForm>();
  const [rulePublishForm] = Form.useForm<{ reason: string; effectiveFrom?: dayjs.Dayjs }>();
  const [ruleRestoreForm] = Form.useForm<{ reason: string }>();
  const [ruleVoidForm] = Form.useForm<{ reason: string }>();

  // 每个查询都按权限 gate：没有规则权限的角色不该无条件发请求收一堆 403。
  const rules = useQuery({
    queryKey: ["rental-core", "rule-versions"],
    queryFn: rentalCoreApi.ruleVersions,
    enabled: canSeeRules,
  });
  /** 规则版本审计（需求 4.6.14）：发布、恢复、作废的原因与操作者。 */
  const ruleAudits = useQuery({
    queryKey: ["rental-core", "rule-version-audits"],
    queryFn: () => rentalCoreApi.ruleVersionAudits(),
    enabled: canSeeRules,
  });
  /** 发布影响预览。只在发布弹窗打开时拉，随生效时点变化重取。 */
  const rulePublishPreview = useQuery({
    queryKey: [
      "rental-core",
      "rule-publish-preview",
      rulePublishTarget?.version,
      rulePublishEffectiveFrom,
    ],
    queryFn: () =>
      rentalCoreApi.ruleVersionPublishPreview(
        rulePublishTarget!.version,
        rulePublishEffectiveFrom,
      ),
    enabled: !!rulePublishTarget && canPublishRules,
  });

  const saveRule = useMutation({
    mutationFn: (values: RuleForm) => {
      const { changeReason, ...config } = values;
      const security = normalizeSecurityRules(
        config,
        category.businessModel.supportsPreauthorization !== false,
      );
      const deposit = security.deposit;
      // 不支持预授权的品类只能保存 none。即使历史快照或缓存表单残留了旧值，
      // 也要给用户一条可恢复路径，不能让禁用控件与后端能力校验形成死锁。
      const preauthorization = security.preauthorization;
      return rentalCoreApi.saveRuleVersion({
        config: {
          ...config,
          deposit,
          preauthorization,
          payment: {
            ...config.payment,
            depositMode:
              deposit.mode !== "none"
                ? deposit.mode === "order_fixed" ? "fixed" : deposit.mode
                : preauthorization.mode !== "none"
                  ? "preauthorization"
                  : "none",
            preauthorizationRequired: preauthorization.mode !== "none",
          },
        },
        changeReason,
        // 只存草稿：已发布版本不可修改（需求 4.6.1），发布是独立的、需要发布权限的动作。
        versionId: ruleEditor?.status === "draft" ? ruleEditor.id : undefined,
      });
    },
    onSuccess: async () => {
      setRuleEditor(undefined);
      ruleForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "rule-versions"],
      });
      message.success("规则草稿已保存，仍需具备发布权限的人发布后才对客户生效");
    },
    onError: () => message.error("草稿保存失败，请检查品类能力和租户设置"),
  });
  const publishRule = useMutation({
    mutationFn: (values: { reason: string; effectiveFrom?: dayjs.Dayjs }) =>
      rentalCoreApi.publishRuleVersion(rulePublishTarget!.version, {
        reason: values.reason,
        effectiveFrom: values.effectiveFrom?.toISOString(),
      }),
    onSuccess: async (row) => {
      setRulePublishTarget(undefined);
      setRulePublishEffectiveFrom(undefined);
      rulePublishForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-versions"] });
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-version-audits"] });
      message.success(
        row.status === "pending" ? "已安排生效，到点后自动按新版本报价" : "新版本已生效",
      );
    },
    onError: (error) => message.error(errorText(error, "发布失败")),
  });
  const restoreRule = useMutation({
    mutationFn: (values: { reason: string }) =>
      rentalCoreApi.restoreRuleVersion(ruleRestoreTarget!.version, values.reason),
    onSuccess: async () => {
      setRuleRestoreTarget(undefined);
      ruleRestoreForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-versions"] });
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-version-audits"] });
      message.success("已按历史版本生成新草稿，原版本保持不变");
    },
    onError: (error) => message.error(errorText(error, "恢复失败")),
  });
  const voidRule = useMutation({
    mutationFn: (values: { reason: string }) =>
      rentalCoreApi.voidRuleVersion(ruleVoidTarget!.version, values.reason),
    onSuccess: async () => {
      setRuleVoidTarget(undefined);
      ruleVoidForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-versions"] });
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-version-audits"] });
      message.success("版本已作废");
    },
    onError: (error) => message.error(errorText(error, "作废失败")),
  });

  /**
   * 打开规则编辑器。传入草稿即继续编辑该草稿；不传则以当前生效版本的内容开一份新草稿。
   * 已发布版本不能直接编辑（需求 4.6.1），要改它须先恢复为新草稿。
   */
  function openRule(row?: RentalRuleVersion) {
    const source =
      row ??
      rules.data?.find((item) => item.status === "draft") ??
      rules.data?.find((item) => item.status === "published") ??
      rules.data?.[0];
    if (!source) return;
    const config = structuredClone(source.config);
    const security = ruleSecurityGroups(config);
    if (category.businessModel.supportsPreauthorization === false) {
      security.preauthorization = { mode: "none" };
    }
    ruleForm.resetFields();
    ruleForm.setFieldsValue({
      ...config,
      ...security,
      // 两个后加的可选块：快照里缺省时补上与服务端一致的默认值，避免表单只填一半
      // 提交出 `{ enabled: undefined }` 这种过不了校验的半成品。
      extension: { pricingMode: "incremental", ...(config.extension ?? { enabled: true, forceImmediateWhenOverdue: true }) },
      earlyReturn: config.earlyReturn ?? { mode: "none", minAdvanceHours: 24, refundPercent: 0, refundUndeliveredServices: false },
      tax: config.tax ?? { rate: 0, inclusive: true },
      cancellation: {
        ...(config.cancellation ?? {}),
        noShow: config.cancellation?.noShow ?? { enabled: true, pickupGraceMinutes: 30, finalizationMinutes: 60, feeType: "percentage", feeValue: 100 }
      },
      changeReason: source.status === "draft" ? source.changeReason : "调整租赁业务规则",
    });
    setRuleEditor(source);
  }
  function openRulePublish(row: RentalRuleVersion) {
    rulePublishForm.resetFields();
    setRulePublishEffectiveFrom(undefined);
    setRulePublishTarget(row);
  }

  // 服务端已按当前时间现算展示状态，因此 published 就是「此刻生效」的唯一一条。
  const currentRule = rules.data?.find((item) => item.status === "published");
  const pendingRules = (rules.data ?? []).filter((item) => item.status === "pending");

  return (
    <>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <div className="table-toolbar">
          <Space>
            {currentRule ? (
              <Tag color="success">
                已生效 v{currentRule.version}
                {currentRule.effectiveFrom
                  ? ` · ${dayjs(currentRule.effectiveFrom).format("YYYY-MM-DD HH:mm")} 起`
                  : ""}
              </Tag>
            ) : (
              <Tag color="error">当前没有生效版本</Tag>
            )}
            <Typography.Text type="secondary">
              报价按租期开始时间匹配版本，未来租期使用覆盖其开始时点的版本
            </Typography.Text>
          </Space>
          {canEditRules && (
            <Button type="primary" onClick={() => openRule()}>
              新建草稿
            </Button>
          )}
        </div>
        {pendingRules.length > 0 && (
          <Alert
            type="info"
            showIcon
            title={`有 ${pendingRules.length} 个待生效版本`}
            description={pendingRules
              .map(
                (row) =>
                  `v${row.version} 自 ${dayjs(row.effectiveFrom).format("YYYY-MM-DD HH:mm")} 起生效`,
              )
              .join("；")}
          />
        )}
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
                  children: (() => {
                    const security = ruleSecurityGroups(currentRule.config);
                    return `押金：${securityRuleLabels[security.deposit.mode]} · 预授权：${preauthorizationRuleLabels[security.preauthorization.mode]}`;
                  })(),
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
                render: (value: string) => (
                  <Tag color={ruleStatusColors[value]}>
                    {ruleStatusLabels[value] ?? value}
                  </Tag>
                ),
              },
              {
                title: "生效时点",
                dataIndex: "effectiveFrom",
                render: (value?: string) =>
                  value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—",
              },
              { title: "变更原因", dataIndex: "changeReason" },
              {
                title: "来源",
                dataIndex: "restoredFromVersion",
                render: (value?: string) => (value ? `恢复自 v${value}` : "—"),
              },
              { title: "操作人", dataIndex: "createdBy" },
              {
                title: "创建时间",
                dataIndex: "createdAt",
                render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm"),
              },
              {
                title: "操作",
                key: "actions",
                render: (_, row) => (
                  <Space size={4}>
                    {row.status === "draft" && canEditRules && (
                      <Button type="link" size="small" onClick={() => openRule(row)}>
                        编辑
                      </Button>
                    )}
                    {row.status === "draft" && canPublishRules && (
                      <Button type="link" size="small" onClick={() => openRulePublish(row)}>
                        发布
                      </Button>
                    )}
                    {row.status !== "draft" && canEditRules && (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          ruleRestoreForm.resetFields();
                          setRuleRestoreTarget(row);
                        }}
                      >
                        恢复为草稿
                      </Button>
                    )}
                    {(row.status === "pending" || row.status === "published") &&
                      canPublishRules && (
                        <Button
                          type="link"
                          size="small"
                          danger
                          onClick={() => {
                            ruleVoidForm.resetFields();
                            setRuleVoidTarget(row);
                          }}
                        >
                          作废
                        </Button>
                      )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
        <Card title="发布与作废审计">
          <QueryState loading={ruleAudits.isLoading} error={ruleAudits.error}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={ruleAudits.data ?? []}
              columns={[
                { title: "版本", dataIndex: "version" },
                {
                  title: "动作",
                  dataIndex: "action",
                  render: (value: string) => ruleAuditActionLabels[value] ?? value,
                },
                {
                  title: "状态变化",
                  key: "status",
                  render: (_, row) =>
                    `${row.fromStatus ? (ruleStatusLabels[row.fromStatus] ?? row.fromStatus) : "—"} → ${ruleStatusLabels[row.toStatus] ?? row.toStatus}`,
                },
                { title: "原因", dataIndex: "reason" },
                { title: "操作人", dataIndex: "operator" },
                {
                  title: "时间",
                  dataIndex: "at",
                  render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm"),
                },
              ]}
            />
          </QueryState>
        </Card>
      </Space>

      <Drawer
        title={
          ruleEditor?.status === "draft"
            ? `编辑规则草稿 v${ruleEditor.version}`
            : `新建规则草稿 · 基于 v${ruleEditor?.version ?? ""}`
        }
        size={760}
        open={Boolean(ruleEditor)}
        onClose={() => setRuleEditor(undefined)}
        forceRender
        destroyOnHidden
        extra={
          <Button
            type="primary"
            loading={saveRule.isPending}
            onClick={() => ruleForm.submit()}
          >
            保存草稿
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
                <Form.Item
                  name={["payment", "unpaidHoldMinutes"]}
                  label="待支付保留分钟"
                >
                  <InputNumber min={1} />
                </Form.Item>
              </Col>
              <Form.Item name={["payment", "depositMode"]} hidden><Input /></Form.Item>
              <Form.Item name={["payment", "preauthorizationRequired"]} valuePropName="checked" hidden><Switch /></Form.Item>
              <Col span={8}>
                <Form.Item name={["deposit", "mode"]} label="押金规则" rules={[{ required: true }]}>
                  <Select
                    options={Object.entries(securityRuleLabels).map(([value, label]) => ({ value, label }))}
                    onChange={(mode) => {
                      if (mode !== "order_fixed") ruleForm.resetFields([["deposit", "fixedAmount"]]);
                    }}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["deposit", "maxAmount"]} label="订单押金上限" tooltip="留空表示不设上限；0 表示免押。">
                  <InputNumber min={0} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item noStyle shouldUpdate={(previous, current) => previous.deposit?.mode !== current.deposit?.mode}>
                  {({ getFieldValue }) => getFieldValue(["deposit", "mode"]) === "order_fixed" ? <Form.Item name={["deposit", "fixedAmount"]} label="每单固定押金" tooltip="仅在押金规则选择“每单固定金额”时使用。">
                    <InputNumber min={0} style={{ width: "100%" }} />
                  </Form.Item> : null}
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["preauthorization", "mode"]} label="预授权规则" rules={[{ required: true }]}>
                  <Select
                    options={(category.businessModel.supportsPreauthorization
                      ? Object.entries(preauthorizationRuleLabels)
                      : [["none", securityRuleLabels.none]]
                    ).map(([value, label]) => ({ value, label }))}
                    onChange={(mode) => {
                      if (mode !== "order_fixed") ruleForm.resetFields([["preauthorization", "fixedAmount"]]);
                      if (mode !== "risk_surcharge") ruleForm.resetFields([["preauthorization", "riskSurchargeAmount"]]);
                    }}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["preauthorization", "maxAmount"]} label="订单预授权上限" tooltip="留空表示不设上限；预授权只冻结额度，不计入实收。">
                  <InputNumber min={0} disabled={!category.businessModel.supportsPreauthorization} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item noStyle shouldUpdate={(previous, current) => previous.preauthorization?.mode !== current.preauthorization?.mode}>
                  {({ getFieldValue }) => getFieldValue(["preauthorization", "mode"]) === "order_fixed" ? <Form.Item name={["preauthorization", "fixedAmount"]} label="订单固定预授权" tooltip="仅在预授权规则选择“每单固定金额”时使用。">
                    <InputNumber min={0} disabled={!category.businessModel.supportsPreauthorization} style={{ width: "100%" }} />
                  </Form.Item> : null}
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item noStyle shouldUpdate={(previous, current) => previous.preauthorization?.mode !== current.preauthorization?.mode}>
                  {({ getFieldValue }) => getFieldValue(["preauthorization", "mode"]) === "risk_surcharge" ? <Form.Item name={["preauthorization", "riskSurchargeAmount"]} label="风险附加额度" tooltip="仅在预授权规则选择“租金倍数 + 风险附加”时使用。">
                    <InputNumber min={0} disabled={!category.businessModel.supportsPreauthorization} style={{ width: "100%" }} />
                  </Form.Item> : null}
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
          <Card size="small" title="时租转日租" style={{ marginTop: 12 }}>
            <Row gutter={12}>
              <Col span={8}><Form.Item name={["pricing", "hourToDayEnabled"]} label="启用时租转日租" valuePropName="checked"><Switch /></Form.Item></Col>
              <Col span={8}><Form.Item name={["pricing", "hourToDayThresholdHours"]} label="超过多少小时转日租" tooltip="大于0且不超过24小时。未超过阈值但小时金额达到日价，也按日价封顶。"><InputNumber min={0.01} max={24} /></Form.Item></Col>
            </Row>
            <Typography.Text type="secondary">按连续24小时分段，不按午夜切日。使用同一定价分组、同一价格版本的24小时日价；未配置日价不能使用。发布后随新订单规则固定，不改变已有订单。</Typography.Text>
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
                      { value: "none", label: "不收逾期费" },
                      { value: "hourly", label: "按已购单位折算小时价" },
                      { value: "next_period", label: "按逾期占用的计价周期数" },
                      { value: "multiplier", label: "原租金固定倍率" },
                      { value: "manual_review", label: "人工处理" },
                      { value: "hourly_to_daily", label: "宽限后按小时比例，超过阈值转日费" },
                    ]}
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
              <Form.Item noStyle shouldUpdate={(previous, current) => previous.overdue?.feeMode !== current.overdue?.feeMode}>
                {({ getFieldValue }) => getFieldValue(["overdue", "feeMode"]) === "hourly_to_daily" ? <>
                  <Col span={12}><Form.Item name={["overdue", "hourlyRatePercent"]} label="逾时每小时＝原日价的百分比" rules={[{ required: true, message: "请填写每小时比例" }]} tooltip="例如10表示每小时收原版本对应日价的10%；不重复享受营销优惠。"><InputNumber min={0.01} max={100} suffix="%" /></Form.Item></Col>
                  <Col span={12}><Form.Item name={["overdue", "dailyAfterHours"]} label="逾时超过多少小时转一天" rules={[{ required: true, message: "请填写逾时转日阈值" }]} tooltip="先扣除一次宽限；每连续24小时内，余段超过该阈值或小时费达到日费，改收一天，不叠加小时费。"><InputNumber min={0.01} max={24} /></Form.Item></Col>
                </> : null}
              </Form.Item>
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
                  name={["cancellation", "noShow", "enabled"]}
                  label="启用爽约处理"
                  valuePropName="checked"
                  tooltip="领取超过宽限后先进入待确认爽约；通知客户并达到最终时限后，才能确认爽约并释放占用。"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "noShow", "pickupGraceMinutes"]}
                  label="领取宽限（分钟）"
                  rules={[{ required: true, message: "请填写领取宽限" }]}
                >
                  <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "noShow", "finalizationMinutes"]}
                  label="通知后最终确认（分钟）"
                  rules={[{ required: true, message: "请填写最终确认时限" }]}
                >
                  <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "noShow", "feeType"]}
                  label="爽约费用类型"
                >
                  <Select options={[{ value: "none", label: "不收取" }, { value: "fixed_amount", label: "固定金额" }, { value: "percentage", label: "应付金额百分比" }]} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "noShow", "feeValue"]}
                  label="爽约费用值"
                  tooltip="固定金额按结算币种填写；百分比填写 0-100。"
                  rules={[{ required: true, message: "请填写爽约费用值" }]}
                >
                  <InputNumber min={0} style={{ width: "100%" }} />
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
          <Card size="small" title="续租与提前归还" style={{ marginTop: 12 }}>
            <Row gutter={16}>
              <Col span={12}><Form.Item name={["fulfillment", "pickupBufferMinutes"]} label="领取前准备缓冲（分钟）" tooltip="只占用库存，不计租金；留空按 0。随规则版本固化到订单。"><InputNumber min={0} max={43200} precision={0} /></Form.Item></Col>
              <Col span={12}><Form.Item name={["fulfillment", "returnBufferMinutes"]} label="归还后周转缓冲（分钟）" tooltip="用于检查、清洁、运输等周转；续租与后续订单必须连同双方缓冲一起检查。"><InputNumber min={0} max={43200} precision={0} /></Form.Item></Col>
            </Row>
            <Alert
              type="info"
              showIcon
              title="选择本空间的续租计费方式"
              description="单独计费保留原租期金额，新增时段按申请时价格计算；完整重算沿用原价格与原优惠，再扣此前已计金额。两种方式都检查后续占用及缓冲。发布后新订单固定所选方式，改设置不影响旧订单。"
              style={{ marginBottom: 12 }}
            />
            <Row gutter={12}>
              <Col span={24}><Form.Item name={["extension", "pricingMode"]} label="续租计费方式" rules={[{ required: true }]}><Select options={[{ value: "incremental", label: "新增时段单独计费（原方式）" }, { value: "original_total", label: "按原价格重算完整租期，只补差价" }]} /></Form.Item></Col>
              <Col span={8}>
                <Form.Item name={["extension", "enabled"]} label="允许续租" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["extension", "maxTimes"]} label="最多续租次数" tooltip="留空表示不限">
                  <InputNumber min={1} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["extension", "maxTotalDays"]} label="累计延长天数上限" tooltip="留空表示不限">
                  <InputNumber min={1} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["extension", "forceImmediateWhenOverdue"]}
                  label="逾期续租强制先付"
                  tooltip="沿用新增时段计费时，企业月结订单逾期后可强制先付。原价全租期补差暂不自动处理逾期订单，须先人工核价。"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["earlyReturn", "mode"]} label="提前归还退款">
                  <Select
                    options={[
                      { value: "none", label: "不退租金" },
                      { value: "auto", label: "按规则自动退" },
                      { value: "manual_review", label: "人工审批后退" },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["earlyReturn", "minAdvanceHours"]}
                  label="最少提前小时数"
                  tooltip="汽车租赁惯例填 24：提前不足一天不退"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["earlyReturn", "refundPercent"]} label="剩余租金退款比例(%)">
                  <InputNumber min={0} max={100} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["earlyReturn", "maxRefundAmount"]} label="单笔退款上限" tooltip="留空表示不封顶">
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["earlyReturn", "refundUndeliveredServices"]}
                  label="退未发生的服务费"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Card size="small" title="税（价内税）" style={{ marginTop: 12 }}>
            <Alert
              type="info"
              showIcon
              title="标价即含税，客户看到的应付金额不变"
              description="税额由含税额反算（含税额 × 税率 ÷ (1 + 税率)），只进报表与开票，不改变报价与订单的应付金额。押金不计税。香港等无增值税的空间填 0 即可。"
              style={{ marginBottom: 12 }}
            />
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item
                  name={["tax", "rate"]}
                  label="税率"
                  tooltip="小数形式：13% 填 0.13，6% 填 0.06，不计税填 0"
                >
                  <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["tax", "label"]} label="票面税种" tooltip="仅用于展示与开票参考，不参与计算">
                  <Input placeholder="例如：增值税 13%" />
                </Form.Item>
              </Col>
              {/* inclusive 恒为 true：价外税还没实现，给个只读开关比留一个能拨错的选项安全。 */}
              <Col span={8}>
                <Form.Item name={["tax", "inclusive"]} label="价内税" valuePropName="checked" tooltip="当前只支持价内税">
                  <Switch disabled />
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
      <Modal
        title={`发布规则版本 v${rulePublishTarget?.version ?? ""}`}
        open={Boolean(rulePublishTarget)}
        onOk={() => rulePublishForm.submit()}
        confirmLoading={publishRule.isPending}
        onCancel={() => {
          setRulePublishTarget(undefined);
          setRulePublishEffectiveFrom(undefined);
        }}
        okText="确认发布"
        forceRender
        destroyOnHidden
        width={640}
      >
        <Form
          form={rulePublishForm}
          layout="vertical"
          onFinish={(values) => publishRule.mutate(values)}
        >
          <Form.Item
            name="effectiveFrom"
            label="生效时点"
            extra="留空表示立即生效；填未来时点即安排生效，到点后自动按新版本报价。生效时点必须晚于已发布的最新版本。"
          >
            <DatePicker
              showTime
              style={{ width: "100%" }}
              onChange={(value) => setRulePublishEffectiveFrom(value?.toISOString())}
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label="发布原因"
            rules={[{ required: true, message: "发布原因必填并写入审计" }]}
          >
            <Input.TextArea rows={2} maxLength={500} showCount />
          </Form.Item>
        </Form>
        <QueryState loading={rulePublishPreview.isLoading} error={rulePublishPreview.error}>
          {rulePublishPreview.data && (
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: "effectiveFrom",
                  label: "生效时点",
                  children: `${dayjs(rulePublishPreview.data.effectiveFrom).format("YYYY-MM-DD HH:mm")}（${rulePublishPreview.data.scheduled ? "待生效" : "立即生效"}）`,
                },
                {
                  key: "current",
                  label: "当前生效版本",
                  children: rulePublishPreview.data.currentVersion
                    ? `v${rulePublishPreview.data.currentVersion}`
                    : "无（首次发布）",
                },
                {
                  key: "superseded",
                  label: "生效后被替代",
                  children: rulePublishPreview.data.supersededVersions.length
                    ? rulePublishPreview.data.supersededVersions
                        .map((value) => `v${value}`)
                        .join("、")
                    : "无",
                },
                {
                  key: "locked",
                  label: "已锁定报价",
                  children: `${rulePublishPreview.data.lockedQuoteCount} 张，仍按各自规则快照结算，不受本次发布影响`,
                },
              ]}
            />
          )}
        </QueryState>
      </Modal>
      <Modal
        title={`恢复规则版本 v${ruleRestoreTarget?.version ?? ""}`}
        open={Boolean(ruleRestoreTarget)}
        onOk={() => ruleRestoreForm.submit()}
        confirmLoading={restoreRule.isPending}
        onCancel={() => setRuleRestoreTarget(undefined)}
        okText="生成新草稿"
        forceRender
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title="恢复只会按该版本的内容生成新草稿"
          description="被恢复的版本原样保留，已发布版本不可修改；新草稿仍需具备发布权限的人发布后才对客户生效。"
        />
        <Form
          form={ruleRestoreForm}
          layout="vertical"
          onFinish={(values) => restoreRule.mutate(values)}
        >
          <Form.Item
            name="reason"
            label="恢复原因"
            rules={[{ required: true, message: "恢复原因必填并写入审计" }]}
          >
            <Input.TextArea rows={2} maxLength={191} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`作废规则版本 v${ruleVoidTarget?.version ?? ""}`}
        open={Boolean(ruleVoidTarget)}
        onOk={() => ruleVoidForm.submit()}
        confirmLoading={voidRule.isPending}
        onCancel={() => setRuleVoidTarget(undefined)}
        okText="确认作废"
        okButtonProps={{ danger: true }}
        forceRender
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title="作废后该版本不再参与任何租期的规则匹配"
          description="若它是当前唯一生效版本，作废后落在该时段的报价会直接失败而不是回落到旧规则；请先发布替代版本。已锁定的报价与订单按各自快照结算，不受影响。"
        />
        <Form form={ruleVoidForm} layout="vertical" onFinish={(values) => voidRule.mutate(values)}>
          <Form.Item
            name="reason"
            label="作废原因"
            rules={[{ required: true, message: "作废原因必填并写入审计" }]}
          >
            <Input.TextArea rows={2} maxLength={191} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
