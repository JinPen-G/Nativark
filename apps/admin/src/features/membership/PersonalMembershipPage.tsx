import { CustomerPreview } from "@/features/membership/CustomerPreview";
import { ListFilters, useListFilter } from "@/components/ui";
import { ListSection, SaveButton } from "@/components/ui";
import type { CustomerAccountStatus, CustomerMembershipPlanAssignment, CustomerMembershipStatus, CustomerQualificationRevision, PersonalMembershipMember, SubmitCustomerQualificationRequest } from "@rental-os/shared";
import { CUSTOMER_GENDERS, CUSTOMER_GENDER_LABELS, CUSTOMER_SOURCE_CHANNELS, CUSTOMER_SOURCE_CHANNEL_LABELS } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Space, Tag } from "antd";
import { App, Radio } from "@/components/ui";
import { Checkbox } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, DataTableRowActions, Drawer, Select, Tooltip } from "@/components/ui";
import { BadgeCheck, FileCheck, KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { customerApi } from "@/api/customer";
import { personalImport } from "@/features/listCapabilities";
import { membershipApi } from "@/api/membership";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { CustomerProfileDetails } from "./CustomerProfileDetails";
import { QualificationTypesEditor } from "./QualificationTypesPage";
import { MembershipBenefitScopeSummary } from "./MembershipPlanPage";

const membershipLabel: Record<string, string> = { pending_activation: "待审核", active: "正常", suspended: "已暂停", risk_restricted: "风险受限", exited: "已退出", closed: "已注销" };
const qualificationStatus: Record<string, { text: string; color: string }> = { pending: { text: "待审核", color: "processing" }, approved: { text: "已通过", color: "success" }, rejected: { text: "已拒绝", color: "error" }, expired: { text: "已过期", color: "warning" }, revoked: { text: "已撤销", color: "default" }, not_submitted: { text: "未提交", color: "default" } };
const reviewStatusLabel: Record<string, string> = { pending: "待审核", approved: "已通过", rejected: "已拒绝", supplement_required: "待补件", cancelled: "已取消" };
const statusMetaColor = (status: string) => ({ pending: "processing", approved: "success", rejected: "error", supplement_required: "warning", cancelled: "default" }[status] ?? "default");

type PersonalForm = { name: string; phone?: string; email?: string; identityNo?: string; gender?: string; birthday?: string; sourceChannel?: string; region?: string; temporaryPassword?: string; directApprove?: boolean };
type StatusForm = {
  status: CustomerAccountStatus | CustomerMembershipStatus;
  reason: string;
  levelName?: string;
  acknowledgedManualChecks?: boolean;
};
export function PersonalMembershipPage() {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { customerId } = useParams<{ customerId: string }>();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const hasTenantMembershipPermission = useAuthStore((state) => state.hasTenantMembershipPermission);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const canManage = hasTenantMembershipPermission("rental-os:member:manage");
  const canView = hasTenantMembershipPermission("rental-os:member:view") || canManage;
  const canManageAccount = hasTenantMembershipPermission("rental-os:member:account-manage");
  const canDirectApprove = hasTenantMembershipPermission("rental-os:member:review");
  const canRiskAction = hasTenantMembershipPermission("rental-os:member:risk-action");
  const canClose = hasTenantMembershipPermission("rental-os:customer:close");
  const canReveal = hasPermission("rental-os:customer:reveal-sensitive");
  const canGrant = hasTenantMembershipPermission("rental-os:member:plan:manage");
  // 证件类型是当前经营空间的业务配置，不可由租户会员管理权限代替空间配置权。
  const canManageTypes = Boolean(currentWorkspaceId) && (hasPermission("rental-os:qualification-type:manage") || hasPermission("rental-os:member:manage"));
  const [selected, setSelected] = useState<PersonalMembershipMember>(); const [drawer, setDrawer] = useState<"create" | "edit" | "password" | "qualification" | "types" | "grant">(); const [revokeTarget, setRevokeTarget] = useState<CustomerMembershipPlanAssignment>();
  const [statusTarget, setStatusTarget] = useState<PersonalMembershipMember>(); const [statusScope, setStatusScope] = useState<"account" | "membership">();
  const [form] = Form.useForm<PersonalForm>(); const [qualificationForm] = Form.useForm<SubmitCustomerQualificationRequest>(); const [grantForm] = Form.useForm<{ planVersionId: string; effectiveFrom?: string; effectiveTo?: string; reason?: string }>(); const [revokeForm] = Form.useForm<{ reason: string }>(); const [statusForm] = Form.useForm<StatusForm>();
  const statusValue = Form.useWatch("status", statusForm); const acknowledgedManualChecks = Form.useWatch("acknowledgedManualChecks", statusForm);
  const selectedPlanVersionId = Form.useWatch("planVersionId", grantForm);
  const members = useQuery({ queryKey: ["membership-personal"], queryFn: membershipApi.personal, enabled: canView });
  const detailMember = members.data?.find(member => member.customerId === customerId);
  const memberFilter = useListFilter(members.data, { fields: row => [row.name, row.email, row.phoneMasked], status: row => row.membershipStatus });
  const types = useQuery({ queryKey: ["membership-qualification-options", currentWorkspaceId], queryFn: membershipApi.qualificationOptions, enabled: Boolean(currentWorkspaceId) && drawer === "qualification" && canManage });
  const settings = useQuery({ queryKey: ["membership-registration-settings"], queryFn: membershipApi.registrationSettings, enabled: canView });
  const plans = useQuery({ queryKey: ["membership-plans"], queryFn: membershipApi.plans, enabled: canGrant && drawer === "grant" });
  const scopeOptions = useQuery({ queryKey: ["membership-benefit-scope-options"], queryFn: membershipApi.benefitScopeOptions, enabled: canGrant && drawer === "grant" });
  const selectedPlanVersion = plans.data?.flatMap((plan) => plan.targetType === "personal" ? plan.versions ?? [] : []).find((version) => version.id === selectedPlanVersionId);
  const assignments = useQuery({ queryKey: ["membership-plan-assignments", selected?.customerId], queryFn: () => membershipApi.planAssignments(selected!.customerId), enabled: canGrant && Boolean(selected) && drawer === "grant" });
  const qualificationHistory = useQuery({ queryKey: ["membership-qualification-history", selected?.customerId], queryFn: () => membershipApi.qualificationHistory(selected!.customerId), enabled: canView && Boolean(selected) && drawer === "qualification" });
  const refresh = async () => queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0] ?? "").startsWith("membership-") });
  const create = useMutation({ mutationFn: (values: PersonalForm) => membershipApi.registerPersonal({ name: values.name, phone: values.phone!, email: values.email, identityNo: values.identityNo, gender: values.gender, birthday: values.birthday, sourceChannel: values.sourceChannel, region: values.region, temporaryPassword: canManageAccount ? values.temporaryPassword : undefined, channel: "admin", directApprove: canDirectApprove && values.directApprove ? true : undefined }), onSuccess: async () => { await refresh(); setDrawer(undefined); form.resetFields(); message.success(t("个人会员已创建")); } });
  const edit = useMutation({ mutationFn: (values: PersonalForm) => membershipApi.savePersonal(selected!.customerId, { name: values.name, phone: values.phone, email: values.email, identityNo: values.identityNo, gender: values.gender, birthday: values.birthday, sourceChannel: values.sourceChannel, region: values.region }), onSuccess: async () => { await refresh(); setDrawer(undefined); message.success(t("会员资料已更新")); } });
  const password = useMutation({ mutationFn: (values: PersonalForm) => membershipApi.setTemporaryPassword(selected!.customerId, { temporaryPassword: values.temporaryPassword! }), onSuccess: () => { setDrawer(undefined); form.resetFields(); message.success(t("已设置临时密码，会员首次登录后必须修改")); } });
  const submitQualification = useMutation({ mutationFn: (values: SubmitCustomerQualificationRequest) => membershipApi.submitQualification(selected!.customerId, values), onSuccess: async () => { await refresh(); setDrawer(undefined); qualificationForm.resetFields(); message.success(t("证件已提交，等待独立审核")); } });
  const saveMode = useMutation({ mutationFn: (registrationMode: "automatic" | "manual") => membershipApi.saveRegistrationSettings({ registrationMode }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["membership-registration-settings"] }); message.success(t("注册审核方式已保存")); } });
  const grant = useMutation({ mutationFn: (values: { planVersionId: string; effectiveFrom?: string; effectiveTo?: string; reason?: string }) => membershipApi.assignPlan({ customerId: selected!.customerId, planVersionId: values.planVersionId, source: "manual", effectiveFrom: values.effectiveFrom, effectiveTo: values.effectiveTo, reason: values.reason }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["membership-plan-assignments", selected?.customerId] }); setDrawer(undefined); grantForm.resetFields(); message.success(t("会员方案已授予；后续报价会以权益快照为准")); } });
  const revoke = useMutation({ mutationFn: (values: { assignmentId: string; reason: string }) => membershipApi.revokePlanAssignment(values.assignmentId, values.reason), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["membership-plan-assignments", selected?.customerId] }); setRevokeTarget(undefined); revokeForm.resetFields(); message.success(t("会员方案授予已撤销；历史快照保留")); } });
  const ensureAccount = useMutation({
    mutationFn: (customerId: string) => customerApi.ensureAccount(customerId),
    onSuccess: async () => { await refresh(); message.success(t("登录账号已开通，可以继续管理账号状态")); },
    onError: (error: Error) => message.error(error.message || t("开通登录账号失败"))
  });
  const accountClosability = useQuery({
    queryKey: ["membership-account-closability", statusTarget?.customerId],
    queryFn: () => customerApi.closability(statusTarget!.customerId),
    enabled: Boolean(statusTarget && statusScope === "account" && canClose && statusTarget.account.provisioned && statusValue === "closed")
  });
  const membershipClosability = useQuery({
    queryKey: ["membership-closability", statusTarget?.customerId],
    queryFn: () => customerApi.membershipClosability(statusTarget!.customerId),
    enabled: Boolean(statusTarget && statusScope === "membership" && canClose && statusValue === "closed")
  });
  const activeClosabilityQuery = statusScope === "account" ? accountClosability : membershipClosability;
  const activeClosability = activeClosabilityQuery.data;
  const statusAllowed = statusValue === "closed" ? canClose : statusScope === "account" ? canManageAccount : statusValue === "risk_restricted" ? canRiskAction : canManage;
  const statusSubmitBlocked = !statusAllowed || (statusValue === "closed" && (activeClosabilityQuery.isFetching || activeClosabilityQuery.isError || !activeClosability || !activeClosability.closable || (activeClosability.manualConfirmations.length > 0 && !acknowledgedManualChecks)));
  const changeStatus = useMutation<unknown, Error, StatusForm>({
    mutationFn: (values: StatusForm) => statusScope === "account"
      ? customerApi.changeAccountStatus(statusTarget!.customerId, { status: values.status as CustomerAccountStatus, reason: values.reason, acknowledgedManualChecks: values.acknowledgedManualChecks })
      : customerApi.changeMembershipStatus(statusTarget!.customerId, { status: values.status as CustomerMembershipStatus, reason: values.reason, levelName: values.levelName, acknowledgedManualChecks: values.acknowledgedManualChecks }),
    onSuccess: async () => { await refresh(); setStatusTarget(undefined); setStatusScope(undefined); statusForm.resetFields(); message.success(t("状态已变更，并已记入状态历史")); },
    onError: (error: Error) => message.error(error.message || t("状态变更失败"))
  });
  const openCreate = () => { form.resetFields(); setSelected(undefined); setDrawer("create"); };
  const openEdit = (member: PersonalMembershipMember) => { form.resetFields(); form.setFieldsValue({ name: member.name, phone: "", email: member.email, gender: member.gender, birthday: member.birthday, sourceChannel: member.sourceChannel, region: member.region }); setSelected(member); setDrawer("edit"); };
  const openStatus = (member: PersonalMembershipMember, scope: "account" | "membership") => { setStatusTarget(member); setStatusScope(scope); statusForm.resetFields(); };
  useEffect(() => {
    setDrawer(undefined); setSelected(undefined); setStatusTarget(undefined); setStatusScope(undefined); setRevokeTarget(undefined);
  }, [customerId]);
  if (!canView) return <Alert type="warning" showIcon title={t("无权查看租户统一会员")} description={t("需要租户级会员查看或管理权限，且数据范围为全部。")} />;

  return <QueryState loading={members.isLoading || settings.isLoading} error={members.error ?? settings.error}>
    {!customerId && <>
    <PageHeader title={t("个人会员管理")} description={t("会员资料在租户内共享；状态变更影响全部空间。")} extra={<Space wrap><Tooltip title={t("租户共享注册策略，仅影响后续 APP 注册和管理员新建")}><Radio.Group size="small" value={settings.data?.registrationMode} disabled={!canManage} onChange={(event) => saveMode.mutate(event.target.value)} options={[{ value: "manual", label: t("手动审核") }, { value: "automatic", label: t("自动通过") }]} /></Tooltip><Button onClick={() => setDrawer("types")} disabled={!canManageTypes}>{t("当前空间证件类型")}</Button><Button type="primary" onClick={openCreate} disabled={!canManage}>{t("新增个人会员")}</Button></Space>} />

    <ListSection controls={<ListFilters filter={memberFilter} placeholder="姓名、邮箱或手机尾号" options={Object.entries(membershipLabel).map(([value, label]) => ({ value, label }))} />}><Table<PersonalMembershipMember>
      importConfig={personalImport(t, refresh, settings.data?.supportsOnlyNewImport === true)}
      exportConfig={{ filename: t("个人会员"), fields: [{ label: t("姓名"), value: row => row.name }, { label: t("手机号"), value: row => row.phoneMasked }, { label: t("会员状态"), value: row => t(membershipLabel[row.membershipStatus] ?? row.membershipStatus) }] }} rowKey="customerId" onRefresh={() => members.refetch()} loading={members.isFetching} dataSource={memberFilter.rows} pagination={memberFilter.pagination} columns={[
      { title: t("会员"), render: (_, row) => <Space orientation="vertical" size={0}><b><CustomerPreview customerId={row.customerId} name={row.name} type="personal" levelName={row.levelName} phoneMasked={row.phoneMasked} membershipStatus={row.membershipStatus} /></b><span>{row.phoneMasked}</span></Space> }, { title: t("账号"), render: (_, row) => row.account.provisioned ? <Tag color={row.account.status === "active" ? "success" : "warning"}>{row.account.status === "active" ? t("已开通") : row.account.status === "closed" ? t("已注销") : t("已停用")}</Tag> : <Tag>{t("未开通")}</Tag> },
      { title: t("会员状态"), render: (_, row) => <Tag color={row.membershipStatus === "active" ? "success" : "default"}>{t(membershipLabel[row.membershipStatus])}</Tag> }, { title: t("证件"), render: (_, row) => row.qualifications.length ? row.qualifications.map((item) => <Tag key={item.id} color={qualificationStatus[item.status]?.color}>{item.qualificationType} · {t(qualificationStatus[item.status]?.text ?? item.status)}</Tag>) : "—" },
      { title: t("加入时间"), dataIndex: "createdAt", render: (value) => new Date(value).toLocaleDateString() },
      { title: t("操作"), render: (_, row) => <DataTableRowActions details={() => navigate(`/membership/personal/${encodeURIComponent(row.customerId)}`)} detailsDisabled={!canView} detailLabel={t("查看资料")} detailAccessibleLabel={`${row.name} · ${t("查看资料")}`} menuLabel={`${row.name} · ${t("更多操作")}`} actions={[
        ...(!row.account.provisioned ? [{ id: "provision", label: t("开通账号"), icon: UserPlus, disabled: !canManageAccount || ensureAccount.isPending, onSelect: () => ensureAccount.mutate(row.customerId) }] : []),
        { id: "password", label: t("密码"), icon: KeyRound, disabled: !canManageAccount || !row.account.provisioned || row.account.status === "closed", onSelect: () => { setSelected(row); form.resetFields(); setDrawer("password"); } },
        { id: "account", label: t("账号状态"), icon: ShieldCheck, disabled: (!canManageAccount && !canClose) || !row.account.provisioned || row.account.status === "closed", onSelect: () => openStatus(row, "account") },
        { id: "membership", label: t("会员状态"), icon: ShieldCheck, disabled: (!canManage && !canRiskAction && !canClose) || row.membershipStatus === "closed", onSelect: () => openStatus(row, "membership") },
        { id: "qualification", label: t("提交证件"), icon: FileCheck, disabled: !canManage || !currentWorkspaceId, onSelect: () => { setSelected(row); qualificationForm.resetFields(); setDrawer("qualification"); } },
        { id: "grant", label: t("授予方案"), icon: BadgeCheck, disabled: !canGrant, onSelect: () => { setSelected(row); grantForm.resetFields(); setDrawer("grant"); } }
      ]} /> }
    ]} /></ListSection>
    </>}
    {customerId && <CustomerProfileDetails key={customerId}
      customerId={customerId} canManage={canManage && Boolean(detailMember)} canView={canView} canReveal={canReveal}
      canViewOrders={hasTenantMembershipPermission("rental-os:order:view")}
      onClose={() => navigate("/membership/personal")}
      onEdit={() => detailMember && openEdit(detailMember)}
      onQualification={() => { if (detailMember) { setSelected(detailMember); qualificationForm.resetFields(); setDrawer("qualification"); } }}
      actions={detailMember && <>
        <Button disabled={(!canManage && !canRiskAction && !canClose) || detailMember.membershipStatus === "closed"} onClick={() => openStatus(detailMember, "membership")}>{t("会员状态")}</Button>
        <Button disabled={!canGrant} onClick={() => { setSelected(detailMember); grantForm.resetFields(); setDrawer("grant"); }}>{t("授予方案")}</Button>
      </>}
    />}
    <Drawer title={drawer === "create" ? t("新增个人会员") : drawer === "edit" ? t("编辑个人会员") : drawer === "password" ? t("设置临时密码") : drawer === "qualification" ? t("提交品类证件") : drawer === "grant" ? t("授予会员方案") : t("证件类型配置")} size={520} open={Boolean(drawer)} onClose={() => setDrawer(undefined)} destroyOnHidden>
      {(drawer === "create" || drawer === "edit" || drawer === "password") && <Form layout="vertical" form={form} disabled={drawer === "password" ? !canManageAccount : !canManage} onFinish={(values) => drawer === "create" ? canManage && create.mutate(values) : drawer === "edit" ? canManage && edit.mutate(values) : canManageAccount && password.mutate(values)}>
        {drawer !== "password" && <><Form.Item label={t("姓名")} name="name" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label={t("手机号")} name="phone" rules={drawer === "create" ? [{ required: true }] : []}><Input placeholder={drawer === "edit" ? t("留空则保持现有手机号") : undefined} /></Form.Item><Form.Item label={t("邮箱")} name="email"><Input /></Form.Item><Form.Item label={t("性别")} name="gender"><Select allowClear options={CUSTOMER_GENDERS.map((value) => ({ value, label: t(CUSTOMER_GENDER_LABELS[value]) }))} /></Form.Item><Form.Item label={t("生日")} name="birthday"><Input placeholder="YYYY-MM-DD" /></Form.Item><Form.Item label={t("来源渠道")} name="sourceChannel"><Select allowClear options={CUSTOMER_SOURCE_CHANNELS.map((value) => ({ value, label: t(CUSTOMER_SOURCE_CHANNEL_LABELS[value]) }))} /></Form.Item><Form.Item label={t("常驻城市")} name="region"><Input placeholder={t("如 上海")} /></Form.Item><Form.Item label={t("证件号")} name="identityNo"><Input placeholder={t("仅保存脱敏展示值")} /></Form.Item></>}
        {drawer === "create" && canManageAccount && <Form.Item label={t("临时密码（可选）")} name="temporaryPassword" rules={[{ min: 8 }]}><Input.Password /></Form.Item>}
        {drawer === "create" && <Form.Item name="directApprove" valuePropName="checked"><Checkbox disabled={!canDirectApprove}>{t("直接通过")}</Checkbox></Form.Item>}
        {drawer === "password" && <Form.Item label={t("新临时密码")} name="temporaryPassword" rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item>}
        <SaveButton disabled={drawer === "password" ? !canManageAccount : !canManage} label={t("保存")} form={form} pending={create.isPending || edit.isPending || password.isPending} onSave={async values => { const operation = drawer === "create" ? canManage && create.mutateAsync(values) : drawer === "edit" ? canManage && edit.mutateAsync(values) : canManageAccount && password.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} />
      </Form>}
      {drawer === "qualification" && <QueryState loading={types.isLoading || qualificationHistory.isLoading} error={types.error ?? qualificationHistory.error}>
        <Alert type="info" showIcon title={t("资质资料与审核结果在租户内共享")} description={t("此处按当前经营空间配置选择证件类型；其他空间是否要求该证件，由对应空间业务规则决定。")} style={{ marginBottom: 16 }} />
        <Form form={qualificationForm} layout="vertical" disabled={!canManage} onFinish={(values) => canManage && submitQualification.mutate(values)}>
          <Form.Item label={t("证件类型")} name="qualificationType" rules={[{ required: true }]}><Select options={(types.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.code, label: item.name }))} /></Form.Item>
          <Form.Item label={t("证件编号")} name="referenceNo"><Input /></Form.Item>
          <Form.Item label={t("签发时间")} name="issuedAt"><Input placeholder="YYYY-MM-DD" /></Form.Item>
          <Form.Item label={t("失效时间")} name="expiresAt"><Input placeholder="YYYY-MM-DD" /></Form.Item>
          <Form.Item label={t("附件引用")} name="evidenceRef" extra={t("仅填写文件服务返回的不可变引用，不填写本地路径或 URL")}><Input /></Form.Item>
          <SaveButton disabled={!canManage} label={t("提交审核")} form={qualificationForm} pending={submitQualification.isPending} onSave={async values => { const operation = canManage && submitQualification.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} />
        </Form>
        <ListSection title={t("提交与审核历史")} style={{ marginTop: "var(--rental-layout-section-gap)" }}>
          <Table<CustomerQualificationRevision> rowKey="id" size="small" loading={qualificationHistory.isFetching} onRefresh={() => qualificationHistory.refetch()} dataSource={qualificationHistory.data ?? []} pagination={{ pageSize: 5 }} scroll={{ x: 1080 }} columns={[
            { title: t("证件"), dataIndex: "qualificationType" },
            { title: t("编号"), dataIndex: "referenceNoMasked", render: (value) => value ?? "—" },
            { title: t("证件状态"), render: (_, row) => <Tag color={qualificationStatus[row.qualificationStatus]?.color}>{t(qualificationStatus[row.qualificationStatus]?.text ?? row.qualificationStatus)}</Tag> },
            { title: t("审核"), render: (_, row) => <Tag color={statusMetaColor(row.reviewStatus)}>{t(reviewStatusLabel[row.reviewStatus] ?? row.reviewStatus)}</Tag> },
            { title: t("来源"), render: (_, row) => row.source === "app" ? "APP" : t("后台") },
            { title: t("提交时间"), render: (_, row) => new Date(row.submittedAt).toLocaleString() },
            { title: t("审核人"), dataIndex: "reviewedBy", render: (value) => value ?? "—" },
            { title: t("审核意见"), dataIndex: "reviewReason", render: (value) => value ?? "—" },
            { title: t("附件引用"), dataIndex: "evidenceRef", render: (value) => value ?? "—" }
          ]} />
        </ListSection>
      </QueryState>}
      {drawer === "grant" && <QueryState loading={plans.isLoading || assignments.isLoading || scopeOptions.isLoading} error={plans.error ?? assignments.error ?? scopeOptions.error}>
        <Form form={grantForm} layout="vertical" disabled={!canGrant} onFinish={(values) => canGrant && grant.mutate(values)}>
          <Form.Item label={t("已发布个人方案")} name="planVersionId" rules={[{ required: true }]}><Select options={(plans.data ?? []).flatMap((plan) => plan.targetType === "personal" ? (plan.versions ?? []).filter((version) => version.status === "published").map((version) => ({ value: version.id, label: `${plan.name} · v${version.version}` })) : [])} /></Form.Item>
          {selectedPlanVersion && <Alert type="info" showIcon title={t("本次授予的权益适用范围")} description={<MembershipBenefitScopeSummary benefits={selectedPlanVersion.benefits} options={scopeOptions.data} />} style={{ marginBottom: 16 }} />}
          <Form.Item label={t("生效时间")} name="effectiveFrom" extra={t("留空为提交时生效")}><Input placeholder="YYYY-MM-DD HH:mm" /></Form.Item>
          <Form.Item label={t("失效时间")} name="effectiveTo" extra={t("留空为长期有效")}><Input placeholder="YYYY-MM-DD HH:mm" /></Form.Item>
          <Form.Item label={t("授予原因")} name="reason" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={2} /></Form.Item>
          <SaveButton disabled={!canGrant} label={t("确认授予")} form={grantForm} pending={grant.isPending} onSave={async values => { const operation = canGrant && grant.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} />
        </Form>
        <ListSection title={t("当前方案授予记录")} style={{ marginTop: "var(--rental-layout-section-gap)" }}>
          <Table<CustomerMembershipPlanAssignment> rowKey="id" size="small" loading={assignments.isFetching} onRefresh={() => assignments.refetch()} dataSource={assignments.data ?? []} pagination={false} scroll={{ x: 750 }} columns={[
            { title: t("方案"), render: (_, row) => row.snapshot.planName },
            { title: t("权益适用范围"), render: (_, row) => <MembershipBenefitScopeSummary benefits={row.snapshot.benefits} options={scopeOptions.data} /> },
            { title: t("有效期"), render: (_, row) => `${row.effectiveFrom.slice(0, 16).replace("T", " ")} ~ ${row.effectiveTo?.slice(0, 16).replace("T", " ") ?? t("长期")}` },
            { title: t("状态"), render: (_, row) => <Tag color={row.status === "active" ? "success" : row.status === "expired" ? "warning" : "default"}>{row.status === "active" ? t("有效") : row.status === "expired" ? t("已过期") : t("已撤销")}</Tag> },
            { title: t("操作"), render: (_, row) => row.status === "active" && <Button type="link" disabled={!canGrant} onClick={() => { setRevokeTarget(row); revokeForm.resetFields(); }}>{t("撤销")}</Button> },
          ]} />
        </ListSection>
      </QueryState>}
      {drawer === "types" && <QualificationTypesEditor />}
    </Drawer>
    <Drawer
      title={statusScope === "account" ? t("账号状态 / 注销") : t("租户会员状态")}
      size={520}
      open={Boolean(statusTarget && statusScope)}
      destroyOnHidden
      onClose={() => { setStatusTarget(undefined); setStatusScope(undefined); statusForm.resetFields(); }}
      extra={<Tooltip title={!statusAllowed ? t("缺少该状态操作的租户权限") : statusSubmitBlocked ? t("注销前置检查尚未通过") : undefined}><SaveButton disabled={statusSubmitBlocked} label={t("提交")} form={statusForm} pending={changeStatus.isPending} onSave={async values => { const operation = !statusSubmitBlocked && changeStatus.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} /></Tooltip>}
    >
      <Alert
        type={statusScope === "account" ? "warning" : "info"}
        showIcon
        title={statusScope === "account" ? t("账号级变更影响租户全部经营空间") : t("会员状态变更影响租户全部经营空间")}
        description={statusScope === "account" ? t("停用账号会阻止该客户登录租户全部经营空间；注销为不可逆终态，不删除主档和历史业务事实。") : t("暂停、风险限制、退出与注销作用于租户统一会员关系，影响全部经营空间的新业务资格。切换空间不会恢复会员资格；历史订单与记录保留。")}
        style={{ marginBottom: 16 }}
      />
      {statusValue === "closed" && activeClosabilityQuery.isLoading && <Alert type="info" showIcon title={t("正在检查租户全部空间的注销条件")} style={{ marginBottom: 16 }} />}
      {statusValue === "closed" && activeClosabilityQuery.error && <Alert type="error" showIcon title={t("注销前置检查失败，暂不能提交")} description={activeClosabilityQuery.error.message} style={{ marginBottom: 16 }} />}
      {statusValue === "closed" && activeClosability && !activeClosability.closable && <Alert type="error" showIcon title={t("注销被前置检查阻止")} description={activeClosability.blockers.map((row) => row.message).join("; ")} style={{ marginBottom: 16 }} />}
      {statusValue === "closed" && activeClosability?.manualConfirmations.length ? <Alert type="warning" showIcon title={t("以下项目需要人工核对")} description={<>{activeClosability.manualConfirmations.map((row) => <div key={row.code}>· {row.message}</div>)}<div style={{ marginTop: 6 }}>{t("勾选下方确认后才允许注销。")}</div></>} style={{ marginBottom: 16 }} /> : null}
      <Form<StatusForm> form={statusForm} layout="vertical" onFinish={(values) => !statusSubmitBlocked && changeStatus.mutate(values)}>
        <Form.Item name="status" label={t("目标状态")} rules={[{ required: true, message: t("请选择目标状态") }]}>
          <Select options={(statusScope === "account"
            ? [
              ...(canManageAccount ? [{ value: "active", label: t("正常（恢复登录）") }, { value: "suspended", label: t("停用（阻止登录租户全部空间）") }] : []),
              ...(canClose ? [{ value: "closed", label: t("注销（不可逆终态）") }] : [])
            ]
            : [
              ...(canManage ? [{ value: "pending_activation", label: t("待激活") }, { value: "active", label: t("正常") }, { value: "suspended", label: t("已暂停") }, { value: "exited", label: t("已退出") }] : []),
              ...(canRiskAction ? [{ value: "risk_restricted", label: t("风险受限") }] : []),
              ...(canClose ? [{ value: "closed", label: t("已注销（租户全部空间）") }] : [])
            ]).filter((option) => option.value !== (statusScope === "account" ? statusTarget?.account.status : statusTarget?.membershipStatus))} />
        </Form.Item>
        {statusScope === "membership" && <Form.Item name="levelName" label={t("会员等级（恢复为正常时可调整）")}><Input placeholder={t("留空则保持原等级")} /></Form.Item>}
        {statusValue === "closed" && <Form.Item name="acknowledgedManualChecks" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error(t("注销前必须确认人工核对项"))) }]}><Checkbox>{t("已人工核对退款、押金/预授权、争议与追偿")}</Checkbox></Form.Item>}
        <Form.Item name="reason" label={t("变更原因")} rules={[{ required: true, whitespace: true, message: t("状态变更必须填写原因") }]}><Input.TextArea rows={3} maxLength={500} showCount placeholder={t("例如：客户逾期未归还，暂停租户全部空间的新业务资格")} /></Form.Item>
      </Form>
    </Drawer>
    <Drawer title={`${t("撤销会员方案")}: ${revokeTarget?.snapshot.planName ?? ""}`} size={520} open={Boolean(revokeTarget)} onClose={() => { setRevokeTarget(undefined); revokeForm.resetFields(); }} destroyOnHidden>
      <Form form={revokeForm} layout="vertical" disabled={!canGrant} onFinish={(values) => canGrant && revokeTarget && revoke.mutate({ assignmentId: revokeTarget.id, reason: values.reason })}><Form.Item name="reason" label={t("撤销原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} /></Form.Item><Button type="primary" danger htmlType="submit" disabled={!canGrant} loading={revoke.isPending}>{t("确认撤销")}</Button></Form>
    </Drawer>
  </QueryState>;
}
