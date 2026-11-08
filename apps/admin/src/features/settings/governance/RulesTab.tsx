import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import type { RentalCategoryDefinition, RentalRuleVersion } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Descriptions, Space, Tag, Typography } from "antd";
import { ListSection, App, Modal } from "@/components/ui";
import { Form, FormSection } from "@/components/ui";
import { Alert, DatePicker, Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, DataTableRowActions, SaveButton, type DataTableRowAction } from "@/components/ui";
import { Ban, History, Pencil, Upload } from "lucide-react";
import dayjs from "dayjs";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { QueryState } from "@/components/QueryState";
import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { RuleSetupWizard } from "./RuleSetupWizard";
import { CopilotSection } from "@/features/copilot/CopilotSection";
import { overdueFeeModeLabels, paymentTimingLabels } from "./ruleOptionLabels";
import { RULE_SECTIONS, formToConfig, seedFormFromRule, type RuleForm } from "./ruleSections";
import {
  errorText,
  preauthorizationRuleLabels,
  ruleSecurityGroups,
  securityRuleLabels,
  type GovernancePermissions,
} from "./shared";
import styles from "./GovernanceForms.module.css";

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
  const editorDialog = useModalDismissal(Boolean(ruleEditor), () => { setRuleEditor(undefined); ruleForm.resetFields(); });
  const wizardDialog = useModalDismissal(wizardOpen, () => setWizardOpen(false));
  const publishDialog = useModalDismissal(Boolean(rulePublishTarget), () => { setRulePublishTarget(undefined); setRulePublishEffectiveFrom(undefined); rulePublishForm.resetFields(); });
  const restoreDialog = useModalDismissal(Boolean(ruleRestoreTarget), () => { setRuleRestoreTarget(undefined); ruleRestoreForm.resetFields(); });
  const voidDialog = useModalDismissal(Boolean(ruleVoidTarget), () => { setRuleVoidTarget(undefined); ruleVoidForm.resetFields(); });

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
      editorDialog.dismiss();
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
      publishDialog.dismiss();
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
      restoreDialog.dismiss();
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
      voidDialog.dismiss();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-versions"] });
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-version-audits"] });
      message.success(t("版本已作废"));
    },
    onError: (error) => message.error(errorText(error, t("作废失败"))),
  });

  /**
   * 打开规则编辑器。优先继续已有草稿；没有草稿时以现有版本为基础另存草稿。
   * 已发布版本不能原地编辑（需求 4.6.1），保存时不会传入它的 versionId。
   */
  function openRule(row?: RentalRuleVersion) {
    const source =
      row ??
      rules.data?.find((item) => item.status === "draft") ??
      rules.data?.find((item) => item.status === "published") ??
      rules.data?.[0];
    if (!source) return;
    ruleForm.resetFields();
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
  const existingDraft = rules.data?.find((item) => item.status === "draft");
  const readBlocked = rules.isFetching || rules.isError;
  const pendingRules = (rules.data ?? []).filter((item) => item.status === "pending");

  return (
    <>
      <QueryState loading={rules.isLoading} error={rules.error} onRetry={() => rules.refetch({ throwOnError: true })}>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <div className="table-toolbar">
          <div className={styles.ruleSummary}>
            {currentRule ? (
              <Tag color="success">
                {t("已生效")} v{currentRule.version}
              </Tag>
            ) : (
              <Tag color="error">{t("当前没有生效版本")}</Tag>
            )}
            {currentRule?.effectiveFrom && <span>{t("自 {time} 起", { time: dayjs(currentRule.effectiveFrom).format("YYYY-MM-DD HH:mm") })}</span>}
            <Typography.Text type="secondary">
              {t("报价按租期开始时间匹配版本，未来租期使用覆盖其开始时点的版本")}
            </Typography.Text>
          </div>
          {canEditRules && (
            <Space wrap>
              {/* 首次开业、还没有任何生效版本时，向导是主入口，把整表拆成 7 步逐项引导；
                  已有版本后向导降为次要入口，熟练用户走「新建草稿」的整表编辑。 */}
              <Button
                type={currentRule ? "default" : "primary"}
                disabled={readBlocked}
                onClick={() => setWizardOpen(true)}
              >
                {t("使用向导配置")}
              </Button>
              <Button
                type={currentRule ? "primary" : "default"}
                disabled={readBlocked}
                onClick={() => rules.data?.length ? openRule() : setWizardOpen(true)}
              >
                {t(existingDraft ? "继续编辑草稿" : "新建草稿")}
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
          <CopilotSection id="business-rules" title={t("业务规则")} fields={[
            { key: "version", label: t("已生效版本"), value: currentRule.version },
            { key: "graceMinutes", label: t("逾期宽限时间"), value: `${currentRule.config.overdue.graceMinutes} ${t("分钟")}` },
            { key: "feeMode", label: t("逾期计费方式"), value: t(overdueFeeModeLabels[currentRule.config.overdue.feeMode] ?? currentRule.config.overdue.feeMode) },
            { key: "freeBeforeHours", label: t("免费取消截止"), value: `${currentRule.config.cancellation.freeBeforeHours} ${t("小时前")}` },
            { key: "paymentTiming", label: t("支付时点"), value: t(paymentTimingLabels[currentRule.config.payment.timing] ?? currentRule.config.payment.timing) },
          ]}><Card>
            <Descriptions
              column={{ xs: 1, md: 2, xl: 3 }}
              items={[
                {
                  key: "payment",
                  label: t("支付与占位"),
                  children: `${t(paymentTimingLabels[currentRule.config.payment.timing] ?? currentRule.config.payment.timing)} · ${currentRule.config.payment.unpaidHoldMinutes} ${t("分钟")}`,
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
                  children: <span data-copilot-anchor="overdue-fees">{currentRule.config.overdue.graceMinutes} {t("分钟")} · {t(overdueFeeModeLabels[currentRule.config.overdue.feeMode] ?? currentRule.config.overdue.feeMode)}</span>,
                },
                {
                  key: "cancel",
                  label: t("取消"),
                  children: <span data-copilot-anchor="cancellation-rules">{currentRule.config.cancellation.freeBeforeHours} {t("小时前免费")}</span>,
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
          </Card></CopilotSection>
        )}
        <ListSection title={t("版本历史")}>
          <Table<RentalRuleVersion>
            rowKey="id"
            pagination={false}
            onRefresh={() => rules.refetch()} loading={rules.isLoading} refreshing={rules.isFetching} dataSource={rules.data ?? []}
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
                render: (_, row) => {
                  const actions: DataTableRowAction[] = [
                    ...(row.status === "draft" && canEditRules ? [{ id: "edit", label: t("编辑"), icon: Pencil, onSelect: () => openRule(row) }] : []),
                    ...(row.status === "draft" && canPublishRules ? [{ id: "publish", label: t("发布"), icon: Upload, onSelect: () => openRulePublish(row) }] : []),
                    ...(row.status !== "draft" && canEditRules ? [{ id: "restore", label: t("恢复为草稿"), icon: History, onSelect: () => { ruleRestoreForm.resetFields(); setRuleRestoreTarget(row); } }] : []),
                    ...((row.status === "pending" || row.status === "published") && canPublishRules ? [{ id: "void", label: t("作废"), icon: Ban, danger: true, onSelect: () => { ruleVoidForm.resetFields(); setRuleVoidTarget(row); } }] : []),
                  ].map(action => ({ ...action, disabled: readBlocked }));
                  const primary = actions[0];
                  return primary ? <DataTableRowActions primary={primary} actions={actions} details={primary.onSelect} detailLabel={primary.label}
                    menuLabel={`v${row.version} · ${t("更多操作")}`} /> : <Typography.Text type="secondary">{t("只读")}</Typography.Text>;
                },
              },
            ]}
          />
        </ListSection>
        <ListSection title={t("发布与作废审计")}>
          <QueryState loading={ruleAudits.isLoading} error={ruleAudits.error} onRetry={() => ruleAudits.refetch({ throwOnError: true })}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              onRefresh={() => ruleAudits.refetch()} loading={ruleAudits.isLoading} refreshing={ruleAudits.isFetching} dataSource={ruleAudits.data ?? []}
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
        </ListSection>
      </Space>
      </QueryState>

      <Modal presentation="side"
        title={
          ruleEditor?.status === "draft"
            ? `${t("编辑规则草稿")} v${ruleEditor.version}`
            : `${t("新建规则草稿 · 基于")} v${ruleEditor?.version ?? ""}`
        }
        width={760}
        open={editorDialog.visible}
        onCancel={editorDialog.dismiss}
        afterClose={editorDialog.afterClose}
        closable={!saveRule.isPending}
        keyboard={!saveRule.isPending}
        maskClosable={!saveRule.isPending}
        forceRender
        destroyOnHidden
        footer={
          <><Button disabled={saveRule.isPending} onClick={editorDialog.dismiss}>{t("取消")}</Button><SaveButton label={t("保存草稿")} form={ruleForm} pending={saveRule.isPending} onSave={(values) => saveRule.mutateAsync(values)} /></>
        }
      >
        <Form
          form={ruleForm}
          className={styles.ruleFields}
          layout="vertical"
          disabled={saveRule.isPending}
          onFinish={(values) => saveRule.mutate(values)}
        >
          <SettingsWorkspace sections={RULE_SECTIONS.map(section => ({key:section.key,label:t(section.title),content:<FormSection title={t(section.title)} description={t(section.description)}>{section.render({form:ruleForm,category,t})}</FormSection>}))}/>
          <Form.Item
            name="changeReason"
            label={t("变更原因")}
            rules={[{ required: true }]}
            style={{ marginTop: 16 }}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
      {wizardOpen && (
          <RuleSetupWizard
            open={wizardDialog.visible}
            category={category}
            permissions={permissions}
            seed={currentRule ?? existingDraft}
            onClose={wizardDialog.dismiss}
            afterClose={wizardDialog.afterClose}
          />
      )}
      <Modal
        title={`${t("发布规则版本")} v${rulePublishTarget?.version ?? ""}`}
        open={publishDialog.visible}
        onConfirm={() => rulePublishForm.validateFields().then((values) => publishRule.mutateAsync(values))}
        confirmLoading={publishRule.isPending}
        onCancel={publishDialog.dismiss}
        afterClose={publishDialog.afterClose}
        closable={!publishRule.isPending} keyboard={!publishRule.isPending} maskClosable={!publishRule.isPending}
        cancelButtonProps={{ disabled: publishRule.isPending }}
        okButtonProps={{ disabled: rulePublishPreview.isFetching || rulePublishPreview.isError || !rulePublishPreview.data }}
        okText={t("确认发布")}
        forceRender
        destroyOnHidden
        width={640}
      >
        <Form
          form={rulePublishForm}
          layout="vertical"
          disabled={publishRule.isPending}
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
        <QueryState loading={rulePublishPreview.isLoading} error={rulePublishPreview.error} onRetry={() => rulePublishPreview.refetch({ throwOnError: true })}>
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
        open={restoreDialog.visible}
        onConfirm={() => ruleRestoreForm.validateFields().then((values) => restoreRule.mutateAsync(values))}
        confirmLoading={restoreRule.isPending}
        onCancel={restoreDialog.dismiss}
        afterClose={restoreDialog.afterClose}
        closable={!restoreRule.isPending} keyboard={!restoreRule.isPending} maskClosable={!restoreRule.isPending}
        cancelButtonProps={{ disabled: restoreRule.isPending }}
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
          disabled={restoreRule.isPending}
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
        open={voidDialog.visible}
        onConfirm={() => ruleVoidForm.validateFields().then((values) => voidRule.mutateAsync(values))}
        confirmLoading={voidRule.isPending}
        onCancel={voidDialog.dismiss}
        afterClose={voidDialog.afterClose}
        closable={!voidRule.isPending} keyboard={!voidRule.isPending} maskClosable={!voidRule.isPending}
        cancelButtonProps={{ disabled: voidRule.isPending }}
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
        <Form form={ruleVoidForm} layout="vertical" disabled={voidRule.isPending} onFinish={(values) => voidRule.mutate(values)}>
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
