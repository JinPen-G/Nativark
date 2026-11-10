import { MemberCard, MemberCardFacePicker, membershipPlanCards } from "./membershipPlanCards";
import { savedMemberCardFace, saveMemberCardFace, type MemberCardFace } from "./memberCardAppearance";
import { DataTableText, ListFilters, useListFilter } from "@/components/ui";
import type {
  CustomerMembershipBenefit,
  CustomerMembershipPlan,
  CustomerMembershipScopeOptions,
  SaveCustomerMembershipPlanRequest,
} from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Col, InputNumber, Row, Space, Tag } from "antd";
import { FormSection, ListSection, App } from "@/components/ui";
import { Checkbox } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, DataTableRowActions, Modal, SaveButton, Select } from "@/components/ui";
import { Pencil, Send } from "lucide-react";
import { useState } from "react";
import { membershipApi } from "@/api/membership";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { ADMIN_TABLE_COLUMN_WIDTH } from "@/app/designTokens";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { useModalDismissal } from "@/components/ui/useModalDismissal";

const benefitOptions = [
  { value: "rental_discount", label: "租金优惠" },
  { value: "deposit_reduction", label: "押金减免" },
  { value: "preauth_reduction", label: "预授权减免" },
  { value: "service_benefit", label: "增值服务权益" },
  { value: "priority_reservation", label: "优先预订" },
  { value: "quote_validity_extension", label: "报价有效期延长" },
];
const scopeTypeOptions = [
  { value: "tenant", label: "租户全部空间" },
  { value: "workspaces", label: "指定经营空间" },
  { value: "categories", label: "指定租赁品类" },
];
type VersionAction = { kind: "disable" | "restore"; planId: string; versionId: string; version: number; planName: string };
type PlanEditorValues = SaveCustomerMembershipPlanRequest & { cardFace: MemberCardFace };

/** 列表、版本历史和授予快照共用同一范围说明，不向运营展示内部 ID。 */
export function MembershipBenefitScopeSummary({ benefits, options }: {
  benefits: CustomerMembershipBenefit[];
  options?: CustomerMembershipScopeOptions;
}) {
  const { t } = useLocale();
  if (!benefits.length) return <span>{t("无权益")}</span>;
  return <Space orientation="vertical" size={0}>
    {benefits.map((benefit, index) => {
      const scope = benefit.scope;
      let label = t("租户全部空间");
      if (scope?.type === "workspaces") {
        label = `${t("指定空间")}: ${scope.workspaceIds.map((id) => options?.workspaces.find((workspace) => workspace.id === id)?.name ?? (options ? t("已不可用空间") : t("空间名称未加载"))).join(", ") || t("未选择空间")}`;
      } else if (scope?.type === "categories") {
        label = `${t("指定品类")}: ${scope.categoryCodes.map((code) => options?.categories.find((category) => category.code === code)?.name ?? (options ? t("已不可用品类") : t("品类名称未加载"))).join(", ") || t("未选择品类")}`;
      }
      return <span key={index}>{t(benefitOptions.find((option) => option.value === benefit.type)?.label ?? benefit.type)} · {label}</span>;
    })}
  </Space>;
}

export function MembershipPlanPage() {
  const identity = useListQueryIdentity();
  const grants = useAuthStore(state => JSON.stringify(state.user?.tenantMembership));
  const scope = `${identity}:${grants}`;
  return <MembershipPlanWorkspace key={scope} scope={scope} />;
}

function MembershipPlanWorkspace({ scope }: { scope: string }) {
  const { message } = App.useApp();
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const hasTenantMembershipPermission = useAuthStore((state) => state.hasTenantMembershipPermission);
  const canManage = hasTenantMembershipPermission("rental-os:member:plan:manage");
  const canPublish = hasTenantMembershipPermission("rental-os:member:plan:publish");
  const canView = hasTenantMembershipPermission("rental-os:member:view") || canManage || canPublish;
  const [selected, setSelected] = useState<CustomerMembershipPlan>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [historyPlan, setHistoryPlan] = useState<CustomerMembershipPlan>();
  const [versionAction, setVersionAction] = useState<VersionAction>();
  const [form] = Form.useForm<PlanEditorValues>();
  const [actionForm] = Form.useForm<{ reason: string }>();
  const editor = useModalDismissal(editorOpen, () => { setEditorOpen(false); setSelected(undefined); form.resetFields(); });
  const historyDialog = useModalDismissal(Boolean(historyPlan), () => setHistoryPlan(undefined));
  const actionDialog = useModalDismissal(Boolean(versionAction), () => { setVersionAction(undefined); actionForm.resetFields(); });
  const plans = useQuery({ queryKey: ["membership-plans", scope], queryFn: membershipApi.plans, enabled: canView });
  const planFilter = useListFilter(plans.data, { fields: row => [row.name, row.code], status: row => row.status });
  const scopeOptions = useQuery({ queryKey: ["membership-benefit-scope-options", scope], queryFn: membershipApi.benefitScopeOptions, enabled: canView });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["membership-plans"] });
  const save = useMutation({
    mutationFn: async ({ cardFace, ...values }: PlanEditorValues) => {
      const account = useAuthStore.getState().user?.id;
      const saved = await membershipApi.savePlan({ ...values, id: selected?.id });
      saveMemberCardFace(saved, cardFace, account);
      return saved;
    },
    onSuccess: async () => {
      await refresh();
      editor.dismiss();
      message.success(t("会员方案草稿已保存"));
    },
  });
  const publish = useMutation({
    mutationFn: (values: { planId: string; versionId: string }) => membershipApi.publishPlan(values.planId, values.versionId),
    onSuccess: async () => { await refresh(); message.success(t("方案版本已发布，后续编辑会生成新草稿")); },
  });
  const disable = useMutation({
    mutationFn: (values: { planId: string; versionId: string; reason: string }) => membershipApi.disablePlan(values.planId, values.versionId, values.reason),
    onSuccess: async () => {
      await refresh();
      actionDialog.dismiss();
      message.success(t("方案版本已停用，已授予会员的权益快照不受影响"));
    },
  });
  const restore = useMutation({
    mutationFn: (values: { planId: string; versionId: string; reason: string }) => membershipApi.restorePlan(values.planId, values.versionId, values.reason),
    onSuccess: async () => {
      await refresh();
      actionDialog.dismiss();
      message.success(t("已基于历史版本生成新的草稿"));
    },
  });
  const open = (plan?: CustomerMembershipPlan) => {
    if (!canManage || save.isPending || plans.isError) return;
    setSelected(plan);
    form.resetFields();
    const version = plan?.currentVersion;
    form.setFieldsValue(plan ? {
      code: plan.code,
      name: plan.name,
      targetType: plan.targetType,
      levelRank: version?.levelRank ?? 1,
      isDefault: version?.isDefault,
      isRecommended: version?.isRecommended,
      appVisible: version?.appVisible,
      effectiveFrom: version?.effectiveFrom,
      effectiveTo: version?.effectiveTo,
      eligibility: version?.eligibility,
      cardFace: savedMemberCardFace(plan, useAuthStore.getState().user?.id),
      benefits: (version?.benefits ?? []).map((benefit) => ({ ...benefit, scope: benefit.scope ?? { type: "tenant" } })),
    } : { targetType: "personal", levelRank: 1, benefits: [], cardFace: "pearl" });
    setEditorOpen(true);
  };
  const openVersionAction = (action: VersionAction) => { setVersionAction(action); actionForm.resetFields(); };
  const submitVersionAction = async (values: { reason: string }) => {
    if (!versionAction || !canPublish || disable.isPending || restore.isPending) throw new Error("Membership version action unavailable");
    const input = { planId: versionAction.planId, versionId: versionAction.versionId, reason: values.reason };
    if (versionAction.kind === "disable") return disable.mutateAsync(input);
    return restore.mutateAsync(input);
  };

  if (!canView) return <Alert type="warning" showIcon title={t("无权查看租户统一会员方案")} description={t("需要租户级会员查看、方案管理或方案发布权限，且数据范围为全部。")} />;

  const historyRecord = plans.data?.find(plan => plan.id === historyPlan?.id) ?? historyPlan;
  const editorUnavailable = !canManage || scopeOptions.isPending || scopeOptions.isError || plans.isError;
  const versionBusy = disable.isPending || restore.isPending;
  return <QueryState loading={plans.isLoading} error={plans.error} onRetry={() => plans.refetch({ throwOnError: true })}>
    <PageHeader title={t("会员方案")} description={t("方案在租户内共享，权益按各自适用范围生效。")} extra={<Button type="primary" disabled={editorUnavailable || save.isPending} onClick={() => open()}>{t("新增方案")}</Button>} />

    {scopeOptions.error && <Alert type="error" showIcon title={t("适用范围名称加载失败")} description={scopeOptions.error.message} style={{ marginBottom: 16 }} />}
    <ListSection controls={<ListFilters filter={planFilter} placeholder="方案名称或编码" options={[{ value: "active", label: "已启用" }, { value: "disabled", label: "已停用" }, { value: "draft", label: "草稿" }]} />}>
      <Table<CustomerMembershipPlan> rowKey="id" selectionEnabled={false} onRefresh={() => plans.refetch()} loading={plans.isLoading} refreshing={plans.isFetching} dataSource={planFilter.rows} pagination={planFilter.pagination} scroll={{ x: 1100 }}
        exportConfig={{ filename: t("会员方案"), fields: [{ label: t("编码"), value: row => row.code }, { label: t("方案"), value: row => row.name }, { label: t("适用会员"), value: row => t(row.targetType === "corporate" ? "企业会员" : "个人会员") }, { label: t("版本"), value: row => row.currentVersion?.version }, { label: t("状态"), value: row => t(row.status === "active" ? "已启用" : row.status === "disabled" ? "已停用" : "草稿") }] }}
        cardView={membershipPlanCards({ t, options: scopeOptions.data, canManage, canPublish, publishing: publish.isPending, edit: open, history: setHistoryPlan, publish: row => { if (row.currentVersion?.status === "draft" && canPublish) publish.mutate({ planId: row.id, versionId: row.currentVersion.id }); } })} columns={[
        { title: t("方案"), dataIndex: "name", minWidth: ADMIN_TABLE_COLUMN_WIDTH.identity, render: (_, row) => <DataTableText primary={row.name} secondary={row.code} /> },
        { title: t("适用会员"), dataIndex: "targetType", render: (value) => value === "corporate" ? t("企业会员") : t("个人会员") },
        { title: t("当前版本"), render: (_, row) => row.currentVersion ? `v${row.currentVersion.version}` : t("未建版本") },
        { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "active" ? "success" : value === "disabled" ? "error" : "default"}>{value === "active" ? t("已启用") : value === "disabled" ? t("已停用") : t("草稿")}</Tag> },
        { title: t("权益适用范围"), minWidth: ADMIN_TABLE_COLUMN_WIDTH.summary, render: (_, row) => <MembershipBenefitScopeSummary benefits={row.currentVersion?.benefits ?? []} options={scopeOptions.data} /> },
        { title: t("版本"), render: (_, row) => <Button type="link" disabled={!canView} onClick={() => setHistoryPlan(row)}>{t("查看")} {row.versions?.length ?? 0} {t("个版本")}</Button> },
        { title: t("操作"), render: (_, row) => <DataTableRowActions primary={{ id: "edit", label: t("编辑草稿"), icon: Pencil, disabled: !canManage, onSelect: () => open(row) }} details={() => setHistoryPlan(row)} detailLabel={t("版本")} menuLabel={`${row.name} · ${t("更多操作")}`} actions={row.currentVersion?.status === "draft" ? [
          { id: "publish", label: `${t("发布")} v${row.currentVersion.version}`, icon: Send, disabled: !canPublish || publish.isPending, onSelect: () => publish.mutate({ planId: row.id, versionId: row.currentVersion!.id }) }
        ] : []} /> },
      ]} />
    </ListSection>
    <Modal presentation="side" title={t(selected ? "编辑方案" : "新增会员方案")} width={640} open={editor.visible} onCancel={editor.dismiss} afterClose={editor.afterClose} destroyOnHidden
      closable={!save.isPending} keyboard={!save.isPending} maskClosable={!save.isPending}
      footer={<><Button disabled={save.isPending} onClick={editor.dismiss}>{t("取消")}</Button><SaveButton label={t("保存草稿")} form={form} disabled={editorUnavailable} pending={save.isPending} onSave={(values) => editorUnavailable || save.isPending ? Promise.reject(new Error("Operation unavailable")) : save.mutateAsync(values)} /></>}>
      <Form name="membership-plan" form={form} layout="vertical" disabled={editorUnavailable || save.isPending} onFinish={(values) => { if (!editorUnavailable && !save.isPending) save.mutate(values); }}>
        {selected && <p className="muted" style={{ margin: "0 0 var(--space-3)" }}>{selected.name}</p>}
        <SettingsWorkspace sections={[
        { key: "profile", label: locale === "en-US" ? t("详情") : t("基本资料"), content: <div>
        <Form.Item name="name" label={t("方案名称")} rules={[{ required: true, whitespace: true, message: t("请输入方案名称") }]}><Input /></Form.Item>
        <Form.Item name="code" label={t("方案编码")} rules={[{ required: true, whitespace: true, message: t("请输入方案编码") }]}><Input /></Form.Item>
        <Row gutter={16}>
          <Col span={12}><Form.Item name="targetType" label={t("目标会员")} rules={[{ required: true }]}><Select disabled={Boolean(selected) || editorUnavailable || save.isPending} options={[{ value: "personal", label: t("个人会员") }, { value: "corporate", label: t("企业会员") }]} /></Form.Item></Col>
          <Col span={12}><Form.Item name="levelRank" label={t("等级排序")} rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
        </Row>
        <Space wrap>
          <Form.Item name="isDefault" valuePropName="checked"><Checkbox>{t("默认方案")}</Checkbox></Form.Item>
          <Form.Item name="isRecommended" valuePropName="checked"><Checkbox>{t("推荐")}</Checkbox></Form.Item>
          <Form.Item name="appVisible" valuePropName="checked"><Checkbox>{t("APP 可见（仅预留）")}</Checkbox></Form.Item>
        </Space>
        </div> },
        { key: "appearance", label: t("卡面样式"), content: <FormSection title={t("卡面样式")}>
          <Form.Item name="cardFace" extra={t("卡面选择随保存草稿保存在当前浏览器，仅影响展示。") }><MemberCardFacePicker disabled={!canManage} t={t} /></Form.Item>
          <Form.Item noStyle shouldUpdate>{() => {
            const values = form.getFieldsValue();
            const row: CustomerMembershipPlan = {
              id: selected?.id ?? "preview", tenantId: selected?.tenantId ?? "preview", code: values.code || t("方案编码"), name: values.name || t("方案名称"), targetType: values.targetType ?? "personal", status: "draft", createdAt: "", updatedAt: "",
              currentVersion: { id: "preview", planId: selected?.id ?? "preview", version: 1, status: "draft", levelRank: values.levelRank ?? 1, isDefault: values.isDefault ?? false, isRecommended: values.isRecommended ?? false, appVisible: values.appVisible ?? false, benefits: values.benefits ?? [], eligibility: values.eligibility ?? {}, effectiveFrom: values.effectiveFrom, effectiveTo: values.effectiveTo, createdAt: "", updatedAt: "" },
            };
            return <MemberCard row={row} t={t} options={scopeOptions.data} previewFace={values.cardFace ?? "pearl"} />;
          }}</Form.Item>
        </FormSection> },
        { key: "benefits", label: t("权益配置"), content: <>
        <Alert type="info" showIcon title={t("权益配置说明")} description={t("新权益默认适用于租户全部空间。优先预订、报价有效期延长等非金额权益仅保存配置，暂不生效。")} style={{ marginBottom: 16 }} />
        <Form.List name="benefits">
          {(fields, { add, remove }) => <>
            {fields.map((field, index) => <Card key={field.key} size="small" title={`${t("权益")} ${index + 1}`} style={{ marginBottom: 16 }} extra={<Button type="link" danger disabled={!canManage} onClick={() => remove(field.name)}>{t("移除")}</Button>}>
              <Row gutter={16}>
                <Col xs={24} sm={12}><Form.Item name={[field.name, "type"]} label={t("权益类型")} rules={[{ required: true, message: t("请选择权益类型") }]}><Select options={benefitOptions.map((option) => ({ ...option, label: t(option.label) }))} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name={[field.name, "calculation"]} label={t("计算方式")} rules={[{ required: true, message: t("请选择计算方式") }]}><Select options={[{ value: "percentage", label: t("百分比") }, { value: "amount", label: t("金额") }, { value: "quota", label: t("额度") }, { value: "priority", label: t("优先级") }]} /></Form.Item></Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}><Form.Item name={[field.name, "value"]} label={t("权益数值")} rules={[{ required: true, message: t("请输入权益数值") }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                <Col span={12}><Form.Item name={[field.name, "stackable"]} label={t("叠加规则")} valuePropName="checked"><Checkbox>{t("可叠加")}</Checkbox></Form.Item></Col>
              </Row>
              <Form.Item name={[field.name, "scope", "type"]} label={t("适用范围")} rules={[{ required: true, message: t("请选择适用范围") }]}>
                <Select options={scopeTypeOptions.map((option) => ({ ...option, label: t(option.label) }))} onChange={(type) => form.setFieldValue(["benefits", field.name, "scope"], { type })} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {() => {
                  const scope: CustomerMembershipBenefit["scope"] = form.getFieldValue(["benefits", field.name, "scope"]);
                  if (scope?.type === "workspaces") {
                    const available = scopeOptions.data?.workspaces ?? [];
                    const unavailable = (scope.workspaceIds ?? []).filter((id) => !available.some((workspace) => workspace.id === id));
                    return <Form.Item name={[field.name, "scope", "workspaceIds"]} label={t("经营空间")} rules={[{ required: true, type: "array", min: 1, message: t("请至少选择一个经营空间") }]}>
                      <Select mode="multiple" showSearch={{ optionFilterProp: "label" }} loading={scopeOptions.isLoading} placeholder={t("按空间名称选择")} options={[
                        ...available.map((workspace) => ({ value: workspace.id, label: `${workspace.name}（${workspace.code}）` })),
                        ...unavailable.map((id) => ({ value: id, label: scopeOptions.isLoading ? t("空间名称加载中") : t("已不可用空间（可移除）"), disabled: true })),
                      ]} />
                    </Form.Item>;
                  }
                  if (scope?.type === "categories") {
                    const available = scopeOptions.data?.categories ?? [];
                    const unavailable = (scope.categoryCodes ?? []).filter((code) => !available.some((category) => category.code === code));
                    return <Form.Item name={[field.name, "scope", "categoryCodes"]} label={t("租赁品类")} rules={[{ required: true, type: "array", min: 1, message: t("请至少选择一个租赁品类") }]}>
                      <Select mode="multiple" showSearch={{ optionFilterProp: "label" }} loading={scopeOptions.isLoading} placeholder={t("按品类名称选择")} options={[
                        ...available.map((category) => ({ value: category.code, label: category.name })),
                        ...unavailable.map((code) => ({ value: code, label: scopeOptions.isLoading ? t("品类名称加载中") : t("已不可用品类（可移除）"), disabled: true })),
                      ]} />
                    </Form.Item>;
                  }
                  return null;
                }}
              </Form.Item>
            </Card>)}
            <Button disabled={!canManage} onClick={() => add({ type: "rental_discount", calculation: "percentage", value: 0, scope: { type: "tenant" } })}>{t("添加权益")}</Button>
          </>}
        </Form.List>
        </> }
        ]} />
      </Form>
    </Modal>
    <Modal presentation="side" title={`${historyRecord?.name ?? t("会员方案")} · ${t("版本历史")}`} width={900} open={historyDialog.visible} onCancel={historyDialog.dismiss} afterClose={historyDialog.afterClose} destroyOnHidden
      closable={!versionBusy} keyboard={!versionBusy} maskClosable={!versionBusy} footer={<Button disabled={versionBusy} onClick={historyDialog.dismiss}>{t("关闭")}</Button>}>
      <Table rowKey="id" size="small" pagination={false} onRefresh={() => plans.refetch()} refreshing={plans.isFetching} dataSource={historyRecord?.versions ?? []} scroll={{ x: 800 }} columns={[
        { title: t("版本"), dataIndex: "version", render: (value) => `v${value}` },
        { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "published" ? "success" : value === "disabled" ? "error" : "default"}>{value === "published" ? t("已发布") : value === "disabled" ? t("已停用") : t("草稿")}</Tag> },
        { title: t("生效区间"), render: (_, row) => <DataTableText primary={row.effectiveFrom ? new Date(row.effectiveFrom).toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : t("立即")} secondary={row.effectiveTo ? `→ ${new Date(row.effectiveTo).toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}` : t("长期")} /> },
        { title: t("权益适用范围"), render: (_, row) => <MembershipBenefitScopeSummary benefits={row.benefits} options={scopeOptions.data} /> },
        { title: t("说明"), render: (_, row) => row.disableReason ?? (row.restoreReason ? `${t("恢复")}: ${row.restoreReason}` : "—") },
        { title: t("操作"), render: (_, row) => <Space>
          {row.status === "published" && <Button type="link" disabled={!canPublish || versionBusy} onClick={() => openVersionAction({ kind: "disable", planId: row.planId, versionId: row.id, version: row.version, planName: historyRecord?.name ?? t("会员方案") })}>{t("停用此版本")}</Button>}
          {(row.status === "published" || row.status === "disabled") && <Button type="link" aria-label={`${t("基于此版本恢复")} v${row.version}`} disabled={!canPublish || versionBusy} onClick={() => openVersionAction({ kind: "restore", planId: row.planId, versionId: row.id, version: row.version, planName: historyRecord?.name ?? t("会员方案") })}>{t("恢复")}</Button>}
        </Space> },
      ]} />
    </Modal>
    <Modal presentation="dialog" title={versionAction?.kind === "disable" ? `${t("停用此版本")} · ${versionAction.planName} v${versionAction.version}` : `${t("恢复")} ${versionAction?.planName ?? t("会员方案")} v${versionAction?.version ?? ""}`} width={520} open={actionDialog.visible} onCancel={actionDialog.dismiss} afterClose={actionDialog.afterClose} destroyOnHidden
      closable={!versionBusy} keyboard={!versionBusy} maskClosable={!versionBusy}
      footer={<><Button disabled={versionBusy} onClick={actionDialog.dismiss}>{t("取消")}</Button><SaveButton form={actionForm} disabled={!canPublish} pending={versionBusy} label={versionAction?.kind === "disable" ? t("确认停用") : t("生成恢复草稿")} onSave={submitVersionAction} /></>}>
      <Form name="membership-plan-version" form={actionForm} layout="vertical" disabled={!canPublish || versionBusy} onFinish={(values) => { void submitVersionAction(values).catch(() => undefined); }}>
        <Form.Item name="reason" label={versionAction?.kind === "disable" ? t("停用原因") : t("恢复原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} /></Form.Item>
      </Form>
    </Modal>
  </QueryState>;
}
