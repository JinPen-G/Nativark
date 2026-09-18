import type { CorporateMembershipMember, CustomerCorporateMembership, CustomerMembershipPlanAssignment, SaveCorporateMembershipRequest, SaveCustomerCorporateMembershipRequest } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Drawer, Form, Input, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { membershipApi } from "@/api/membership";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { MembershipBenefitScopeSummary } from "./MembershipPlanPage";

const relationMeta: Record<string, { text: string; color: string }> = { active: { text: "有效", color: "success" }, suspended: { text: "暂停", color: "warning" }, exited: { text: "已退出", color: "default" } };
const membershipLabel: Record<string, string> = { pending_activation: "待审核", active: "正常", suspended: "已暂停", risk_restricted: "风险受限", exited: "已退出", closed: "已注销" };
type GrantForm = { planVersionId: string; source: "manual" | "corporate_contract"; effectiveFrom?: string; effectiveTo?: string; reason?: string };

export function CorporateMembershipPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const hasTenantMembershipPermission = useAuthStore((state) => state.hasTenantMembershipPermission);
  const canManage = hasTenantMembershipPermission("rental-os:corporate:manage");
  const canEmployeeManage = hasTenantMembershipPermission("rental-os:corporate:employee-manage");
  const canView = hasTenantMembershipPermission("rental-os:corporate:view") || canManage || canEmployeeManage;
  const canGrant = hasTenantMembershipPermission("rental-os:member:plan:manage");
  const [selected, setSelected] = useState<CorporateMembershipMember>();
  const [drawer, setDrawer] = useState<"corporate" | "employees" | "grant">();
  const [editTarget, setEditTarget] = useState<CorporateMembershipMember>();
  const [revokeTarget, setRevokeTarget] = useState<CustomerMembershipPlanAssignment>();
  const [corporateForm] = Form.useForm<SaveCorporateMembershipRequest>();
  const [employeeForm] = Form.useForm<SaveCustomerCorporateMembershipRequest>();
  const [grantForm] = Form.useForm<GrantForm>();
  const [revokeForm] = Form.useForm<{ reason: string }>();
  const selectedPlanVersionId = Form.useWatch("planVersionId", grantForm);
  const corporates = useQuery({ queryKey: ["membership-corporate"], queryFn: membershipApi.corporate, enabled: canView });
  const plans = useQuery({ queryKey: ["membership-plans"], queryFn: membershipApi.plans, enabled: canGrant && drawer === "grant" });
  const scopeOptions = useQuery({ queryKey: ["membership-benefit-scope-options"], queryFn: membershipApi.benefitScopeOptions, enabled: canGrant && drawer === "grant" });
  const selectedPlanVersion = plans.data?.flatMap((plan) => plan.targetType === "corporate" ? plan.versions ?? [] : []).find((version) => version.id === selectedPlanVersionId);
  const personal = useQuery({ queryKey: ["membership-personal-options"], queryFn: membershipApi.personalOptions, enabled: canEmployeeManage && drawer === "employees" });
  const employees = useQuery({ queryKey: ["membership-corporate-employees", selected?.customerId], queryFn: () => membershipApi.corporateEmployees(selected!.customerId), enabled: canView && Boolean(selected) && drawer === "employees" });
  const assignments = useQuery({ queryKey: ["membership-plan-assignments", selected?.customerId], queryFn: () => membershipApi.planAssignments(selected!.customerId), enabled: canGrant && Boolean(selected) && drawer === "grant" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["membership-corporate"] });
  const saveCorporate = useMutation({
    mutationFn: (values: SaveCorporateMembershipRequest) => membershipApi.saveCorporate({ ...values, id: editTarget?.customerId }),
    onSuccess: async () => { await refresh(); setDrawer(undefined); corporateForm.resetFields(); message.success("企业会员已保存"); },
  });
  const saveEmployee = useMutation({
    mutationFn: (values: SaveCustomerCorporateMembershipRequest) => membershipApi.saveCorporateEmployee(selected!.customerId, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["membership-corporate-employees", selected?.customerId] });
      await refresh();
      employeeForm.resetFields();
      message.success("企业成员关系已保存；其企业权益只会在有效员工关系下生效");
    },
  });
  const grant = useMutation({
    mutationFn: (values: GrantForm) => membershipApi.assignPlan({ customerId: selected!.customerId, planVersionId: values.planVersionId, source: values.source, effectiveFrom: values.effectiveFrom, effectiveTo: values.effectiveTo, reason: values.reason }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["membership-plan-assignments", selected?.customerId] });
      setDrawer(undefined);
      grantForm.resetFields();
      message.success("企业会员方案已授予；仅有效员工在订单中显式选择该企业时可使用适用范围内的权益");
    },
  });
  const revoke = useMutation({
    mutationFn: (values: { assignmentId: string; reason: string }) => membershipApi.revokePlanAssignment(values.assignmentId, values.reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["membership-plan-assignments", selected?.customerId] });
      setRevokeTarget(undefined);
      revokeForm.resetFields();
      message.success("企业会员方案授予已撤销；历史快照保留");
    },
  });
  const openCorporate = (row?: CorporateMembershipMember) => {
    setEditTarget(row);
    corporateForm.resetFields();
    if (row) corporateForm.setFieldsValue({ name: row.name, corporateName: row.corporateName ?? row.name });
    setDrawer("corporate");
  };
  const openEmployees = (row: CorporateMembershipMember) => { setSelected(row); employeeForm.resetFields(); setDrawer("employees"); };

  if (!canView) return <Alert type="warning" showIcon title="无权查看租户统一企业会员" description="需要租户级企业会员查看、管理或员工管理权限，且数据范围为全部。" />;

  return <QueryState loading={corporates.isLoading} error={corporates.error}>
    <PageHeader title="企业会员管理" description="租户统一会员：企业主档、管理员与员工关系共享。" extra={<Button type="primary" disabled={!canManage} onClick={() => openCorporate()}>新增企业会员</Button>} />
    <Alert type="info" showIcon title="租户统一会员" description="企业主档、管理员及员工关系在租户内共享，切换经营空间仍显示同一份名单。管理员和员工必须是租户内的有效个人会员；会员暂停、退出或注销影响租户全部空间。企业权益还需符合每条权益的适用范围。" style={{ marginBottom: 16 }} />
    <Card>
      <Table<CorporateMembershipMember> rowKey="customerId" dataSource={corporates.data ?? []} pagination={{ pageSize: 20 }} columns={[
        { title: "企业", render: (_, row) => <Space orientation="vertical" size={0}><b>{row.corporateName ?? row.name}</b><span>{row.phoneMasked}</span></Space> },
        { title: "会员状态", render: (_, row) => <Tag color={row.membershipStatus === "active" ? "success" : "default"}>{membershipLabel[row.membershipStatus] ?? row.membershipStatus}</Tag> },
        { title: "企业管理员", dataIndex: "adminCount" },
        { title: "员工数", dataIndex: "employeeCount" },
        { title: "创建时间", dataIndex: "createdAt", render: (value) => new Date(value).toLocaleDateString() },
        { title: "操作", render: (_, row) => <Space wrap>
          <Button type="link" disabled={!canManage} onClick={() => openCorporate(row)}>企业资料</Button>
          <Button type="link" disabled={!canView} onClick={() => openEmployees(row)}>管理员与员工</Button>
          <Button type="link" disabled={!canGrant} onClick={() => { setSelected(row); grantForm.resetFields(); grantForm.setFieldsValue({ source: "manual" }); setDrawer("grant"); }}>授予方案</Button>
        </Space> },
      ]} />
    </Card>
    <Drawer title={drawer === "employees" ? `${selected?.corporateName ?? selected?.name ?? "企业"} · 管理员与员工` : drawer === "grant" ? "授予企业会员方案" : editTarget ? "编辑企业会员" : "新增企业会员"} size={620} open={Boolean(drawer)} onClose={() => setDrawer(undefined)} destroyOnHidden>
      {drawer === "corporate" && <Form form={corporateForm} layout="vertical" disabled={!canManage} onFinish={(values) => canManage && saveCorporate.mutate(values)}>
        <Form.Item name="corporateName" label="企业名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="name" label="联系人/简称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="phone" label="联系电话" rules={editTarget ? [] : [{ required: true }]}><Input placeholder={editTarget ? "留空则保持现有联系电话" : undefined} /></Form.Item>
        <Form.Item name="email" label="邮箱"><Input /></Form.Item>
        <Form.Item name="corporateTaxNo" label="统一社会信用代码"><Input /></Form.Item>
        <Button type="primary" htmlType="submit" disabled={!canManage} loading={saveCorporate.isPending}>保存</Button>
      </Form>}
      {drawer === "employees" && <QueryState loading={employees.isLoading || personal.isLoading} error={employees.error ?? personal.error}>
        <Alert type="info" showIcon title="企业成员关系在租户内共享" description="仅可选择租户内的有效个人会员。暂停或退出员工关系后，该个人在租户全部空间均不可再使用此企业身份下单，不会注销其个人会员。" style={{ marginBottom: 16 }} />
        {canEmployeeManage && <Form form={employeeForm} layout="vertical" disabled={!canEmployeeManage} onFinish={(values) => canEmployeeManage && saveEmployee.mutate(values)}>
          <Form.Item name="personalCustomerId" label="租户有效个人会员" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" loading={personal.isLoading} options={(personal.data ?? []).filter((item) => item.membershipStatus === "active").map((item) => ({ value: item.customerId, label: `${item.name} · ${item.phoneMasked}` }))} /></Form.Item>
          <Space wrap>
            <Form.Item name="role" label="企业角色" initialValue="employee" rules={[{ required: true }]}><Select style={{ width: 150 }} options={[{ value: "admin", label: "企业管理员" }, { value: "employee", label: "企业员工" }]} /></Form.Item>
            <Form.Item name="department" label="部门"><Input /></Form.Item>
            <Form.Item name="employeeNo" label="员工号"><Input /></Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="effectiveFrom" label="生效时间" extra="留空为现在"><Input placeholder="YYYY-MM-DD HH:mm" /></Form.Item>
            <Form.Item name="effectiveTo" label="失效时间" extra="留空为长期有效"><Input placeholder="YYYY-MM-DD HH:mm" /></Form.Item>
          </Space>
          <Form.Item name="status" label="关系状态" initialValue="active"><Select options={Object.entries(relationMeta).map(([value, meta]) => ({ value, label: meta.text }))} /></Form.Item>
          <Form.Item name="reason" label="说明"><Input.TextArea rows={2} /></Form.Item>
          <Button type="primary" htmlType="submit" disabled={!canEmployeeManage} loading={saveEmployee.isPending}>添加/更新成员</Button>
        </Form>}
        <Table<CustomerCorporateMembership> style={{ marginTop: 24 }} rowKey="id" size="small" loading={employees.isLoading} dataSource={employees.data ?? []} pagination={false} columns={[
          { title: "个人会员", dataIndex: "personalCustomerName" },
          { title: "角色", dataIndex: "role", render: (value) => value === "admin" ? "企业管理员" : "企业员工" },
          { title: "部门", dataIndex: "department", render: (value) => value ?? "—" },
          { title: "有效期", render: (_, row) => `${row.effectiveFrom.slice(0, 16).replace("T", " ")} ~ ${row.effectiveTo?.slice(0, 16).replace("T", " ") ?? "长期"}` },
          { title: "状态", render: (_, row) => <Tag color={relationMeta[row.status].color}>{relationMeta[row.status].text}</Tag> },
        ]} />
      </QueryState>}
      {drawer === "grant" && <QueryState loading={plans.isLoading || assignments.isLoading || scopeOptions.isLoading} error={plans.error ?? assignments.error ?? scopeOptions.error}>
        <Form form={grantForm} layout="vertical" disabled={!canGrant} onFinish={(values) => canGrant && grant.mutate(values)}>
          <Form.Item name="planVersionId" label="已发布企业方案" rules={[{ required: true }]}><Select options={(plans.data ?? []).flatMap((plan) => plan.targetType === "corporate" ? (plan.versions ?? []).filter((version) => version.status === "published").map((version) => ({ value: version.id, label: `${plan.name} · v${version.version}` })) : [])} /></Form.Item>
          {selectedPlanVersion && <Alert type="info" showIcon title="本次授予的权益适用范围" description={<MembershipBenefitScopeSummary benefits={selectedPlanVersion.benefits} options={scopeOptions.data} />} style={{ marginBottom: 16 }} />}
          <Form.Item name="source" label="授予来源" rules={[{ required: true }]}><Select options={[{ value: "manual", label: "后台人工授予" }, { value: "corporate_contract", label: "企业合同授予" }]} /></Form.Item>
          <Form.Item name="effectiveFrom" label="生效时间" extra="留空为提交时生效"><Input placeholder="YYYY-MM-DD HH:mm" /></Form.Item>
          <Form.Item name="effectiveTo" label="失效时间" extra="留空为长期有效"><Input placeholder="YYYY-MM-DD HH:mm" /></Form.Item>
          <Form.Item name="reason" label="授予原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={2} /></Form.Item>
          <Button type="primary" htmlType="submit" disabled={!canGrant} loading={grant.isPending}>确认授予</Button>
        </Form>
        <Card size="small" title="当前方案授予记录" style={{ marginTop: 20 }}>
          <Table<CustomerMembershipPlanAssignment> rowKey="id" size="small" loading={assignments.isLoading} dataSource={assignments.data ?? []} pagination={false} scroll={{ x: 750 }} columns={[
            { title: "方案", render: (_, row) => row.snapshot.planName },
            { title: "权益适用范围", render: (_, row) => <MembershipBenefitScopeSummary benefits={row.snapshot.benefits} options={scopeOptions.data} /> },
            { title: "有效期", render: (_, row) => `${row.effectiveFrom.slice(0, 16).replace("T", " ")} ~ ${row.effectiveTo?.slice(0, 16).replace("T", " ") ?? "长期"}` },
            { title: "状态", render: (_, row) => <Tag color={row.status === "active" ? "success" : row.status === "expired" ? "warning" : "default"}>{row.status === "active" ? "有效" : row.status === "expired" ? "已过期" : "已撤销"}</Tag> },
            { title: "操作", render: (_, row) => row.status === "active" && <Button type="link" disabled={!canGrant} onClick={() => { setRevokeTarget(row); revokeForm.resetFields(); }}>撤销</Button> },
          ]} />
        </Card>
      </QueryState>}
    </Drawer>
    <Drawer title={`撤销会员方案：${revokeTarget?.snapshot.planName ?? ""}`} size={520} open={Boolean(revokeTarget)} onClose={() => { setRevokeTarget(undefined); revokeForm.resetFields(); }} destroyOnHidden>
      <Form form={revokeForm} layout="vertical" disabled={!canGrant} onFinish={(values) => canGrant && revokeTarget && revoke.mutate({ assignmentId: revokeTarget.id, reason: values.reason })}>
        <Form.Item name="reason" label="撤销原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} /></Form.Item>
        <Button type="primary" danger htmlType="submit" disabled={!canGrant} loading={revoke.isPending}>确认撤销</Button>
      </Form>
    </Drawer>
  </QueryState>;
}
