import type {
  CustomerMembershipBenefit,
  CustomerMembershipPlan,
  CustomerMembershipScopeOptions,
  SaveCustomerMembershipPlanRequest,
} from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Checkbox, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { membershipApi } from "@/api/membership";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

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

/** 列表、版本历史和授予快照共用同一范围说明，不向运营展示内部 ID。 */
export function MembershipBenefitScopeSummary({ benefits, options }: {
  benefits: CustomerMembershipBenefit[];
  options?: CustomerMembershipScopeOptions;
}) {
  if (!benefits.length) return <span>无权益</span>;
  return <Space orientation="vertical" size={0}>
    {benefits.map((benefit, index) => {
      const scope = benefit.scope;
      let label = "租户全部空间";
      if (scope?.type === "workspaces") {
        label = `指定空间：${scope.workspaceIds.map((id) => options?.workspaces.find((workspace) => workspace.id === id)?.name ?? (options ? "已不可用空间" : "空间名称未加载")).join("、") || "未选择空间"}`;
      } else if (scope?.type === "categories") {
        label = `指定品类：${scope.categoryCodes.map((code) => options?.categories.find((category) => category.code === code)?.name ?? (options ? "已不可用品类" : "品类名称未加载")).join("、") || "未选择品类"}`;
      }
      return <span key={index}>{benefitOptions.find((option) => option.value === benefit.type)?.label ?? benefit.type} · {label}</span>;
    })}
  </Space>;
}

export function MembershipPlanPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const hasTenantMembershipPermission = useAuthStore((state) => state.hasTenantMembershipPermission);
  const canManage = hasTenantMembershipPermission("rental-os:member:plan:manage");
  const canPublish = hasTenantMembershipPermission("rental-os:member:plan:publish");
  const canView = hasTenantMembershipPermission("rental-os:member:view") || canManage || canPublish;
  const [selected, setSelected] = useState<CustomerMembershipPlan>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [historyPlan, setHistoryPlan] = useState<CustomerMembershipPlan>();
  const [versionAction, setVersionAction] = useState<VersionAction>();
  const [form] = Form.useForm<SaveCustomerMembershipPlanRequest>();
  const [actionForm] = Form.useForm<{ reason: string }>();
  const plans = useQuery({ queryKey: ["membership-plans"], queryFn: membershipApi.plans, enabled: canView });
  const scopeOptions = useQuery({ queryKey: ["membership-benefit-scope-options"], queryFn: membershipApi.benefitScopeOptions, enabled: canView });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["membership-plans"] });
  const save = useMutation({
    mutationFn: (values: SaveCustomerMembershipPlanRequest) => membershipApi.savePlan({ ...values, id: selected?.id }),
    onSuccess: async () => {
      await refresh();
      setSelected(undefined);
      setEditorOpen(false);
      form.resetFields();
      message.success("会员方案草稿已保存");
    },
  });
  const publish = useMutation({
    mutationFn: (values: { planId: string; versionId: string }) => membershipApi.publishPlan(values.planId, values.versionId),
    onSuccess: async () => { await refresh(); message.success("方案版本已发布，后续编辑会生成新草稿"); },
  });
  const disable = useMutation({
    mutationFn: (values: { planId: string; versionId: string; reason: string }) => membershipApi.disablePlan(values.planId, values.versionId, values.reason),
    onSuccess: async () => {
      await refresh();
      setHistoryPlan(undefined);
      setVersionAction(undefined);
      actionForm.resetFields();
      message.success("方案版本已停用，已授予会员的权益快照不受影响");
    },
  });
  const restore = useMutation({
    mutationFn: (values: { planId: string; versionId: string; reason: string }) => membershipApi.restorePlan(values.planId, values.versionId, values.reason),
    onSuccess: async () => {
      await refresh();
      setHistoryPlan(undefined);
      setVersionAction(undefined);
      actionForm.resetFields();
      message.success("已基于历史版本生成新的草稿");
    },
  });
  const open = (plan?: CustomerMembershipPlan) => {
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
      benefits: (version?.benefits ?? []).map((benefit) => ({ ...benefit, scope: benefit.scope ?? { type: "tenant" } })),
    } : { targetType: "personal", levelRank: 1, benefits: [] });
    setEditorOpen(true);
  };
  const openVersionAction = (action: VersionAction) => { setVersionAction(action); actionForm.resetFields(); };
  const submitVersionAction = (values: { reason: string }) => {
    if (!versionAction || !canPublish) return;
    const input = { planId: versionAction.planId, versionId: versionAction.versionId, reason: values.reason };
    if (versionAction.kind === "disable") disable.mutate(input);
    else restore.mutate(input);
  };

  if (!canView) return <Alert type="warning" showIcon title="无权查看租户统一会员方案" description="需要租户级会员查看、方案管理或方案发布权限，且数据范围为全部。" />;

  return <QueryState loading={plans.isLoading} error={plans.error}>
    <PageHeader title="会员方案" description="租户统一会员方案，每条权益可单独指定适用范围。" extra={<Button type="primary" disabled={!canManage} onClick={() => open()}>新增方案</Button>} />
    <Alert type="info" showIcon title="租户统一会员" description="会员方案在租户内共享，切换经营空间仍显示同一份方案。每条权益可适用于全部空间、指定空间或指定品类；已发布版本不可回写，已授予的权益以快照为准。会员暂停、退出或注销影响租户全部空间。" style={{ marginBottom: 16 }} />
    {scopeOptions.error && <Alert type="error" showIcon title="适用范围名称加载失败" description={scopeOptions.error.message} style={{ marginBottom: 16 }} />}
    <Card>
      <Table<CustomerMembershipPlan> rowKey="id" dataSource={plans.data ?? []} pagination={{ pageSize: 20 }} scroll={{ x: 1100 }} columns={[
        { title: "方案", render: (_, row) => <Space orientation="vertical" size={0}><b>{row.name}</b><span>{row.code}</span></Space> },
        { title: "适用会员", dataIndex: "targetType", render: (value) => value === "corporate" ? "企业会员" : "个人会员" },
        { title: "当前版本", render: (_, row) => row.currentVersion ? `v${row.currentVersion.version}` : "未建版本" },
        { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "active" ? "success" : value === "disabled" ? "error" : "default"}>{value === "active" ? "已启用" : value === "disabled" ? "已停用" : "草稿"}</Tag> },
        { title: "权益适用范围", render: (_, row) => <MembershipBenefitScopeSummary benefits={row.currentVersion?.benefits ?? []} options={scopeOptions.data} /> },
        { title: "版本", render: (_, row) => <Button type="link" disabled={!canView} onClick={() => setHistoryPlan(row)}>查看 {row.versions?.length ?? 0} 个版本</Button> },
        { title: "操作", render: (_, row) => <Space>
          <Button type="link" disabled={!canManage} onClick={() => open(row)}>编辑草稿</Button>
          {row.currentVersion?.status === "draft" && <Button type="link" disabled={!canPublish} loading={publish.isPending} onClick={() => publish.mutate({ planId: row.id, versionId: row.currentVersion!.id })}>发布 v{row.currentVersion.version}</Button>}
        </Space> },
      ]} />
    </Card>
    <Drawer title={selected ? `编辑方案：${selected.name}` : "新增会员方案"} size={640} open={editorOpen} onClose={() => { setSelected(undefined); setEditorOpen(false); form.resetFields(); }} destroyOnHidden>
      <Form form={form} layout="vertical" disabled={!canManage} onFinish={(values) => canManage && save.mutate(values)}>
        <Form.Item name="code" label="方案编码" rules={[{ required: true, whitespace: true, message: "请输入方案编码" }]}><Input /></Form.Item>
        <Form.Item name="name" label="方案名称" rules={[{ required: true, whitespace: true, message: "请输入方案名称" }]}><Input /></Form.Item>
        <Row gutter={16}>
          <Col span={12}><Form.Item name="targetType" label="目标会员" rules={[{ required: true }]}><Select disabled={Boolean(selected)} options={[{ value: "personal", label: "个人会员" }, { value: "corporate", label: "企业会员" }]} /></Form.Item></Col>
          <Col span={12}><Form.Item name="levelRank" label="等级排序" rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
        </Row>
        <Space wrap>
          <Form.Item name="isDefault" valuePropName="checked"><Checkbox>默认方案</Checkbox></Form.Item>
          <Form.Item name="isRecommended" valuePropName="checked"><Checkbox>推荐</Checkbox></Form.Item>
          <Form.Item name="appVisible" valuePropName="checked"><Checkbox>APP 可见（仅预留）</Checkbox></Form.Item>
        </Space>
        <Alert type="info" showIcon title="权益配置说明" description="新权益默认适用于租户全部空间。优先预订、报价有效期延长等非金额权益仅保存配置，目前尚未生效；本次不改变既有权益计算规则。" style={{ marginBottom: 16 }} />
        <Form.List name="benefits">
          {(fields, { add, remove }) => <>
            {fields.map((field, index) => <Card key={field.key} size="small" title={`权益 ${index + 1}`} style={{ marginBottom: 16 }} extra={<Button type="link" danger disabled={!canManage} onClick={() => remove(field.name)}>移除</Button>}>
              <Row gutter={16}>
                <Col xs={24} sm={12}><Form.Item name={[field.name, "type"]} label="权益类型" rules={[{ required: true, message: "请选择权益类型" }]}><Select options={benefitOptions} /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name={[field.name, "calculation"]} label="计算方式" rules={[{ required: true, message: "请选择计算方式" }]}><Select options={[{ value: "percentage", label: "百分比" }, { value: "amount", label: "金额" }, { value: "quota", label: "额度" }, { value: "priority", label: "优先级" }]} /></Form.Item></Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}><Form.Item name={[field.name, "value"]} label="权益数值" rules={[{ required: true, message: "请输入权益数值" }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                <Col span={12}><Form.Item name={[field.name, "stackable"]} label="叠加规则" valuePropName="checked"><Checkbox>可叠加</Checkbox></Form.Item></Col>
              </Row>
              <Form.Item name={[field.name, "scope", "type"]} label="适用范围" rules={[{ required: true, message: "请选择适用范围" }]}>
                <Select options={scopeTypeOptions} onChange={(type) => form.setFieldValue(["benefits", field.name, "scope"], { type })} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {() => {
                  const scope: CustomerMembershipBenefit["scope"] = form.getFieldValue(["benefits", field.name, "scope"]);
                  if (scope?.type === "workspaces") {
                    const available = scopeOptions.data?.workspaces ?? [];
                    const unavailable = (scope.workspaceIds ?? []).filter((id) => !available.some((workspace) => workspace.id === id));
                    return <Form.Item name={[field.name, "scope", "workspaceIds"]} label="经营空间" rules={[{ required: true, type: "array", min: 1, message: "请至少选择一个经营空间" }]}>
                      <Select mode="multiple" showSearch optionFilterProp="label" loading={scopeOptions.isLoading} placeholder="按空间名称选择" options={[
                        ...available.map((workspace) => ({ value: workspace.id, label: `${workspace.name}（${workspace.code}）` })),
                        ...unavailable.map((id) => ({ value: id, label: scopeOptions.isLoading ? "空间名称加载中" : "已不可用空间（可移除）", disabled: true })),
                      ]} />
                    </Form.Item>;
                  }
                  if (scope?.type === "categories") {
                    const available = scopeOptions.data?.categories ?? [];
                    const unavailable = (scope.categoryCodes ?? []).filter((code) => !available.some((category) => category.code === code));
                    return <Form.Item name={[field.name, "scope", "categoryCodes"]} label="租赁品类" rules={[{ required: true, type: "array", min: 1, message: "请至少选择一个租赁品类" }]}>
                      <Select mode="multiple" showSearch optionFilterProp="label" loading={scopeOptions.isLoading} placeholder="按品类名称选择" options={[
                        ...available.map((category) => ({ value: category.code, label: category.name })),
                        ...unavailable.map((code) => ({ value: code, label: scopeOptions.isLoading ? "品类名称加载中" : "已不可用品类（可移除）", disabled: true })),
                      ]} />
                    </Form.Item>;
                  }
                  return null;
                }}
              </Form.Item>
            </Card>)}
            <Button disabled={!canManage} onClick={() => add({ type: "rental_discount", calculation: "percentage", value: 0, scope: { type: "tenant" } })}>添加权益</Button>
          </>}
        </Form.List>
        <Button type="primary" htmlType="submit" disabled={!canManage || scopeOptions.isError} loading={save.isPending} style={{ marginTop: 20 }}>保存草稿</Button>
      </Form>
    </Drawer>
    <Drawer title={`${historyPlan?.name ?? "会员方案"} · 版本历史`} size={900} open={Boolean(historyPlan)} onClose={() => setHistoryPlan(undefined)} destroyOnHidden>
      <Table rowKey="id" size="small" pagination={false} dataSource={historyPlan?.versions ?? []} scroll={{ x: 800 }} columns={[
        { title: "版本", dataIndex: "version", render: (value) => `v${value}` },
        { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "published" ? "success" : value === "disabled" ? "error" : "default"}>{value === "published" ? "已发布" : value === "disabled" ? "已停用" : "草稿"}</Tag> },
        { title: "生效区间", render: (_, row) => `${row.effectiveFrom ? row.effectiveFrom.slice(0, 16).replace("T", " ") : "立即"} ~ ${row.effectiveTo ? row.effectiveTo.slice(0, 16).replace("T", " ") : "长期"}` },
        { title: "权益适用范围", render: (_, row) => <MembershipBenefitScopeSummary benefits={row.benefits} options={scopeOptions.data} /> },
        { title: "说明", render: (_, row) => row.disableReason ?? (row.restoreReason ? `恢复：${row.restoreReason}` : "—") },
        { title: "操作", render: (_, row) => <Space>
          {row.status === "published" && <Button type="link" disabled={!canPublish} onClick={() => openVersionAction({ kind: "disable", planId: row.planId, versionId: row.id, version: row.version, planName: historyPlan?.name ?? "会员方案" })}>停用</Button>}
          {(row.status === "published" || row.status === "disabled") && <Button type="link" disabled={!canPublish} onClick={() => openVersionAction({ kind: "restore", planId: row.planId, versionId: row.id, version: row.version, planName: historyPlan?.name ?? "会员方案" })}>基于此版本恢复</Button>}
        </Space> },
      ]} />
    </Drawer>
    <Drawer title={versionAction?.kind === "disable" ? `停用 ${versionAction.planName} v${versionAction.version}` : `恢复 ${versionAction?.planName ?? "会员方案"} v${versionAction?.version ?? ""}`} size={520} open={Boolean(versionAction)} onClose={() => { setVersionAction(undefined); actionForm.resetFields(); }} destroyOnHidden>
      <Form form={actionForm} layout="vertical" disabled={!canPublish} onFinish={submitVersionAction}>
        <Form.Item name="reason" label={versionAction?.kind === "disable" ? "停用原因" : "恢复原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} /></Form.Item>
        <Button type="primary" htmlType="submit" disabled={!canPublish} loading={disable.isPending || restore.isPending}>{versionAction?.kind === "disable" ? "确认停用" : "生成恢复草稿"}</Button>
      </Form>
    </Drawer>
  </QueryState>;
}
