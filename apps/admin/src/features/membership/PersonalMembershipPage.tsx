import type { CustomerAccountStatus, CustomerMembershipQualificationType, CustomerMembershipStatus, PersonalMembershipMember } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Checkbox, Drawer, Form, Input, Modal, Radio, Select, Space, Table, Tag, Tooltip } from "antd";
import { useState } from "react";
import { customerApi } from "@/api/customer";
import { membershipApi } from "@/api/membership";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const membershipLabel: Record<string, string> = { pending_activation: "待审核", active: "正常", suspended: "已暂停", risk_restricted: "风险受限", exited: "已退出", closed: "已注销" };
const qualificationStatus: Record<string, { text: string; color: string }> = { pending: { text: "待审核", color: "processing" }, approved: { text: "已通过", color: "success" }, rejected: { text: "已拒绝", color: "error" }, expired: { text: "已过期", color: "warning" }, revoked: { text: "已撤销", color: "default" }, not_submitted: { text: "未提交", color: "default" } };

type PersonalForm = { name: string; phone?: string; email?: string; identityNo?: string; temporaryPassword?: string; directApprove?: boolean };
type StatusForm = {
  status: CustomerAccountStatus | CustomerMembershipStatus;
  reason: string;
  levelName?: string;
  acknowledgedManualChecks?: boolean;
};
export function PersonalMembershipPage() {
  const { message } = App.useApp(); const queryClient = useQueryClient(); const hasPermission = useAuthStore((state) => state.hasPermission);
  const canManage = hasPermission("store-rental:member:manage"); const canManageAccount = hasPermission("store-rental:member:account-manage"); const canDirectApprove = hasPermission("store-rental:member:review"); const canRiskAction = hasPermission("store-rental:member:risk-action"); const canClose = hasPermission("store-rental:customer:close");
  const [selected, setSelected] = useState<PersonalMembershipMember>(); const [drawer, setDrawer] = useState<"create" | "edit" | "password" | "qualification" | "types" | "grant">();
  const [statusTarget, setStatusTarget] = useState<PersonalMembershipMember>(); const [statusScope, setStatusScope] = useState<"account" | "workspace">();
  const [form] = Form.useForm<PersonalForm>(); const [qualificationForm] = Form.useForm<{ qualificationType: string; referenceNo?: string; evidenceRef?: string }>(); const [typeForm] = Form.useForm<CustomerMembershipQualificationType>(); const [grantForm] = Form.useForm<{ planVersionId: string; reason?: string }>(); const [statusForm] = Form.useForm<StatusForm>();
  const statusValue = Form.useWatch("status", statusForm); const acknowledgedManualChecks = Form.useWatch("acknowledgedManualChecks", statusForm);
  const members = useQuery({ queryKey: ["membership-personal"], queryFn: membershipApi.personal });
  const types = useQuery({ queryKey: ["membership-qualification-types"], queryFn: membershipApi.qualificationTypes });
  const settings = useQuery({ queryKey: ["membership-registration-settings"], queryFn: membershipApi.registrationSettings });
  const plans = useQuery({ queryKey: ["membership-plans"], queryFn: membershipApi.plans });
  const refresh = async () => queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0] ?? "").startsWith("membership-") });
  const create = useMutation({ mutationFn: (values: PersonalForm) => membershipApi.registerPersonal({ ...values, phone: values.phone!, channel: "admin", directApprove: values.directApprove ? true : undefined }), onSuccess: async () => { await refresh(); setDrawer(undefined); form.resetFields(); message.success("个人会员已创建"); } });
  const edit = useMutation({ mutationFn: (values: PersonalForm) => membershipApi.savePersonal(selected!.customerId, values), onSuccess: async () => { await refresh(); setDrawer(undefined); message.success("会员资料已更新"); } });
  const password = useMutation({ mutationFn: (values: PersonalForm) => membershipApi.setTemporaryPassword(selected!.customerId, { temporaryPassword: values.temporaryPassword! }), onSuccess: () => { setDrawer(undefined); form.resetFields(); message.success("已设置临时密码，会员首次登录后必须修改"); } });
  const submitQualification = useMutation({ mutationFn: (values: { qualificationType: string; referenceNo?: string; evidenceRef?: string }) => membershipApi.submitQualification(selected!.customerId, values), onSuccess: async () => { await refresh(); setDrawer(undefined); qualificationForm.resetFields(); message.success("证件已提交，等待独立审核"); } });
  const saveType = useMutation({ mutationFn: (values: CustomerMembershipQualificationType) => membershipApi.saveQualificationType(values), onSuccess: async () => { await refresh(); typeForm.resetFields(); message.success("证件类型已保存"); } });
  const saveMode = useMutation({ mutationFn: (registrationMode: "automatic" | "manual") => membershipApi.saveRegistrationSettings({ registrationMode }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["membership-registration-settings"] }); message.success("注册审核方式已保存"); } });
  const grant = useMutation({ mutationFn: (values: { planVersionId: string; reason?: string }) => membershipApi.assignPlan({ customerId: selected!.customerId, planVersionId: values.planVersionId, source: "manual", reason: values.reason }), onSuccess: () => { setDrawer(undefined); grantForm.resetFields(); message.success("会员方案已授予；后续报价会以权益快照为准"); } });
  const ensureAccount = useMutation({
    mutationFn: (customerId: string) => customerApi.ensureAccount(customerId),
    onSuccess: async () => { await refresh(); message.success("登录账号已开通，可以继续管理账号状态"); },
    onError: (error: Error) => message.error(error.message || "开通登录账号失败")
  });
  const accountClosability = useQuery({
    queryKey: ["membership-account-closability", statusTarget?.customerId],
    queryFn: () => customerApi.closability(statusTarget!.customerId),
    enabled: Boolean(statusTarget && statusScope === "account" && canClose && statusTarget.account.provisioned && statusValue === "closed")
  });
  const workspaceClosability = useQuery({
    queryKey: ["membership-workspace-closability", statusTarget?.customerId],
    queryFn: () => customerApi.workspaceClosability(statusTarget!.customerId),
    enabled: Boolean(statusTarget && statusScope === "workspace" && canClose && statusValue === "closed")
  });
  const activeClosability = statusScope === "account" ? accountClosability.data : workspaceClosability.data;
  const statusSubmitBlocked = statusValue === "closed" && (!activeClosability || !activeClosability.closable || (activeClosability.manualConfirmations.length > 0 && !acknowledgedManualChecks));
  const changeStatus = useMutation<unknown, Error, StatusForm>({
    mutationFn: (values: StatusForm) => statusScope === "account"
      ? customerApi.changeAccountStatus(statusTarget!.customerId, { status: values.status as CustomerAccountStatus, reason: values.reason, acknowledgedManualChecks: values.acknowledgedManualChecks })
      : customerApi.changeMembershipStatus(statusTarget!.customerId, { status: values.status as CustomerMembershipStatus, reason: values.reason, levelName: values.levelName, acknowledgedManualChecks: values.acknowledgedManualChecks }),
    onSuccess: async () => { await refresh(); setStatusTarget(undefined); setStatusScope(undefined); statusForm.resetFields(); message.success("状态已变更，并已记入状态历史"); },
    onError: (error: Error) => message.error(error.message || "状态变更失败")
  });
  const openCreate = () => { form.resetFields(); setSelected(undefined); setDrawer("create"); };
  const openEdit = (member: PersonalMembershipMember) => { form.setFieldsValue({ name: member.name, phone: "", email: member.email }); setSelected(member); setDrawer("edit"); };
  const openStatus = (member: PersonalMembershipMember, scope: "account" | "workspace") => { setStatusTarget(member); setStatusScope(scope); statusForm.resetFields(); };
  return <QueryState loading={members.isLoading || types.isLoading || settings.isLoading || plans.isLoading} error={members.error ?? types.error ?? settings.error ?? plans.error}>
    <PageHeader title="个人会员管理" description="个人主档、登录账号、空间会员状态与品类证件分别管理；证件只显示服务端脱敏信息。" extra={<Space><Tooltip title="自动通过仅适用于后续 APP 注册和管理员新建；管理员仍可在审核页处理个案"><Radio.Group size="small" value={settings.data?.registrationMode} disabled={!canManage} onChange={(event) => saveMode.mutate(event.target.value)} options={[{ value: "manual", label: "手动审核" }, { value: "automatic", label: "自动通过" }]} /></Tooltip><Button onClick={() => setDrawer("types")} disabled={!canManage}>证件类型</Button><Button type="primary" onClick={openCreate} disabled={!canManage}>新增个人会员</Button></Space>} />
    <Card><Table<PersonalMembershipMember> rowKey="customerId" dataSource={members.data ?? []} pagination={{ pageSize: 20 }} columns={[
      { title: "会员", render: (_, row) => <Space orientation="vertical" size={0}><b>{row.name}</b><span>{row.phoneMasked}</span></Space> }, { title: "账号", render: (_, row) => row.account.provisioned ? <Tag color={row.account.status === "active" ? "success" : "warning"}>{row.account.status === "active" ? "已开通" : "已停用"}</Tag> : <Tag>未开通</Tag> },
      { title: "会员状态", render: (_, row) => <Tag color={row.membershipStatus === "active" ? "success" : "default"}>{membershipLabel[row.membershipStatus]}</Tag> }, { title: "证件", render: (_, row) => row.qualifications.length ? row.qualifications.map((item) => <Tag key={item.id} color={qualificationStatus[item.status]?.color}>{item.qualificationType} · {qualificationStatus[item.status]?.text ?? item.status}</Tag>) : "—" },
      { title: "加入时间", dataIndex: "createdAt", render: (value) => new Date(value).toLocaleDateString() }, { title: "操作", render: (_, row) => <Space wrap>
        <Button type="link" disabled={!canManage} onClick={() => openEdit(row)}>资料</Button>
        {!row.account.provisioned && <Tooltip title={canManage ? undefined : "需要会员管理权限"}><Button type="link" disabled={!canManage} loading={ensureAccount.isPending} onClick={() => ensureAccount.mutate(row.customerId)}>开通账号</Button></Tooltip>}
        <Button type="link" disabled={!canManageAccount} onClick={() => { setSelected(row); form.resetFields(); setDrawer("password"); }}>密码</Button>
        <Button type="link" disabled={(!canManage && !canClose) || !row.account.provisioned || row.account.status === "closed"} onClick={() => openStatus(row, "account")}>账号状态</Button>
        <Button type="link" disabled={!canManage && !canRiskAction && !canClose} onClick={() => openStatus(row, "workspace")}>会员状态</Button>
        <Button type="link" disabled={!canManage} onClick={() => { setSelected(row); qualificationForm.resetFields(); setDrawer("qualification"); }}>提交证件</Button>
        <Button type="link" disabled={!canManage} onClick={() => { setSelected(row); grantForm.resetFields(); setDrawer("grant"); }}>授予方案</Button>
      </Space> }
    ]} /></Card>
    <Drawer title={drawer === "create" ? "新增个人会员" : drawer === "edit" ? "编辑个人会员" : drawer === "password" ? "设置临时密码" : drawer === "qualification" ? "提交品类证件" : drawer === "grant" ? "授予会员方案" : "证件类型配置"} size={520} open={Boolean(drawer)} onClose={() => setDrawer(undefined)} destroyOnHidden>
      {(drawer === "create" || drawer === "edit" || drawer === "password") && <Form layout="vertical" form={form} onFinish={(values) => drawer === "create" ? create.mutate(values) : drawer === "edit" ? edit.mutate(values) : password.mutate(values)}>
        {drawer !== "password" && <><Form.Item label="姓名" name="name" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label="手机号" name="phone" rules={drawer === "create" ? [{ required: true }] : []}><Input placeholder={drawer === "edit" ? "留空则保持现有手机号" : undefined} /></Form.Item><Form.Item label="邮箱" name="email"><Input /></Form.Item><Form.Item label="证件号" name="identityNo"><Input placeholder="仅保存脱敏展示值" /></Form.Item></>}
        {drawer === "create" && canManageAccount && <Form.Item label="临时密码（可选）" name="temporaryPassword" rules={[{ min: 8 }]}><Input.Password /></Form.Item>}
        {drawer === "create" && <Form.Item name="directApprove" valuePropName="checked"><Checkbox disabled={!canDirectApprove}>直接通过</Checkbox></Form.Item>}
        {drawer === "password" && <Form.Item label="新临时密码" name="temporaryPassword" rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item>}
        <Button type="primary" htmlType="submit" loading={create.isPending || edit.isPending || password.isPending}>保存</Button>
      </Form>}
      {drawer === "qualification" && <Form form={qualificationForm} layout="vertical" onFinish={(values) => submitQualification.mutate(values)}><Form.Item label="证件类型" name="qualificationType" rules={[{ required: true }]}><Select options={(types.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.code, label: item.name }))} /></Form.Item><Form.Item label="证件编号" name="referenceNo"><Input /></Form.Item><Form.Item label="附件引用" name="evidenceRef"><Input placeholder="文件服务接入后填文件引用" /></Form.Item><Button type="primary" htmlType="submit" loading={submitQualification.isPending}>提交审核</Button></Form>}
      {drawer === "grant" && <Form form={grantForm} layout="vertical" onFinish={(values) => grant.mutate(values)}><Form.Item label="已发布个人方案" name="planVersionId" rules={[{ required: true }]}><Select options={(plans.data ?? []).flatMap((plan) => plan.targetType === "personal" ? (plan.versions ?? []).filter((version) => version.status === "published").map((version) => ({ value: version.id, label: `${plan.name} · v${version.version}` })) : [])} /></Form.Item><Form.Item label="授予原因" name="reason" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item><Button type="primary" htmlType="submit" loading={grant.isPending}>确认授予</Button></Form>}
      {drawer === "types" && <><Form form={typeForm} layout="vertical" onFinish={(values) => saveType.mutate(values)}><Form.Item label="编码" name="code" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label="名称" name="name" rules={[{ required: true }]}><Input placeholder="例如：驾驶证、操作资格证" /></Form.Item><Form.Item name="requiredForBooking" valuePropName="checked"><Checkbox>下单必需</Checkbox></Form.Item><Button type="primary" htmlType="submit" loading={saveType.isPending}>新增证件类型</Button></Form><Table size="small" rowKey="id" style={{ marginTop: 20 }} dataSource={types.data ?? []} pagination={false} columns={[{ title: "名称", dataIndex: "name" }, { title: "编码", dataIndex: "code" }, { title: "下单要求", render: (_, row) => row.requiredForBooking ? "必需" : "可选" }, { title: "状态", dataIndex: "status" }]} /></>}
    </Drawer>
    <Drawer
      title={statusScope === "account" ? "账号状态 / 注销" : "本空间会员状态"}
      size={520}
      open={Boolean(statusTarget && statusScope)}
      destroyOnHidden
      onClose={() => { setStatusTarget(undefined); setStatusScope(undefined); statusForm.resetFields(); }}
      extra={<Tooltip title={statusSubmitBlocked ? "注销前置检查尚未通过" : undefined}><Button type="primary" loading={changeStatus.isPending} disabled={statusSubmitBlocked} onClick={() => statusForm.submit()}>提交</Button></Tooltip>}
    >
      <Alert
        type={statusScope === "account" ? "warning" : "info"}
        showIcon
        title={statusScope === "account" ? "账号级变更影响全部经营空间" : "空间级变更只影响本经营空间"}
        description={statusScope === "account" ? "停用账号会阻止该客户登录全部经营空间；注销为不可逆终态，不删除主档和历史业务事实。" : "暂停、风险限制、退出与注销只作用于当前经营空间，不影响客户登录和其他空间的会员关系。"}
        style={{ marginBottom: 16 }}
      />
      {statusValue === "closed" && activeClosability && !activeClosability.closable && <Alert type="error" showIcon title="注销被前置检查阻止" description={activeClosability.blockers.map((row) => row.message).join("；")} style={{ marginBottom: 16 }} />}
      {statusValue === "closed" && activeClosability?.manualConfirmations.length ? <Alert type="warning" showIcon title="以下项目需要人工核对" description={<>{activeClosability.manualConfirmations.map((row) => <div key={row.code}>· {row.message}</div>)}<div style={{ marginTop: 6 }}>勾选下方确认后才允许注销。</div></>} style={{ marginBottom: 16 }} /> : null}
      <Form<StatusForm> form={statusForm} layout="vertical" onFinish={(values) => changeStatus.mutate(values)}>
        <Form.Item name="status" label="目标状态" rules={[{ required: true, message: "请选择目标状态" }]}>
          <Select options={(statusScope === "account"
            ? [
              ...(canManage ? [{ value: "active", label: "正常（恢复登录）" }, { value: "suspended", label: "停用（阻止登录全部空间）" }] : []),
              ...(canClose ? [{ value: "closed", label: "注销（不可逆终态）" }] : [])
            ]
            : [
              ...(canManage ? [{ value: "pending_activation", label: "待激活" }, { value: "active", label: "正常" }, { value: "suspended", label: "已暂停" }, { value: "exited", label: "已退出" }] : []),
              ...(canRiskAction ? [{ value: "risk_restricted", label: "风险受限" }] : []),
              ...(canClose ? [{ value: "closed", label: "已注销（本空间）" }] : [])
            ]).filter((option) => option.value !== (statusScope === "account" ? statusTarget?.account.status : statusTarget?.membershipStatus))} />
        </Form.Item>
        {statusScope === "workspace" && <Form.Item name="levelName" label="会员等级（恢复为正常时可调整）"><Input placeholder="留空则保持原等级" /></Form.Item>}
        {statusValue === "closed" && <Form.Item name="acknowledgedManualChecks" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("注销前必须确认人工核对项")) }]}><Checkbox>已人工核对退款、押金/预授权、争议与追偿</Checkbox></Form.Item>}
        <Form.Item name="reason" label="变更原因" rules={[{ required: true, message: "状态变更必须填写原因" }]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="例如：客户逾期未归还，暂停本空间下单权限" /></Form.Item>
      </Form>
    </Drawer>
  </QueryState>;
}
