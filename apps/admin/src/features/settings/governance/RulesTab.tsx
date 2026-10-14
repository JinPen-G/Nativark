import type { RentalCategoryDefinition, RentalRuleVersion } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Descriptions, Space, Tag, Typography } from "antd";
import { App, Modal } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, DatePicker, Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, Drawer, SaveButton } from "@/components/ui";
import dayjs from "dayjs";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { QueryState } from "@/components/QueryState";
import { RuleSetupWizard } from "./RuleSetupWizard";
import { RULE_SECTIONS, formToConfig, seedFormFromRule, type RuleForm } from "./ruleSections";
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

/**
 * 「业务规则」页签：版本链、发布/恢复/作废审计，以及规则草稿编辑抽屉与三个原因弹窗。
 * 规则版本只追加不改写（需求 4.6.1）；编辑草稿与发布分权（需求 4.6.14）。
 */
export function RulesTab({ permissions, category }: { permissions: GovernancePermissions; category: RentalCategoryDefinition }) {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { canEditRules, canPublishRules, canSeeRules } = permissions;
  const [ruleEditor, setRuleEditor] = useState<RentalRuleVersion>();
  /** 「新建规则向导」抽屉：首次开业、无版本可编辑时的分步引导入口。 */
  const [wizardOpen, setWizardOpen] = useState(false);
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
    // 押金/预授权派生与 payment 兜底抽到 ruleSections 的 formToConfig，与「新建规则向导」共用同一份 map-out。
    mutationFn: (values: RuleForm) =>
      rentalCoreApi.saveRuleVersion({
        config: formToConfig(values, category),
        changeReason: values.changeReason,
        // 只存草稿：已发布版本不可修改（需求 4.6.1），发布是独立的、需要发布权限的动作。
        versionId: ruleEditor?.status === "draft" ? ruleEditor.id : undefined,
      }),
    onSuccess: async () => {
      setRuleEditor(undefined);
      ruleForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "rule-versions"],
      });
      message.success(t("规则草稿已保存，仍需具备发布权限的人发布后才对客户生效"));
    },
    onError: () => message.error(t("草稿保存失败，请检查品类能力和租户设置")),
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
        row.status === "pending" ? t("已安排生效，到点后自动按新版本报价") : t("新版本已生效"),
      );
    },
    onError: (error) => message.error(errorText(error, t("发布失败"))),
  });
  const restoreRule = useMutation({
    mutationFn: (values: { reason: string }) =>
      rentalCoreApi.restoreRuleVersion(ruleRestoreTarget!.version, values.reason),
    onSuccess: async () => {
      setRuleRestoreTarget(undefined);
      ruleRestoreForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-versions"] });
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-version-audits"] });
      message.success(t("已按历史版本生成新草稿，原版本保持不变"));
    },
    onError: (error) => message.error(errorText(error, t("恢复失败"))),
  });
  const voidRule = useMutation({
    mutationFn: (values: { reason: string }) =>
      rentalCoreApi.voidRuleVersion(ruleVoidTarget!.version, values.reason),
    onSuccess: async () => {
      setRuleVoidTarget(undefined);
      ruleVoidForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-versions"] });
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-version-audits"] });
      message.success(t("版本已作废"));
    },
    onError: (error) => message.error(errorText(error, t("作废失败"))),
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
    // seed-in（含押金/预授权派生与可选块默认值）抽到 ruleSections 的 seedFormFromRule，与向导共用。
    seedFormFromRule(ruleForm, source, category);
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
                {t("已生效")} v{currentRule.version}
                {currentRule.effectiveFrom
                  ? ` · ${dayjs(currentRule.effectiveFrom).format("YYYY-MM-DD HH:mm")} ${t("起")}`
                  : ""}
              </Tag>
            ) : (
              <Tag color="error">{t("当前没有生效版本")}</Tag>
            )}
            <Typography.Text type="secondary">
              {t("报价按租期开始时间匹配版本，未来租期使用覆盖其开始时点的版本")}
            </Typography.Text>
          </Space>
          {canEditRules && (
            <Space>
              {/* 首次开业、还没有任何生效版本时，向导是主入口，把整表拆成 7 步逐项引导；
                  已有版本后向导降为次要入口，熟练用户走「新建草稿」的整表编辑。 */}
              <Button
                type={currentRule ? "default" : "primary"}
                onClick={() => setWizardOpen(true)}
              >
                {t("使用向导配置")}
              </Button>
              <Button
                type={currentRule ? "primary" : "default"}
                onClick={() => openRule()}
              >
                {t("新建草稿")}
              </Button>
            </Space>
          )}
        </div>
        {pendingRules.length > 0 && (
          <Alert
            type="info"
            showIcon
            title={`${t("有")} ${pendingRules.length} ${t("个待生效版本")}`}
            description={pendingRules
              .map(
                (row) =>
                  `v${row.version} ${t("自")} ${dayjs(row.effectiveFrom).format("YYYY-MM-DD HH:mm")} ${t("起生效")}`,
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
                  label: t("支付与占位"),
                  children: `${t(currentRule.config.payment.timing)} · ${currentRule.config.payment.unpaidHoldMinutes} ${t("分钟")}`,
                },
                {
                  key: "deposit",
                  label: t("押金/预授权"),
                  children: (() => {
                    const security = ruleSecurityGroups(currentRule.config);
                    return `${t("押金")}：${t(securityRuleLabels[security.deposit.mode])} · ${t("预授权")}：${t(preauthorizationRuleLabels[security.preauthorization.mode])}`;
                  })(),
                },
                {
                  key: "inspection",
                  label: t("交接检查"),
                  children: `${t(currentRule.config.fulfillment.pickupInspectionRequired ? "领取必检" : "领取选检")} / ${t(currentRule.config.fulfillment.returnInspectionRequired ? "归还必检" : "归还选检")}`,
                },
                {
                  key: "overdue",
                  label: t("逾期"),
                  children: `${currentRule.config.overdue.graceMinutes} ${t("分钟")} · ${t(currentRule.config.overdue.feeMode)}`,
                },
                {
                  key: "cancel",
                  label: t("取消"),
                  children: `${currentRule.config.cancellation.freeBeforeHours} ${t("小时前免费")}`,
                },
                {
                  key: "qualification",
                  label: t("资质"),
                  children: currentRule.config.qualification.required
                    ? currentRule.config.qualification.documentTypes.join(
                        "、",
                      )
                    : t("不要求"),
                },
              ]}
            />
          </Card>
        )}
        <Card title={t("版本历史")}>
          <Table<RentalRuleVersion>
            rowKey="id"
            pagination={false}
            dataSource={rules.data ?? []}
            columns={[
              { title: t("版本"), dataIndex: "version" },
              {
                title: t("状态"),
                dataIndex: "status",
                render: (value: string) => (
                  <Tag color={ruleStatusColors[value]}>
                    {t(ruleStatusLabels[value] ?? value)}
                  </Tag>
                ),
              },
              {
                title: t("生效时点"),
                dataIndex: "effectiveFrom",
                render: (value?: string) =>
                  value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—",
              },
              { title: t("变更原因"), dataIndex: "changeReason" },
              {
                title: t("来源"),
                dataIndex: "restoredFromVersion",
                render: (value?: string) => (value ? `${t("恢复自")} v${value}` : "—"),
              },
              { title: t("操作人"), dataIndex: "createdBy" },
              {
                title: t("创建时间"),
                dataIndex: "createdAt",
                render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm"),
              },
              {
                title: t("操作"),
                key: "actions",
                render: (_, row) => (
                  <Space size={4}>
                    {row.status === "draft" && canEditRules && (
                      <Button type="link" size="small" onClick={() => openRule(row)}>
                        {t("编辑")}
                      </Button>
                    )}
                    {row.status === "draft" && canPublishRules && (
                      <Button type="link" size="small" onClick={() => openRulePublish(row)}>
                        {t("发布")}
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
                        {t("恢复为草稿")}
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
                          {t("作废")}
                        </Button>
                      )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
        <Card title={t("发布与作废审计")}>
          <QueryState loading={ruleAudits.isLoading} error={ruleAudits.error}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={ruleAudits.data ?? []}
              columns={[
                { title: t("版本"), dataIndex: "version" },
                {
                  title: t("动作"),
                  dataIndex: "action",
                  render: (value: string) => t(ruleAuditActionLabels[value] ?? value),
                },
                {
                  title: t("状态变化"),
                  key: "status",
                  render: (_, row) =>
                    `${row.fromStatus ? t(ruleStatusLabels[row.fromStatus] ?? row.fromStatus) : "—"} → ${t(ruleStatusLabels[row.toStatus] ?? row.toStatus)}`,
                },
                { title: t("原因"), dataIndex: "reason" },
                { title: t("操作人"), dataIndex: "operator" },
                {
                  title: t("时间"),
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
            ? `${t("编辑规则草稿")} v${ruleEditor.version}`
            : `${t("新建规则草稿 · 基于")} v${ruleEditor?.version ?? ""}`
        }
        size={760}
        open={Boolean(ruleEditor)}
        onClose={() => setRuleEditor(undefined)}
        forceRender
        destroyOnHidden
        extra={
          <SaveButton label={t("保存草稿")} form={ruleForm} pending={saveRule.isPending} onSave={(values) => saveRule.mutateAsync(values)} />
        }
      >
        <Form
          form={ruleForm}
          layout="vertical"
          onFinish={(values) => saveRule.mutate(values)}
        >
          {/* 分区清单抽到 ruleSections.tsx 的 RULE_SECTIONS，后续「新建规则向导」复用同一份。
              这里只负责套 Card 外壳（标题 + 一句话「何时生效」说明），字段与语义都在那份清单里。 */}
          {RULE_SECTIONS.map((section, index) => (
            <Card
              key={section.key}
              size="small"
              title={t(section.title)}
              style={index === 0 ? undefined : { marginTop: 12 }}
            >
              <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                {t(section.description)}
              </Typography.Text>
              {section.render({ form: ruleForm, category, t })}
            </Card>
          ))}
          <Form.Item
            name="changeReason"
            label={t("变更原因")}
            rules={[{ required: true }]}
            style={{ marginTop: 16 }}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>
      <Drawer
        title={t("新建规则向导")}
        size={760}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        destroyOnHidden
      >
        {wizardOpen && (
          <RuleSetupWizard
            category={category}
            permissions={permissions}
            seed={currentRule ?? rules.data?.find((row) => row.status === "draft")}
            onClose={() => setWizardOpen(false)}
          />
        )}
      </Drawer>
      <Modal
        title={`${t("发布规则版本")} v${rulePublishTarget?.version ?? ""}`}
        open={Boolean(rulePublishTarget)}
        onConfirm={() => rulePublishForm.validateFields().then((values) => publishRule.mutateAsync(values))}
        confirmLoading={publishRule.isPending}
        onCancel={() => {
          setRulePublishTarget(undefined);
          setRulePublishEffectiveFrom(undefined);
        }}
        okText={t("确认发布")}
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
            label={t("生效时点")}
            extra={t("留空表示立即生效；填未来时点即安排生效，到点后自动按新版本报价。生效时点必须晚于已发布的最新版本。")}
          >
            <DatePicker
              showTime
              style={{ width: "100%" }}
              onChange={(value) => setRulePublishEffectiveFrom(value?.toISOString())}
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label={t("发布原因")}
            rules={[{ required: true, message: t("发布原因必填并写入审计") }]}
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
                  label: t("生效时点"),
                  children: `${dayjs(rulePublishPreview.data.effectiveFrom).format("YYYY-MM-DD HH:mm")}（${t(rulePublishPreview.data.scheduled ? "待生效" : "立即生效")}）`,
                },
                {
                  key: "current",
                  label: t("当前生效版本"),
                  children: rulePublishPreview.data.currentVersion
                    ? `v${rulePublishPreview.data.currentVersion}`
                    : t("无（首次发布）"),
                },
                {
                  key: "superseded",
                  label: t("生效后被替代"),
                  children: rulePublishPreview.data.supersededVersions.length
                    ? rulePublishPreview.data.supersededVersions
                        .map((value) => `v${value}`)
                        .join("、")
                    : t("无"),
                },
                {
                  key: "locked",
                  label: t("已锁定报价"),
                  children: `${rulePublishPreview.data.lockedQuoteCount} ${t("张，仍按各自规则快照结算，不受本次发布影响")}`,
                },
              ]}
            />
          )}
        </QueryState>
      </Modal>
      <Modal
        title={`${t("恢复规则版本")} v${ruleRestoreTarget?.version ?? ""}`}
        open={Boolean(ruleRestoreTarget)}
        onConfirm={() => ruleRestoreForm.validateFields().then((values) => restoreRule.mutateAsync(values))}
        confirmLoading={restoreRule.isPending}
        onCancel={() => setRuleRestoreTarget(undefined)}
        okText={t("生成新草稿")}
        forceRender
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={t("恢复只会按该版本的内容生成新草稿")}
          description={t("被恢复的版本原样保留，已发布版本不可修改；新草稿仍需具备发布权限的人发布后才对客户生效。")}
        />
        <Form
          form={ruleRestoreForm}
          layout="vertical"
          onFinish={(values) => restoreRule.mutate(values)}
        >
          <Form.Item
            name="reason"
            label={t("恢复原因")}
            rules={[{ required: true, message: t("恢复原因必填并写入审计") }]}
          >
            <Input.TextArea rows={2} maxLength={191} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`${t("作废规则版本")} v${ruleVoidTarget?.version ?? ""}`}
        open={Boolean(ruleVoidTarget)}
        onConfirm={() => ruleVoidForm.validateFields().then((values) => voidRule.mutateAsync(values))}
        confirmLoading={voidRule.isPending}
        onCancel={() => setRuleVoidTarget(undefined)}
        okText={t("确认作废")}
        okButtonProps={{ danger: true }}
        forceRender
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={t("作废后该版本不再参与任何租期的规则匹配")}
          description={t("若它是当前唯一生效版本，作废后落在该时段的报价会直接失败而不是回落到旧规则；请先发布替代版本。已锁定的报价与订单按各自快照结算，不受影响。")}
        />
        <Form form={ruleVoidForm} layout="vertical" onFinish={(values) => voidRule.mutate(values)}>
          <Form.Item
            name="reason"
            label={t("作废原因")}
            rules={[{ required: true, message: t("作废原因必填并写入审计") }]}
          >
            <Input.TextArea rows={2} maxLength={191} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
