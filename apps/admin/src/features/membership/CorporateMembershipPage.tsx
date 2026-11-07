import { CustomerPreview } from "@/features/membership/CustomerPreview";
import { ListFilters, useListFilter } from "@/components/ui";
import { ListSection, SaveButton } from "@/components/ui";
import { formatRentalMoney, type CorporateMembershipMember, type CustomerCorporateContract, type CustomerCorporateCreditLedgerEntry, type CustomerCorporateMembership, type CustomerCorporateInvoiceProfile, type CustomerMembershipPlanAssignment, type CustomerCorporateCredit, type SaveCustomerContractRequest, type SaveCustomerInvoiceProfileRequest, type SaveCustomerCreditRequest, type SaveCorporateMembershipRequest, type SaveCustomerCorporateMembershipRequest } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LiveRefresh, useLiveRefresh } from "@/components/ui";
import { InsightMetrics } from "@/components/BusinessInsights";
import { MemberListInsights } from "./MemberListInsights";
import { CustomerAnalysisReader } from "./CustomerAnalysis";
import { Card, Descriptions, InputNumber, Space, Tag } from "antd";
import { App } from "@/components/ui";
import { Checkbox } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, DataTableRowActions, DataTableStatus, Drawer, Select, Tabs } from "@/components/ui";
import { BadgeCheck, Landmark, Users } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { RecordDetailLayout, RecordFacts } from "@/components/RecordDetailLayout";
import recordStyles from "@/components/RecordDetailLayout.module.css";
import { useEffect, useRef, useState } from "react";
import { currentSessionEpoch } from "@/app/queryClient";
import { bindCorporateCreditDraft, corporateCreditDraftChanged, prepareCorporateCreditDraft,
  type CorporateCreditDraftBaseline, type CorporateCreditDraftCommand } from "./corporate-credit-draft";
import { corporateImport } from "@/features/listCapabilities";
import { membershipApi } from "@/api/membership";
import { customerApi } from "@/api/customer";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { MembershipBenefitScopeSummary } from "./MembershipPlanPage";

function currentCreditScope() {
  const auth = useAuthStore.getState();
  return JSON.stringify([currentSessionEpoch(), auth.sessionVerified, auth.tenant?.tenantId, auth.currentWorkspaceId,
    auth.user?.id, auth.user?.permissions, auth.user?.dataScope, auth.user?.locationScope, auth.user?.tenantMembership]);
}

const relationMeta: Record<string, { text: string; color: string }> = { active: { text: "有效", color: "success" }, suspended: { text: "暂停", color: "warning" }, exited: { text: "已退出", color: "default" } };
const membershipLabel: Record<string, string> = { pending_activation: "待审核", active: "正常", suspended: "已暂停", risk_restricted: "风险受限", exited: "已退出", closed: "已注销" };
type GrantForm = { planVersionId: string; source: "manual" | "corporate_contract"; effectiveFrom?: string; effectiveTo?: string; reason?: string };
type CorporateDrawer = "corporate" | "employees" | "grant" | "credit";
type InvoiceForm = SaveCustomerInvoiceProfileRequest;
type ContractForm = SaveCustomerContractRequest;

const creditCycleLabel: Record<CustomerCorporateCredit["billingCycle"], string> = {
  monthly: "月结",
  semi_monthly: "半月结",
  per_order: "按单结算"
};
const creditStatusLabel: Record<CustomerCorporateCredit["status"], string> = {
  active: "启用",
  suspended: "暂停",
  revoked: "已撤销"
};
const creditEntryLabel: Record<CustomerCorporateCreditLedgerEntry["entryType"], string> = {
  reserve: "占用额度",
  release: "释放额度",
  settle: "转为应收",
  payment: "企业回款",
  payment_allocation: "回款核销",
  adjust: "账务调整"
};

export function CorporateMembershipPage() {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { customerId } = useParams<{ customerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const allowedTabs = ["analysis", "profile", "employees", "invoice", "contracts", "credit"];
  const corporateTab = allowedTabs.includes(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "analysis";
  const setCorporateTab = (key: string) => setSearchParams(key === "analysis" ? {} : { tab: key });
  const hasTenantMembershipPermission = useAuthStore((state) => state.hasTenantMembershipPermission);
  const canManage = hasTenantMembershipPermission("rental-os:corporate:manage");
  const canEmployeeManage = hasTenantMembershipPermission("rental-os:corporate:employee-manage");
  const canView = hasTenantMembershipPermission("rental-os:corporate:view") || canManage || canEmployeeManage;
  const canViewCredit = hasTenantMembershipPermission("rental-os:corporate:view") || canManage;
  const canGrant = hasTenantMembershipPermission("rental-os:member:plan:manage");
  useAuthStore((state) => state.user);
  useAuthStore((state) => state.currentWorkspaceId);
  useAuthStore((state) => state.sessionVerified);
  const creditScope = currentCreditScope();
  const [creditBaseline, setCreditBaseline] = useState<CorporateCreditDraftBaseline>();
  const [selectedTarget, setSelected] = useState<CorporateMembershipMember>();
  const [drawer, setDrawer] = useState<CorporateDrawer>();
  const [editTarget, setEditTarget] = useState<CorporateMembershipMember>();
  const [revokeTarget, setRevokeTarget] = useState<CustomerMembershipPlanAssignment>();

  const [invoiceEditorOpen, setInvoiceEditorOpen] = useState(false);
  const [contractEditorOpen, setContractEditorOpen] = useState(false);
  const [employeeEditorOpen, setEmployeeEditorOpen] = useState(false);
  const [invoiceTarget, setInvoiceTarget] = useState<CustomerCorporateInvoiceProfile>();
  const [contractTarget, setContractTarget] = useState<CustomerCorporateContract>();
  const [corporateForm] = Form.useForm<SaveCorporateMembershipRequest>();
  const [invoiceForm] = Form.useForm<InvoiceForm>();
  const [contractForm] = Form.useForm<ContractForm>();
  const [employeeForm] = Form.useForm<SaveCustomerCorporateMembershipRequest>();
  const [grantForm] = Form.useForm<GrantForm>();
  const [revokeForm] = Form.useForm<{ reason: string }>();
  const [creditForm] = Form.useForm<SaveCustomerCreditRequest>();
  const selectedPlanVersionId = Form.useWatch("planVersionId", grantForm);
  const corporates = useQuery({ queryKey: ["membership-corporate"], queryFn: membershipApi.corporate, enabled: canView });
  const selected = customerId ? corporates.data?.find(row => row.customerId === customerId) : selectedTarget;
  const creditOwner = useRef(selected?.customerId);
  creditOwner.current = selected?.customerId;
  const panel = customerId ? (["invoice", "contracts"].includes(corporateTab) ? "corporate" : corporateTab) : drawer;
  const corporateFilter = useListFilter(corporates.data, { fields: row => [row.name, row.corporateName, row.email, row.phoneMasked], status: row => row.membershipStatus });
  const plans = useQuery({ queryKey: ["membership-plans"], queryFn: membershipApi.plans, enabled: canGrant && drawer === "grant" });
  const scopeOptions = useQuery({ queryKey: ["membership-benefit-scope-options"], queryFn: membershipApi.benefitScopeOptions, enabled: canGrant && drawer === "grant" });
  const selectedPlanVersion = plans.data?.flatMap((plan) => plan.targetType === "corporate" ? plan.versions ?? [] : []).find((version) => version.id === selectedPlanVersionId);
  const personal = useQuery({ queryKey: ["membership-personal-options"], queryFn: membershipApi.personalOptions, enabled: canEmployeeManage && panel === "employees" });
  const employeeLive = useLiveRefresh(`corporate-employees:${selected?.customerId ?? ""}`, Boolean(drawer || employeeEditorOpen));
  const employees = useQuery({ queryKey: ["membership-corporate-employees", selected?.customerId], queryFn: () => membershipApi.corporateEmployees(selected!.customerId), enabled: canView && Boolean(selected) && panel === "employees", ...employeeLive.queryOptions });
  const assignments = useQuery({ queryKey: ["membership-plan-assignments", selected?.customerId], queryFn: () => membershipApi.planAssignments(selected!.customerId), enabled: canGrant && Boolean(selected) && drawer === "grant" });
  // An absent configuration is valid; React Query rejects undefined query data.
  const creditConfig = useQuery({ queryKey: ["customer-credit", selected?.customerId], queryFn: async () => await customerApi.credit(selected!.customerId) ?? null, enabled: canViewCredit && Boolean(selected) && panel === "credit" });
  const creditAccount = useQuery({ queryKey: ["customer-credit-account", selected?.customerId], queryFn: () => customerApi.creditAccount(selected!.customerId), enabled: canViewCredit && Boolean(creditConfig.data) && panel === "credit" });
  const creditLedger = useQuery({ queryKey: ["customer-credit-ledger", selected?.customerId], queryFn: () => customerApi.creditLedger(selected!.customerId), enabled: canViewCredit && Boolean(creditConfig.data) && panel === "credit" });
  const invoiceProfiles = useQuery({ queryKey: ["customer-invoice-profiles", selected?.customerId], queryFn: () => customerApi.invoiceProfiles(selected!.customerId), enabled: canView && Boolean(selected) && panel === "corporate" && corporateTab === "invoice" });
  const contracts = useQuery({ queryKey: ["customer-contracts", selected?.customerId], queryFn: () => customerApi.contracts(selected!.customerId), enabled: canView && Boolean(selected) && panel === "corporate" && corporateTab === "contracts" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["membership-corporate"] });
  const saveCorporate = useMutation({
    mutationFn: (values: SaveCorporateMembershipRequest) => membershipApi.saveCorporate({ ...values, id: editTarget?.customerId }),
    onSuccess: async () => { await refresh(); setDrawer(undefined); corporateForm.resetFields(); message.success(t("企业会员已保存")); },
  });
  const saveEmployee = useMutation({
    mutationFn: (values: SaveCustomerCorporateMembershipRequest) => membershipApi.saveCorporateEmployee(selected!.customerId, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["membership-corporate-employees", selected?.customerId] });
      await refresh();
      employeeForm.resetFields();
      setEmployeeEditorOpen(false);
      message.success(t("企业成员关系已保存；其企业权益只会在有效员工关系下生效"));
    },
  });
  const grant = useMutation({
    mutationFn: (values: GrantForm) => membershipApi.assignPlan({ customerId: selected!.customerId, planVersionId: values.planVersionId, source: values.source, effectiveFrom: values.effectiveFrom, effectiveTo: values.effectiveTo, reason: values.reason }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["membership-plan-assignments", selected?.customerId] });
      setDrawer(undefined);
      grantForm.resetFields();
      message.success(t("企业会员方案已授予；仅有效员工在订单中显式选择该企业时可使用适用范围内的权益"));
    },
  });
  const revoke = useMutation({
    mutationFn: (values: { assignmentId: string; reason: string }) => membershipApi.revokePlanAssignment(values.assignmentId, values.reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["membership-plan-assignments", selected?.customerId] });
      setRevokeTarget(undefined);
      revokeForm.resetFields();
      message.success(t("企业会员方案授予已撤销；历史快照保留"));
    },
  });
  const saveInvoice = useMutation({
    mutationFn: (values: InvoiceForm) => customerApi.saveInvoiceProfile(selected!.customerId, {
      ...values, id: invoiceTarget?.id, expectedRevision: invoiceTarget?.revision
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customer-invoice-profiles", selected?.customerId] });
      setInvoiceTarget(undefined);
      invoiceForm.resetFields();
      setInvoiceEditorOpen(false);
      message.success(t("开票资料已保存"));
    }
  });
  const saveContract = useMutation({
    mutationFn: (values: ContractForm) => customerApi.saveContract(selected!.customerId, {
      ...values, id: contractTarget?.id, expectedRevision: contractTarget?.revision
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customer-contracts", selected?.customerId] });
      setContractTarget(undefined);
      contractForm.resetFields();
      setContractEditorOpen(false);
      message.success(t("企业合同已保存"));
    }
  });
  const saveCredit = useMutation({
    mutationFn: (command: CorporateCreditDraftCommand) => {
      if (command.scope !== currentCreditScope() || command.customerId !== creditOwner.current
        || !useAuthStore.getState().hasTenantMembershipPermission("rental-os:corporate:manage")) {
        throw new Error(t("资料已变更，请刷新后重新选择"));
      }
      return customerApi.saveCredit(command.customerId, command.input);
    },
    onSuccess: async (saved, command) => {
      if (command.scope !== currentCreditScope() || command.customerId !== creditOwner.current
        || saved.customerId !== command.customerId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer-credit", selected?.customerId] }),
        queryClient.invalidateQueries({ queryKey: ["customer-credit-account", selected?.customerId] }),
        queryClient.invalidateQueries({ queryKey: ["customer-credit-ledger", selected?.customerId] })
      ]);
      if (command.scope !== currentCreditScope() || command.customerId !== creditOwner.current) return;
      creditForm.resetFields();
      creditForm.setFieldsValue({ ...saved, reason: "" });
      setCreditBaseline(bindCorporateCreditDraft(command.scope, command.customerId, saved));
      message.success(t("企业授信与账期已保存"));
    }
  });
  const openCorporate = (row?: CorporateMembershipMember) => {
    setEditTarget(row);
    setSelected(row);

    setInvoiceTarget(undefined);
    setContractTarget(undefined);
    corporateForm.resetFields();
    invoiceForm.resetFields();
    contractForm.resetFields();
    if (row) corporateForm.setFieldsValue({
      name: row.name, corporateName: row.corporateProfile?.legalName ?? row.corporateName ?? row.name, email: row.email,
      registeredAddress: row.corporateProfile?.registeredAddress, legalRepName: row.corporateProfile?.legalRepName,
      industry: row.corporateProfile?.industry, scale: row.corporateProfile?.scale
    });
    setDrawer("corporate");
  };
  const openInvoice = (row?: CustomerCorporateInvoiceProfile) => {
    setInvoiceEditorOpen(true);
    setInvoiceTarget(row);
    invoiceForm.resetFields();
    invoiceForm.setFieldsValue(row ? {
      invoiceType: row.invoiceType, title: row.title, taxNo: row.taxNo,
      registeredAddress: row.registeredAddress, bankName: row.bankName,
      receiveEmail: row.receiveEmail, isDefault: row.isDefault, status: row.status,
      clearBankAccount: false, clearContactPhone: false
    } : { invoiceType: "vat_normal", isDefault: false, status: "active" });
  };
  const openContract = (row?: CustomerCorporateContract) => {
    setContractEditorOpen(true);
    setContractTarget(row);
    contractForm.resetFields();
    contractForm.setFieldsValue(row ? {
      contractNo: row.contractNo, name: row.name, signedAt: row.signedAt,
      effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo,
      status: row.status, fileRef: row.fileRef, terminatedReason: row.terminatedReason
    } : { status: "draft" });
  };
  const openEmployees = (row: CorporateMembershipMember) => navigate(`/membership/corporate/${encodeURIComponent(row.customerId)}?tab=employees`);
  const openCredit = (row: CorporateMembershipMember) => navigate(`/membership/corporate/${encodeURIComponent(row.customerId)}?tab=credit`);
  useEffect(() => {
    setDrawer(undefined); setEditTarget(undefined); setInvoiceTarget(undefined); setContractTarget(undefined); setRevokeTarget(undefined);
    setInvoiceEditorOpen(false); setContractEditorOpen(false); setEmployeeEditorOpen(false);
    corporateForm.resetFields(); invoiceForm.resetFields(); contractForm.resetFields(); employeeForm.resetFields(); creditForm.resetFields();
    setCreditBaseline(undefined);
  }, [customerId, creditScope, corporateForm, invoiceForm, contractForm, employeeForm, creditForm]);

  const loadCreditDraft = (row: CustomerCorporateCredit | null) => {
    if (!selected?.customerId || creditScope !== currentCreditScope()) return;
    creditForm.resetFields();
    creditForm.setFieldsValue(row ? {
      creditLimit: row.creditLimit,
      settlementTermDays: row.settlementTermDays,
      billingCycle: row.billingCycle,
      status: row.status,
      reason: ""
    } : {
      creditLimit: 0,
      settlementTermDays: 30,
      billingCycle: "monthly",
      status: "active",
      reason: ""
    });
    setCreditBaseline(bindCorporateCreditDraft(creditScope, selected.customerId, row));
  };
  useEffect(() => {
    if (panel !== "credit" || !creditConfig.isSuccess || creditConfig.data === undefined || !selected?.customerId) return;
    if (creditBaseline?.scope === creditScope && creditBaseline.customerId === selected.customerId) return;
    loadCreditDraft(creditConfig.data);
  }, [creditConfig.data, creditConfig.isSuccess, creditForm, panel, creditScope, selected?.customerId, creditBaseline]);
  const creditDraftChanged = corporateCreditDraftChanged(creditBaseline, creditConfig.data);
  const saveCreditDraft = (values: SaveCustomerCreditRequest) => {
    if (!canManage) throw new Error("Operation unavailable");
    return saveCredit.mutateAsync(prepareCorporateCreditDraft(creditBaseline, currentCreditScope(), creditOwner.current, values));
  };

  const corporatePanels = [
        { key: "profile", label: t("企业资料"), children: <>
          {selected?.membershipStatus === "pending_activation" && <Alert type="warning" showIcon title={t("企业会员待审核")}
            description={t("企业必须完成主体资料人工审核后才能添加员工、获得企业权益或用于下单。个人会员自动审核设置不影响企业审核。")} style={{ marginBottom: 16 }} />}
      <Form form={corporateForm} layout="vertical" disabled={!canManage} onFinish={(values) => canManage && saveCorporate.mutate(values)}>
            <Form.Item name="corporateName" label={t("企业法定名称")} rules={[{ required: true, whitespace: true }]}><Input maxLength={180} /></Form.Item>
            <Form.Item name="unifiedSocialCreditCode" label={t("统一社会信用代码")}
              rules={!editTarget || !editTarget.corporateProfile ? [{ required: true, whitespace: true }] : []}
              extra={editTarget?.corporateProfile
                ? `${t("当前已保存")}：${editTarget.corporateProfile.unifiedSocialCreditCodeMasked} · ${t("留空保持不变")}`
                : t("该历史企业尚未完成结构化资料迁移，请核对并填写有效代码；仅后台保存原值，列表和审核历史只显示掩码。")}>
              <Input maxLength={18} autoComplete="off" placeholder={editTarget?.corporateProfile ? t("留空保持现有代码") : undefined} />
            </Form.Item>
            <Form.Item name="registeredAddress" label={t("注册地址")}><Input maxLength={500} /></Form.Item>
            <Space wrap style={{ width: "100%" }}>
              <Form.Item name="legalRepName" label={t("法定代表人")}><Input maxLength={120} /></Form.Item>
              <Form.Item name="legalRepPhone" label={t("法定代表人联系电话")}
                extra={editTarget?.corporateProfile?.legalRepPhoneMasked ? `${t("当前已保存")}：${editTarget.corporateProfile.legalRepPhoneMasked} · ${t("留空保持不变")}` : undefined}>
                <Input maxLength={40} autoComplete="off" />
              </Form.Item>
            </Space>
            <Space wrap style={{ width: "100%" }}>
              <Form.Item name="industry" label={t("所属行业")}><Input maxLength={120} /></Form.Item>
              <Form.Item name="scale" label={t("企业规模")}><Select style={{ width: "var(--rental-control-width-select)" }} allowClear options={[
                { value: "1-10", label: t("1-10人") }, { value: "11-50", label: t("11-50人") },
                { value: "51-200", label: t("51-200人") }, { value: "200+", label: t("200人以上") }
              ]} /></Form.Item>
            </Space>
            <Form.Item name="name" label={t("联系人/简称")} rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
            <Form.Item name="phone" label={t("联系电话")} rules={!editTarget ? [{ required: true, whitespace: true }] : []}
              extra={editTarget ? t("为保护登录标识，现有号码不回显；留空保持不变") : undefined}>
              <Input maxLength={40} autoComplete="off" />
            </Form.Item>
            <Form.Item name="email" label={t("邮箱")}><Input maxLength={160} /></Form.Item>
            {editTarget && <Form.Item name="clearEmail" valuePropName="checked"><Checkbox>{t("清除已保存邮箱")}</Checkbox></Form.Item>}
            <SaveButton disabled={!canManage} label={t("保存企业资料")} form={corporateForm} pending={saveCorporate.isPending} onSave={async values => { const operation = canManage && saveCorporate.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} />
          </Form>
        </> },
        { key: "invoice", label: t("开票资料"), disabled: !selected, children: <QueryState loading={invoiceProfiles.isLoading} error={invoiceProfiles.error}>
          <ListSection controls={<Button disabled={!canManage} onClick={() => openInvoice()}>{t("新增开票资料")}</Button>}>
          <Table<CustomerCorporateInvoiceProfile> rowKey="id" size="small" onRefresh={() => invoiceProfiles.refetch()} loading={invoiceProfiles.isLoading} refreshing={invoiceProfiles.isFetching} dataSource={invoiceProfiles.data ?? []} pagination={false} scroll={{ x: 720 }} columns={[
            { title: t("开票抬头"), dataIndex: "title" },
            { title: t("类型"), render: (_, row) => row.invoiceType === "vat_special" ? t("增值税专用发票") : t("增值税普通发票") },
            { title: t("税号"), dataIndex: "taxNo" },
            { title: t("默认"), dataIndex: "isDefault", render: (value) => value ? t("是") : "—" },
            { title: t("状态"), dataIndex: "status", render: (value) => value === "active" ? t("启用") : t("停用") },
            { title: t("操作"), render: (_, row) => <Button type="link" disabled={!canManage} onClick={() => openInvoice(row)}>{t("编辑")}</Button> }
          ]} /></ListSection>
          {invoiceTarget && <Alert type="info" showIcon title={t("敏感资料保护")}
            description={`${t("银行账号")}：${invoiceTarget.bankAccountMasked ?? t("未设置")}；${t("联系电话")}：${invoiceTarget.contactPhoneMasked ?? t("未设置")}。${t("不回显原值；留空为保留，勾选清除才会删除。")}`} style={{ margin: "16px 0" }} />}
          {invoiceEditorOpen && <Card className={recordStyles.editor} title={t("开票资料")} extra={<Button onClick={() => setInvoiceEditorOpen(false)}>{t("取消")}</Button>}><Form form={invoiceForm} layout="vertical" disabled={!canManage} onFinish={(values) => canManage && selected && saveInvoice.mutate(values)}>
            <Form.Item name="invoiceType" label={t("发票类型")} rules={[{ required: true }]}><Select options={[{ value: "vat_normal", label: t("增值税普通发票") }, { value: "vat_special", label: t("增值税专用发票") }]} /></Form.Item>
            <Form.Item name="title" label={t("开票抬头")} rules={[{ required: true, whitespace: true }]}><Input maxLength={180} /></Form.Item>
            <Form.Item name="taxNo" label={t("税号")} rules={[{ required: true, whitespace: true }]}><Input maxLength={80} /></Form.Item>
            <Form.Item name="registeredAddress" label={t("注册地址")}><Input maxLength={500} /></Form.Item>
            <Form.Item name="bankName" label={t("开户银行")}><Input maxLength={160} /></Form.Item>
            <Form.Item name="bankAccount" label={t("银行账号")}><Input autoComplete="off" /></Form.Item>
            {invoiceTarget && <Form.Item name="clearBankAccount" valuePropName="checked"><Checkbox>{t("清除已保存银行账号")}</Checkbox></Form.Item>}
            <Form.Item name="contactPhone" label={t("开票联系电话")}><Input autoComplete="off" /></Form.Item>
            {invoiceTarget && <Form.Item name="clearContactPhone" valuePropName="checked"><Checkbox>{t("清除已保存联系电话")}</Checkbox></Form.Item>}
            <Form.Item name="receiveEmail" label={t("接收邮箱")}><Input maxLength={160} /></Form.Item>
            <Form.Item name="isDefault" valuePropName="checked"><Checkbox>{t("设为默认开票资料")}</Checkbox></Form.Item>
            <Form.Item name="status" label={t("状态")}><Select options={[{ value: "active", label: t("启用") }, { value: "disabled", label: t("停用") }]} /></Form.Item>
            <SaveButton disabled={!canManage} label={t("保存开票资料")} form={invoiceForm} pending={saveInvoice.isPending} onSave={async values => { const operation = canManage && selected && saveInvoice.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} />
          </Form></Card>}
        </QueryState> },
        { key: "contracts", label: t("企业合同"), disabled: !selected, children: <QueryState loading={contracts.isLoading} error={contracts.error}>
          <ListSection controls={<Button disabled={!canManage} onClick={() => openContract()}>{t("新增合同")}</Button>}>
          <Table<CustomerCorporateContract> rowKey="id" size="small" onRefresh={() => contracts.refetch()} loading={contracts.isLoading} refreshing={contracts.isFetching} dataSource={contracts.data ?? []} pagination={false} scroll={{ x: 760 }} columns={[
            { title: t("合同编号"), dataIndex: "contractNo" }, { title: t("合同名称"), dataIndex: "name" },
            { title: t("有效期"), render: (_, row) => `${row.effectiveFrom.slice(0, 10)} ~ ${row.effectiveTo?.slice(0, 10) ?? t("长期")}` },
            { title: t("状态"), dataIndex: "status" },
            { title: t("操作"), render: (_, row) => <Button type="link" disabled={!canManage} onClick={() => openContract(row)}>{t("编辑")}</Button> }
          ]} /></ListSection>
          {contractEditorOpen && <Card className={recordStyles.editor} title={t("企业合同")} extra={<Button onClick={() => setContractEditorOpen(false)}>{t("取消")}</Button>}><Form form={contractForm} layout="vertical" disabled={!canManage} onFinish={(values) => canManage && selected && saveContract.mutate(values)}>
            <Form.Item name="contractNo" label={t("合同编号")} rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
            <Form.Item name="name" label={t("合同名称")} rules={[{ required: true, whitespace: true }]}><Input maxLength={180} /></Form.Item>
            <Space wrap style={{ width: "100%" }}>
              <Form.Item name="signedAt" label={t("签署时间")}><Input placeholder="YYYY-MM-DD" /></Form.Item>
              <Form.Item name="effectiveFrom" label={t("生效时间")} rules={[{ required: true }]}><Input placeholder="YYYY-MM-DD" /></Form.Item>
              <Form.Item name="effectiveTo" label={t("失效时间")}><Input placeholder="YYYY-MM-DD" /></Form.Item>
            </Space>
            <Form.Item name="status" label={t("合同状态")}><Select options={[
              { value: "draft", label: t("草稿") }, { value: "active", label: t("生效") },
              { value: "expired", label: t("已到期") }, { value: "terminated", label: t("已终止") }
            ]} /></Form.Item>
            <Form.Item name="fileRef" label={t("合同文件引用")}><Input maxLength={191} /></Form.Item>
            <Form.Item name="terminatedReason" label={t("终止原因")}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
            <SaveButton disabled={!canManage} label={t("保存合同")} form={contractForm} pending={saveContract.isPending} onSave={async values => { const operation = canManage && selected && saveContract.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} />
          </Form></Card>}
        </QueryState> }
      ];
  const employeesPanel = <QueryState loading={employees.isLoading || personal.isLoading} error={employees.error ?? personal.error}>
        <Alert type="info" showIcon title={t("企业成员关系在租户内共享")} description={t("仅可选择租户内的有效个人会员。暂停或退出员工关系后，该个人在租户全部空间均不可再使用此企业身份下单，不会注销其个人会员。")} style={{ marginBottom: 16 }} />
        {canEmployeeManage && employeeEditorOpen && <Card className={recordStyles.editor} title={t("管理员与员工")} extra={<Button onClick={() => setEmployeeEditorOpen(false)}>{t("取消")}</Button>}><Form form={employeeForm} layout="vertical" disabled={!canEmployeeManage} onFinish={(values) => canEmployeeManage && saveEmployee.mutate(values)}>
          <Form.Item name="personalCustomerId" label={t("租户有效个人会员")} rules={[{ required: true }]}><Select showSearch={{ optionFilterProp: "label" }} loading={personal.isLoading} options={(personal.data ?? []).filter((item) => item.membershipStatus === "active").map((item) => ({ value: item.customerId, label: `${item.name} · ${item.phoneMasked}` }))} /></Form.Item>
          <Space wrap>
            <Form.Item name="role" label={t("企业角色")} initialValue="employee" rules={[{ required: true }]}><Select style={{ width: "var(--rental-control-width-select)" }} options={[{ value: "admin", label: t("企业管理员") }, { value: "employee", label: t("企业员工") }]} /></Form.Item>
            <Form.Item name="department" label={t("部门")}><Input /></Form.Item>
            <Form.Item name="employeeNo" label={t("员工号")}><Input /></Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="effectiveFrom" label={t("生效时间")} extra={t("留空为现在")}><Input placeholder="YYYY-MM-DD HH:mm" /></Form.Item>
            <Form.Item name="effectiveTo" label={t("失效时间")} extra={t("留空为长期有效")}><Input placeholder="YYYY-MM-DD HH:mm" /></Form.Item>
          </Space>
          <Form.Item name="status" label={t("关系状态")} initialValue="active"><Select options={Object.entries(relationMeta).map(([value, meta]) => ({ value, label: t(meta.text) }))} /></Form.Item>
          <Form.Item name="reason" label={t("说明")}><Input.TextArea rows={2} /></Form.Item>
          <SaveButton disabled={!canEmployeeManage} label={t("添加/更新成员")} form={employeeForm} pending={saveEmployee.isPending} onSave={async values => { const operation = canEmployeeManage && saveEmployee.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} />
        </Form></Card>}
        <ListSection title={t("管理员与员工")} extra={<Space><LiveRefresh enabled={employeeLive.enabled} onChange={employeeLive.setEnabled} busy={employees.isFetching} updatedAt={employees.dataUpdatedAt} paused={Boolean(drawer || employeeEditorOpen)} />{canEmployeeManage && <Button type="primary" disabled={selected?.membershipStatus !== "active"} onClick={() => { employeeForm.resetFields(); setEmployeeEditorOpen(true); }}>{t("添加/更新成员")}</Button>}</Space>}><Table<CustomerCorporateMembership> rowKey="id" size="small" loading={employees.isLoading} refreshing={employees.isFetching} onRefresh={() => employees.refetch()} dataSource={employees.data ?? []} pagination={false} columns={[
          { title: t("个人会员"), dataIndex: "personalCustomerName", render: (_, row) => <CustomerPreview customerId={row.personalCustomerId} name={row.personalCustomerName ?? "—"} type="personal" /> },
          { title: t("角色"), dataIndex: "role", render: (value) => value === "admin" ? t("企业管理员") : t("企业员工") },
          { title: t("部门"), dataIndex: "department", render: (value) => value ?? "—" },
          { title: t("有效期"), render: (_, row) => `${row.effectiveFrom.slice(0, 16).replace("T", " ")} ~ ${row.effectiveTo?.slice(0, 16).replace("T", " ") ?? t("长期")}` },
          { title: t("状态"), render: (_, row) => <Tag color={relationMeta[row.status].color}>{t(relationMeta[row.status].text)}</Tag> },
        ]} /></ListSection>
      </QueryState>;
  const creditPanel = <QueryState loading={creditConfig.isLoading} error={creditConfig.error}>
        <Alert type="info" showIcon title={t("企业授信是租户级额度；押金与预授权仍独立处理。")}
          description={t("账期订单确认时占用授信，订单结算后形成应收。调整额度必须填写原因；已有占用或应收未处理前不能把额度调低。")}
          style={{ marginBottom: 16 }} />
        {!creditConfig.data && <p className="muted">{t("尚未配置授信与账期")}</p>}
     {creditConfig.data && <QueryState loading={creditAccount.isLoading || creditLedger.isLoading} error={creditAccount.error ?? creditLedger.error}>
          {creditAccount.data && <>
            <ListSection title={t("当前账务余额")}>
              <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
                { key: "limit", label: t("授信额度"), children: formatRentalMoney(creditAccount.data.creditLimit, creditAccount.data.currency) },
                { key: "reserved", label: t("已占用"), children: formatRentalMoney(creditAccount.data.reservedAmount, creditAccount.data.currency) },
                { key: "receivable", label: t("未回款应收"), children: formatRentalMoney(creditAccount.data.receivableAmount, creditAccount.data.currency) },
                { key: "available", label: t("可用额度"), children: <b>{formatRentalMoney(creditAccount.data.availableAmount, creditAccount.data.currency)}</b> },
                { key: "cycle", label: t("账单周期"), children: t(creditCycleLabel[creditAccount.data.billingCycle]) },
                { key: "term", label: t("账期天数"), children: `${creditAccount.data.settlementTermDays} ${t("天")}` },
                { key: "status", label: t("授信状态"), children: <Tag color={creditAccount.data.status === "active" ? "success" : "warning"}>{t(creditStatusLabel[creditAccount.data.status])}</Tag> }
              ]} />
              {creditAccount.data.availableAmount < 0 && <Alert type="error" showIcon title={t("当前授信敞口已超过额度，请先处理应收或授信配置。")} style={{ marginTop: 12 }} />}
            </ListSection>
            <ListSection title={t("授信账务流水")} style={{ marginTop: "var(--rental-layout-section-gap)" }}>
              <Table<CustomerCorporateCreditLedgerEntry> rowKey="id" size="small" onRefresh={() => creditLedger.refetch()} loading={creditLedger.isLoading} refreshing={creditLedger.isFetching} dataSource={creditLedger.data ?? []} pagination={{ defaultPageSize: 20 }} scroll={{ x: 960 }} columns={[
                { title: t("发生时间"), dataIndex: "occurredAt", render: (value: string) => new Date(value).toLocaleString() },
                { title: t("业务类型"), dataIndex: "entryType", render: (value: CustomerCorporateCreditLedgerEntry["entryType"]) => t(creditEntryLabel[value]) },
                { title: t("发生金额"), render: (_: unknown, row: CustomerCorporateCreditLedgerEntry) => formatRentalMoney(row.amount, row.currency) },
                { title: t("占用变化"), render: (_: unknown, row: CustomerCorporateCreditLedgerEntry) => formatRentalMoney(row.reservedDelta, row.currency) },
                { title: t("应收变化"), render: (_: unknown, row: CustomerCorporateCreditLedgerEntry) => formatRentalMoney(row.receivableDelta, row.currency) },
                { title: t("订单"), dataIndex: "orderId", render: (value?: string) => value || "—" },
                { title: t("原因"), dataIndex: "reason" },
                { title: t("操作人"), dataIndex: "operator", render: (value?: string) => value || "—" }
              ]} />
            </ListSection>
          </>}
        </QueryState>}
      <details className={recordStyles.disclosure}><summary>{t("授信与账期配置")}</summary>        <Card title={t("授信与账期配置")}>
          {creditDraftChanged && <Alert type="warning" showIcon title={t("资料已变更，请刷新后重新选择")} />}
          <Button disabled={!creditConfig.isSuccess || saveCredit.isPending} onClick={() => {
            if (creditConfig.data !== undefined) loadCreditDraft(creditConfig.data);
          }}>{t("重新载入并放弃当前输入")}</Button>
          <Form form={creditForm} layout="vertical" disabled={!canManage || saveCredit.isPending} onFinish={saveCreditDraft}>
            <Space wrap align="start" style={{ width: "100%" }}>
              <Form.Item name="creditLimit" label={t("授信额度（元）")} rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: "var(--rental-control-width-number)" }} /></Form.Item>
              <Form.Item name="settlementTermDays" label={t("账期天数")} rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "var(--rental-control-width-number)" }} /></Form.Item>
              <Form.Item name="billingCycle" label={t("账单周期")} rules={[{ required: true }]}><Select style={{ width: "var(--rental-control-width-select)" }} options={Object.entries(creditCycleLabel).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item>
              <Form.Item name="status" label={t("授信状态")} rules={[{ required: true }]}><Select style={{ width: "var(--rental-control-width-select)" }} options={Object.entries(creditStatusLabel).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item>
            </Space>
            <Form.Item name="reason" label={t("变更原因")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
            <SaveButton disabled={!canManage || !creditBaseline || creditBaseline.scope !== creditScope || creditBaseline.customerId !== selected?.customerId} label={t("保存授信配置")} form={creditForm} pending={saveCredit.isPending} onSave={saveCreditDraft} />
          </Form>
        </Card>
   </details></QueryState>;
  if (!canView) return <Alert type="warning" showIcon title={t("无权查看租户统一企业会员")} description={t("需要租户级企业会员查看、管理或员工管理权限，且数据范围为全部。")} />;

  return <QueryState loading={corporates.isLoading} error={corporates.error}>
    {!customerId && <>
    <PageHeader title={t("企业会员管理")} description={t("企业资料在租户内共享；会员状态变更影响全部空间。")}
      summary={<InsightMetrics items={[{ label: t("企业"), value: corporateFilter.rows.length }, { label: t("关联员工"), value: corporateFilter.rows.reduce((sum, row) => sum + row.employeeCount, 0) }, { label: t("管理员"), value: corporateFilter.rows.reduce((sum, row) => sum + row.adminCount, 0) }]} />}
      extra={<Button type="primary" disabled={!canManage} onClick={() => openCorporate()}>{t("新增企业会员")}</Button>} />
    <ListSection controls={<ListFilters filter={corporateFilter} placeholder="企业、联系人或手机尾号" options={Object.entries(membershipLabel).map(([value, label]) => ({ value, label }))} />}>
      <Table<CorporateMembershipMember> toolbarNote={false} emptyScene={corporateFilter.keyword || corporateFilter.status ? "search" : "empty"}
        importConfig={corporateImport(t, () => corporates.refetch({ throwOnError: true }))}
        exportConfig={{ filename: t("企业会员"), fields: [{ label: t("企业"), value: row => row.corporateName }, { label: t("联系人"), value: row => row.name }, { label: t("联系电话"), value: row => row.phoneMasked }, { label: t("会员状态"), value: row => t(membershipLabel[row.membershipStatus] ?? row.membershipStatus) }] }} rowKey="customerId" onRefresh={() => corporates.refetch()} loading={corporates.isLoading} refreshing={corporates.isFetching} dataSource={corporateFilter.rows} pagination={corporateFilter.pagination} columns={[
        { title: t("企业"), render: (_, row) => <CustomerPreview presentation="list" secondary={row.phoneMasked} customerId={row.customerId} name={row.corporateName ?? row.name} type="corporate" phoneMasked={row.phoneMasked} membershipStatus={row.membershipStatus} /> },
        { title: t("会员状态"), render: (_, row) => <Tag color={row.membershipStatus === "active" ? "success" : "default"}>{t(membershipLabel[row.membershipStatus] ?? row.membershipStatus)}</Tag> },
        { title: t("企业管理员"), dataIndex: "adminCount" },
        { title: t("员工数"), dataIndex: "employeeCount" },
        { title: t("创建时间"), dataIndex: "createdAt", render: (value) => new Date(value).toLocaleDateString() },
        { title: t("操作"), render: (_, row) => <DataTableRowActions details={() => navigate(`/membership/corporate/${encodeURIComponent(row.customerId)}`)} detailsDisabled={!canView} detailLabel={t("企业资料")} detailAccessibleLabel={`${row.corporateName ?? row.name} · ${t("企业资料")}`} menuLabel={`${row.corporateName ?? row.name} · ${t("更多操作")}`} actions={[
          { id: "employees", label: t("管理员与员工"), icon: Users, disabled: !canView || row.membershipStatus !== "active", onSelect: () => openEmployees(row) },
          { id: "grant", label: t("授予方案"), icon: BadgeCheck, disabled: !canGrant || row.membershipStatus !== "active", onSelect: () => { setSelected(row); grantForm.resetFields(); grantForm.setFieldsValue({ source: "manual" }); setDrawer("grant"); } },
          ...(canViewCredit ? [{ id: "credit", label: t("授信账务"), icon: Landmark, onSelect: () => openCredit(row) }] : [])
        ]} /> },
      ]} />
    </ListSection>
    <MemberListInsights rows={corporateFilter.rows} />
    </>}
    {customerId && <RecordDetailLayout title={selected?.corporateName ?? selected?.name ?? t("企业资料")} onBack={() => navigate("/membership/corporate")}
      actions={selected && <><Button type="primary" disabled={!canManage} onClick={() => openCorporate(selected)}>{t("编辑企业资料")}</Button><Button disabled={!canGrant || selected.membershipStatus !== "active"} onClick={() => { grantForm.resetFields(); grantForm.setFieldsValue({ source: "manual" }); setDrawer("grant"); }}>{t("授予方案")}</Button></>}
      status={selected && <><DataTableStatus variant="soft" tone={selected.membershipStatus === "active" ? "success" : selected.membershipStatus === "pending_activation" ? "warning" : "neutral"}>{t(membershipLabel[selected.membershipStatus] ?? selected.membershipStatus)}</DataTableStatus><span>{t("企业会员")}</span></>}
      facts={selected ? [
        { key: "contact", label: "联系人/简称", value: selected.name },
        { key: "phone", label: "联系电话", value: selected.phoneMasked || "—" },
        { key: "admins", label: "企业管理员", value: selected.adminCount },
        { key: "employees", label: "员工数", value: selected.employeeCount }
      ] : undefined}>
      {!selected ? <Alert type="warning" showIcon title={t("未找到企业资料")} /> : <Tabs activeKey={corporateTab} onChange={setCorporateTab} items={[
        { key: "analysis", label: t("客户分析"), children: <CustomerAnalysisReader customerId={selected.customerId} /> },
        { key: "profile", label: t("企业资料"), children: <RecordFacts items={[
          { key: "legal", label: "企业法定名称", value: selected.corporateProfile?.legalName ?? selected.corporateName ?? selected.name },
          { key: "tax", label: "统一社会信用代码", value: selected.corporateProfile?.unifiedSocialCreditCodeMasked || "—" },
          { key: "rep", label: "法定代表人", value: selected.corporateProfile?.legalRepName || "—" },
          { key: "repPhone", label: "法定代表人联系电话", value: selected.corporateProfile?.legalRepPhoneMasked || "—" },
          { key: "email", label: "邮箱", value: selected.email || "—" },
          { key: "address", label: "注册地址", value: selected.corporateProfile?.registeredAddress || "—" },
          { key: "industry", label: "所属行业", value: selected.corporateProfile?.industry || "—" },
          { key: "scale", label: "企业规模", value: selected.corporateProfile?.scale || "—" },
          { key: "created", label: "创建时间", value: new Date(selected.createdAt).toLocaleString() }
        ]} /> },
        { key: "employees", label: t("管理员与员工"), children: employeesPanel },
        corporatePanels[1], corporatePanels[2],
        ...(canViewCredit ? [{ key: "credit", label: t("授信账务"), children: creditPanel }] : [])
      ]} />}
    </RecordDetailLayout>}

    <Drawer title={drawer === "grant" ? t("授予企业会员方案") : editTarget ? t("编辑企业会员") : t("新增企业会员")} size={620} open={Boolean(drawer)} onClose={() => setDrawer(undefined)} destroyOnHidden>
      {drawer === "corporate" && corporatePanels[0].children}

      {drawer === "grant" && <QueryState loading={plans.isLoading || assignments.isLoading || scopeOptions.isLoading} error={plans.error ?? assignments.error ?? scopeOptions.error}>
        <Form form={grantForm} layout="vertical" disabled={!canGrant} onFinish={(values) => canGrant && grant.mutate(values)}>
          <Form.Item name="planVersionId" label={t("已发布企业方案")} rules={[{ required: true }]}><Select options={(plans.data ?? []).flatMap((plan) => plan.targetType === "corporate" ? (plan.versions ?? []).filter((version) => version.status === "published").map((version) => ({ value: version.id, label: `${plan.name} · v${version.version}` })) : [])} /></Form.Item>
          {selectedPlanVersion && <Alert type="info" showIcon title={t("本次授予的权益适用范围")} description={<MembershipBenefitScopeSummary benefits={selectedPlanVersion.benefits} options={scopeOptions.data} />} style={{ marginBottom: 16 }} />}
          <Form.Item name="source" label={t("授予来源")} rules={[{ required: true }]}><Select options={[{ value: "manual", label: t("后台人工授予") }, { value: "corporate_contract", label: t("企业合同授予") }]} /></Form.Item>
          <Form.Item name="effectiveFrom" label={t("生效时间")} extra={t("留空为提交时生效")}><Input placeholder="YYYY-MM-DD HH:mm" /></Form.Item>
          <Form.Item name="effectiveTo" label={t("失效时间")} extra={t("留空为长期有效")}><Input placeholder="YYYY-MM-DD HH:mm" /></Form.Item>
          <Form.Item name="reason" label={t("授予原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={2} /></Form.Item>
          <SaveButton disabled={!canGrant} label={t("确认授予")} form={grantForm} pending={grant.isPending} onSave={async values => { const operation = canGrant && grant.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} />
        </Form>
        <ListSection title={t("当前方案授予记录")} style={{ marginTop: "var(--rental-layout-section-gap)" }}>
          <Table<CustomerMembershipPlanAssignment> rowKey="id" size="small" loading={assignments.isLoading} refreshing={assignments.isFetching} onRefresh={() => assignments.refetch()} dataSource={assignments.data ?? []} pagination={false} scroll={{ x: 750 }} columns={[
            { title: t("方案"), render: (_, row) => row.snapshot.planName },
            { title: t("权益适用范围"), render: (_, row) => <MembershipBenefitScopeSummary benefits={row.snapshot.benefits} options={scopeOptions.data} /> },
            { title: t("有效期"), render: (_, row) => `${row.effectiveFrom.slice(0, 16).replace("T", " ")} ~ ${row.effectiveTo?.slice(0, 16).replace("T", " ") ?? t("长期")}` },
            { title: t("状态"), render: (_, row) => <Tag color={row.status === "active" ? "success" : row.status === "expired" ? "warning" : "default"}>{row.status === "active" ? t("有效") : row.status === "expired" ? t("已过期") : t("已撤销")}</Tag> },
            { title: t("操作"), render: (_, row) => row.status === "active" && <Button type="link" disabled={!canGrant} onClick={() => { setRevokeTarget(row); revokeForm.resetFields(); }}>{t("撤销")}</Button> },
          ]} />
        </ListSection>
      </QueryState>}

    </Drawer>
    <Drawer presentation="dialog" title={`${t("撤销会员方案")}: ${revokeTarget?.snapshot.planName ?? ""}`} size={520} open={Boolean(revokeTarget)} onClose={() => { setRevokeTarget(undefined); revokeForm.resetFields(); }} destroyOnHidden>
      <Form form={revokeForm} layout="vertical" disabled={!canGrant} onFinish={(values) => canGrant && revokeTarget && revoke.mutate({ assignmentId: revokeTarget.id, reason: values.reason })}>
        <Form.Item name="reason" label={t("撤销原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} /></Form.Item>
        <Button type="primary" danger htmlType="submit" disabled={!canGrant} loading={revoke.isPending}>{t("确认撤销")}</Button>
      </Form>
    </Drawer>
  </QueryState>;
}
