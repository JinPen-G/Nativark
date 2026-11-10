import { CustomerPreview } from "@/features/membership/CustomerPreview";
import { ListFilters, useListFilter } from "@/components/ui";
import { ListSection, SaveButton, ActionButton } from "@/components/ui";
import { ConfirmAction } from "@/components/ui";
import { readCorporatePaymentReference, retainCorporatePaymentReference, clearCorporatePaymentReference, matchesCorporatePaymentReversal,
  type CorporatePaymentReference } from "./corporate-payment-reference";
import { CUSTOMER_CORPORATE_INDUSTRY_LABELS, formatRentalMoney, type CorporateMembershipMember, type CustomerCorporateContract, type CustomerCorporateCreditLedgerEntry, type CustomerCorporateMembership, type CustomerCorporateInvoiceProfile, type CustomerMembershipPlanAssignment, type CustomerCorporateCredit, type SaveCustomerContractRequest, type SaveCustomerInvoiceProfileRequest, type SaveCustomerCreditRequest, type SaveCorporateMembershipRequest, type SaveCustomerCorporateMembershipRequest } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LiveRefresh, useLiveRefresh } from "@/components/ui";
import { InsightMetrics } from "@/components/BusinessInsights";
import { MemberListInsights } from "./MemberListInsights";
import { CustomerAnalysisReader } from "./CustomerAnalysis";
import { Col, Descriptions, InputNumber, Row, Space, Tag } from "antd";
import { App } from "@/components/ui";
import { Checkbox } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, DataTableRowActions, DataTableStatus, DataTableText, DatePicker, Modal, Select, Tabs } from "@/components/ui";
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
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { useAuthStore } from "@/features/auth/authStore";
import { MembershipBenefitScopeSummary } from "./MembershipPlanPage";
import dayjs from "dayjs";

// Existing strings stay in the form store; conversion happens only when a date is edited.
const dateOnlyBinding = {
  getValueProps: (value?: string) => ({ value: value ? dayjs(value) : null }),
  getValueFromEvent: (value: dayjs.Dayjs | null) => value?.format("YYYY-MM-DD"),
};
const dateTimeBinding = {
  getValueProps: (value?: string) => ({ value: value ? dayjs(value) : null }),
  getValueFromEvent: (value: dayjs.Dayjs | null) => value?.toISOString(),
};

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
  payment_reversal: "回款冲销",
  allocation_reversal: "核销冲销",
  adjust: "账务调整"
};

export function CorporateMembershipPage() {
  const scope = useListQueryIdentity();
  const membershipScope = useAuthStore(state => JSON.stringify(state.user?.tenantMembership));
  return <CorporateMembershipWorkspace key={`${scope}:${membershipScope}`} scope={scope} />;
}

function CorporateMembershipWorkspace({ scope }: { scope: string }) {
  const { message } = App.useApp();
  const { t, locale } = useLocale();
  const localDateTime = (value: string) => new Date(value).toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { customerId } = useParams<{ customerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const allowedTabs = ["analysis", "profile", "employees", "invoice", "contracts", "credit"];
  const corporateTab = allowedTabs.includes(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "profile";
  const setCorporateTab = (key: string) => setSearchParams(key === "profile" ? {} : { tab: key });
  const hasTenantMembershipPermission = useAuthStore((state) => state.hasTenantMembershipPermission);
  const canManage = hasTenantMembershipPermission("rental-os:corporate:manage");
  const canEmployeeManage = hasTenantMembershipPermission("rental-os:corporate:employee-manage");
  const canView = hasTenantMembershipPermission("rental-os:corporate:view") || canManage || canEmployeeManage;
  const canViewCredit = hasTenantMembershipPermission("rental-os:corporate:view") || canManage;
  const canGrant = hasTenantMembershipPermission("rental-os:member:plan:manage");
  const canFinanceManage = useAuthStore(state => state.hasPermission("rental-os:finance:manage"));
  const canReversePayment = canManage && canFinanceManage;
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
  const [employeeTarget, setEmployeeTarget] = useState<CustomerCorporateMembership>();
  const [grantTab, setGrantTab] = useState("edit");
  const [invoiceTarget, setInvoiceTarget] = useState<CustomerCorporateInvoiceProfile>();
  const [contractTarget, setContractTarget] = useState<CustomerCorporateContract>();
  const [corporateForm] = Form.useForm<SaveCorporateMembershipRequest>();
  const [invoiceForm] = Form.useForm<InvoiceForm>();
  const [contractForm] = Form.useForm<ContractForm>();
  const [employeeForm] = Form.useForm<SaveCustomerCorporateMembershipRequest>();
  const [grantForm] = Form.useForm<GrantForm>();
  const [revokeForm] = Form.useForm<{ reason: string }>();
  const [creditForm] = Form.useForm<SaveCustomerCreditRequest>();
  const [reversalForm] = Form.useForm<{ basisRef: string; reason: string }>();
  const [reversalTarget, setReversalTarget] = useState<CustomerCorporateCreditLedgerEntry>();
  const [reversalReference, setReversalReference] = useState<CorporatePaymentReference | null>(null);
  const [reversalBlocked, setReversalBlocked] = useState(false);
  const corporateDialog = useModalDismissal(Boolean(drawer), () => {
    if (drawer === "corporate") corporateForm.resetFields();
    if (drawer === "grant") grantForm.resetFields();
    setDrawer(undefined); setEditTarget(undefined); setGrantTab("edit");
  });
  const invoiceDialog = useModalDismissal(invoiceEditorOpen, () => { setInvoiceEditorOpen(false); setInvoiceTarget(undefined); invoiceForm.resetFields(); });
  const contractDialog = useModalDismissal(contractEditorOpen, () => { setContractEditorOpen(false); setContractTarget(undefined); contractForm.resetFields(); });
  const employeeDialog = useModalDismissal(employeeEditorOpen, () => { setEmployeeEditorOpen(false); setEmployeeTarget(undefined); employeeForm.resetFields(); });
  const revokeDialog = useModalDismissal(Boolean(revokeTarget), () => { setRevokeTarget(undefined); revokeForm.resetFields(); });
  const selectedPlanVersionId = Form.useWatch("planVersionId", grantForm);
  const corporates = useQuery({ queryKey: ["membership-corporate", scope], queryFn: membershipApi.corporate, enabled: canView });
  const selected = customerId ? corporates.data?.find(row => row.customerId === customerId) : selectedTarget;
  const creditOwner = useRef(selected?.customerId);
  creditOwner.current = selected?.customerId;
  const panel = customerId ? (["invoice", "contracts"].includes(corporateTab) ? "corporate" : corporateTab) : drawer;
  const corporateFilter = useListFilter(corporates.data, { fields: row => [row.name, row.corporateName, row.email, row.phoneMasked], status: row => row.membershipStatus });
  const plans = useQuery({ queryKey: ["membership-plans", scope], queryFn: membershipApi.plans, enabled: canGrant && drawer === "grant" });
  const scopeOptions = useQuery({ queryKey: ["membership-benefit-scope-options", scope], queryFn: membershipApi.benefitScopeOptions, enabled: canGrant && drawer === "grant" });
  const selectedPlanVersion = plans.data?.flatMap((plan) => plan.targetType === "corporate" ? plan.versions ?? [] : []).find((version) => version.id === selectedPlanVersionId);
  const personal = useQuery({ queryKey: ["membership-personal-options", scope], queryFn: membershipApi.personalOptions, enabled: canEmployeeManage && employeeEditorOpen });
  const employeeLive = useLiveRefresh(`corporate-employees:${selected?.customerId ?? ""}`, Boolean(drawer || employeeEditorOpen));
  const employees = useQuery({ queryKey: ["membership-corporate-employees", selected?.customerId, scope], queryFn: () => membershipApi.corporateEmployees(selected!.customerId), enabled: canView && Boolean(selected) && panel === "employees", ...employeeLive.queryOptions });
  const employeeFilter = useListFilter(employees.data, { fields: row => [row.personalCustomerName, row.department, row.employeeNo], status: row => row.status });
  const assignments = useQuery({ queryKey: ["membership-plan-assignments", selected?.customerId, scope], queryFn: () => membershipApi.planAssignments(selected!.customerId), enabled: canGrant && Boolean(selected) && drawer === "grant" });
  // An absent configuration is valid; React Query rejects undefined query data.
  const creditConfig = useQuery({ queryKey: ["customer-credit", selected?.customerId, creditScope], queryFn: async () => await customerApi.credit(selected!.customerId) ?? null, enabled: canViewCredit && Boolean(selected) && panel === "credit" });
  const creditAccount = useQuery({ queryKey: ["customer-credit-account", selected?.customerId, creditScope], queryFn: () => customerApi.creditAccount(selected!.customerId), enabled: canViewCredit && Boolean(creditConfig.data) && panel === "credit" });
  const creditLedger = useQuery({ queryKey: ["customer-credit-ledger", selected?.customerId, creditScope], queryFn: () => customerApi.creditLedger(selected!.customerId), enabled: canViewCredit && Boolean(creditConfig.data) && panel === "credit" });
  const invoiceProfiles = useQuery({ queryKey: ["customer-invoice-profiles", selected?.customerId, scope], queryFn: () => customerApi.invoiceProfiles(selected!.customerId), enabled: canView && Boolean(selected) && panel === "corporate" && corporateTab === "invoice" });
  const contracts = useQuery({ queryKey: ["customer-contracts", selected?.customerId, scope], queryFn: () => customerApi.contracts(selected!.customerId), enabled: canView && Boolean(selected) && panel === "corporate" && corporateTab === "contracts" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["membership-corporate"] });
  const saveCorporate = useMutation({
    mutationFn: (values: SaveCorporateMembershipRequest) => membershipApi.saveCorporate({ ...values, id: editTarget?.customerId }),
    onSuccess: async () => { await refresh(); corporateDialog.dismiss(); message.success(t("企业会员已保存")); },
  });
  const saveEmployee = useMutation({
    mutationFn: (values: SaveCustomerCorporateMembershipRequest) => membershipApi.saveCorporateEmployee(selected!.customerId, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["membership-corporate-employees", selected?.customerId] });
      await refresh();
      employeeDialog.dismiss();
      message.success(t("企业成员关系已保存；其企业权益只会在有效员工关系下生效"));
    },
  });
  const grant = useMutation({
    mutationFn: (values: GrantForm) => membershipApi.assignPlan({ customerId: selected!.customerId, planVersionId: values.planVersionId, source: values.source, effectiveFrom: values.effectiveFrom, effectiveTo: values.effectiveTo, reason: values.reason }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["membership-plan-assignments", selected?.customerId] });
      corporateDialog.dismiss();
      message.success(t("企业会员方案已授予；仅有效员工在订单中显式选择该企业时可使用适用范围内的权益"));
    },
  });
  const revoke = useMutation({
    mutationFn: (values: { assignmentId: string; reason: string }) => membershipApi.revokePlanAssignment(values.assignmentId, values.reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["membership-plan-assignments", selected?.customerId] });
      revokeDialog.dismiss();
      message.success(t("企业会员方案授予已撤销；历史快照保留"));
    },
  });
  const saveInvoice = useMutation({
    mutationFn: (values: InvoiceForm) => customerApi.saveInvoiceProfile(selected!.customerId, {
      ...values, id: invoiceTarget?.id, expectedRevision: invoiceTarget?.revision
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customer-invoice-profiles", selected?.customerId] });
      invoiceDialog.dismiss();
      message.success(t("开票资料已保存"));
    }
  });
  const saveContract = useMutation({
    mutationFn: (values: ContractForm) => customerApi.saveContract(selected!.customerId, {
      ...values, id: contractTarget?.id, expectedRevision: contractTarget?.revision
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customer-contracts", selected?.customerId] });
      contractDialog.dismiss();
      message.success(t("企业合同已保存"));
    }
  });
  const reversalStorage = () => { try { return window.sessionStorage; } catch { return undefined; } };
  const reversalScope = () => {
    const auth = useAuthStore.getState();
    return JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id]);
  };
  useEffect(() => {
    setReversalTarget(undefined); reversalForm.resetFields();
    if (!selected?.customerId) { setReversalReference(null); setReversalBlocked(true); return; }
    const journal = readCorporatePaymentReference(reversalStorage(), reversalScope(), selected.customerId);
    setReversalReference(journal.pending); setReversalBlocked(journal.blocked);
  }, [creditScope, selected?.customerId, reversalForm]);
  const refreshReversal = async (customer: string) => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["customer-credit-account", customer] }),
    queryClient.invalidateQueries({ queryKey: ["customer-credit-ledger", customer] })
  ]);
  const reversePayment = useMutation({ mutationFn: async (command: { reference: CorporatePaymentReference; scope: string; input: { basisRef: string; reason: string } }) => {
    const { reference } = command;
    const auth = useAuthStore.getState();
    if (command.scope !== currentCreditScope() || reference.customerId !== creditOwner.current || !auth.sessionVerified
      || !auth.hasTenantMembershipPermission("rental-os:corporate:manage") || !auth.hasPermission("rental-os:finance:manage")
      || reference.scope !== reversalScope()) throw new Error(t("资料已变更，请刷新后重新选择"));
    const receipt = await customerApi.reverseCreditPayment(reference.customerId, reference.paymentId,
      { ...command.input, idempotencyKey: reference.key });
    if (receipt.paymentId !== reference.paymentId || receipt.customerId !== reference.customerId || receipt.idempotencyKey !== reference.key) {
      throw new Error(t("原操作结果尚待核对"));
    }
    clearCorporatePaymentReference(reversalStorage(), reference);
    if (command.scope !== currentCreditScope() || reference.customerId !== creditOwner.current) return;
    setReversalReference(null); setReversalTarget(undefined); reversalForm.resetFields();
    await refreshReversal(reference.customerId); message.success(t("回款已冲销，原记录保留；未发起资金退款"));
  } });
  const observeReversal = async () => {
    const reference = reversalReference, scope = currentCreditScope();
    if (!reference || reference.customerId !== creditOwner.current || reference.scope !== reversalScope()) throw new Error(t("原操作结果尚待核对"));
    const receipt = await customerApi.creditPaymentReversal(reference.customerId, reference.paymentId);
    if (!receipt) throw new Error(t("未取得原冲销收据，请保留原操作引用继续核对"));
    // One immutable full reversal per original payment. Another actor/key's
    // confirmed receipt proves this payment cannot be reversed again; it does
    // not claim that our rejected command performed the reversal.
    if (!matchesCorporatePaymentReversal(reference, receipt)) {
      throw new Error(t("原操作结果尚待核对"));
    }
    clearCorporatePaymentReference(reversalStorage(), reference);
    if (scope !== currentCreditScope() || reference.customerId !== creditOwner.current) return;
    setReversalReference(null); setReversalTarget(undefined); reversalForm.resetFields();
    await refreshReversal(reference.customerId); message.success(t("已读取原冲销收据"));
  };
  const submitReversal = async (input: { basisRef: string; reason: string }) => {
    if (!selected || !reversalTarget || reversalReference || reversalBlocked || reversePayment.isPending) throw new Error(t("原操作结果尚待核对"));
    const scope = currentCreditScope(), customer = selected.customerId, paymentId = reversalTarget.id;
    const existing = await customerApi.creditPaymentReversal(customer, paymentId);
    if (scope !== currentCreditScope() || customer !== creditOwner.current) throw new Error(t("资料已变更，请刷新后重新选择"));
    if (existing) {
      if (existing.customerId !== customer || existing.paymentId !== paymentId) throw new Error(t("原操作结果尚待核对"));
      setReversalTarget(undefined); reversalForm.resetFields();
      await refreshReversal(customer); message.success(t("已读取原冲销收据")); return;
    }
    const reference: CorporatePaymentReference = { version: 1, scope: reversalScope(), customerId: customer,
      paymentId, key: crypto.randomUUID() };
    retainCorporatePaymentReference(reversalStorage(), reference);
    setReversalReference(reference);
    return reversePayment.mutateAsync({ reference, scope, input });
  };
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

    corporateForm.resetFields();
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
  const openEmployeeEditor = (row?: CustomerCorporateMembership) => {
    if (!canEmployeeManage || selected?.membershipStatus !== "active" || saveEmployee.isPending) return;
    setEmployeeTarget(row);
    employeeForm.resetFields();
    employeeForm.setFieldsValue(row ? { personalCustomerId: row.personalCustomerId, role: row.role, department: row.department, employeeNo: row.employeeNo,
      effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, status: row.status, reason: row.reason } : { role: "employee", status: "active" });
    setEmployeeEditorOpen(true);
  };
  useEffect(() => {
    if (drawer === "corporate") corporateForm.resetFields();
    if (drawer === "grant") grantForm.resetFields();
    if (invoiceEditorOpen) invoiceForm.resetFields();
    if (contractEditorOpen) contractForm.resetFields();
    if (employeeEditorOpen) employeeForm.resetFields();
    if (creditBaseline) creditForm.resetFields();
    setDrawer(undefined); setEditTarget(undefined); setInvoiceTarget(undefined); setContractTarget(undefined); setRevokeTarget(undefined);
    setInvoiceEditorOpen(false); setContractEditorOpen(false); setEmployeeEditorOpen(false); setEmployeeTarget(undefined); setGrantTab("edit");
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
  const corporateBusy = saveCorporate.isPending || grant.isPending || revoke.isPending;
  const grantUnavailable = !canGrant || selected?.membershipStatus !== "active" || plans.isPending || scopeOptions.isPending || plans.isError || scopeOptions.isError;
  const eligiblePeople = (personal.data ?? []).filter(item => item.membershipStatus === "active");
  const employeeUnavailable = !canEmployeeManage || personal.isPending || personal.isError || selected?.membershipStatus !== "active"
    || Boolean(employeeTarget && !eligiblePeople.some(item => item.customerId === employeeTarget.personalCustomerId));

  const corporatePanels = [
        { key: "profile", label: t("企业资料"), children: <>
          {selected?.membershipStatus === "pending_activation" && <Alert type="warning" showIcon title={t("企业会员待审核")}
            description={t("企业必须完成主体资料人工审核后才能添加员工、获得企业权益或用于下单。个人会员自动审核设置不影响企业审核。")} style={{ marginBottom: 16 }} />}
      <Form name="corporate-profile" form={corporateForm} layout="vertical" disabled={!canManage || saveCorporate.isPending} onFinish={(values) => canManage && saveCorporate.mutate(values)}>
            <Form.Item name="corporateName" label={t("企业法定名称")} rules={[{ required: true, whitespace: true }]}><Input maxLength={180} /></Form.Item>
            <Form.Item name="unifiedSocialCreditCode" label={t("统一社会信用代码")}
              rules={!editTarget || !editTarget.corporateProfile ? [{ required: true, whitespace: true }] : []}
              extra={editTarget?.corporateProfile
                ? `${t("当前已保存")}：${editTarget.corporateProfile.unifiedSocialCreditCodeMasked} · ${t("留空保持不变")}`
                : t("该历史企业尚未完成结构化资料迁移，请核对并填写有效代码；仅后台保存原值，列表和审核历史只显示掩码。")}>
              <Input maxLength={18} autoComplete="off" placeholder={editTarget?.corporateProfile ? t("留空保持现有代码") : undefined} />
            </Form.Item>
            <Form.Item name="registeredAddress" label={t("注册地址")}><Input maxLength={500} /></Form.Item>
            <Row gutter={16}>
              <Col xs={24} sm={12}><Form.Item name="legalRepName" label={t("法定代表人")}><Input maxLength={120} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="legalRepPhone" label={t("法定代表人联系电话")}
                extra={editTarget?.corporateProfile?.legalRepPhoneMasked ? `${t("当前已保存")}：${editTarget.corporateProfile.legalRepPhoneMasked} · ${t("留空保持不变")}` : undefined}>
                <Input maxLength={40} autoComplete="off" />
              </Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="industry" label={t("所属行业")}><Input maxLength={120} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="scale" label={t("企业规模")}><Select allowClear options={[
                { value: "1-10", label: t("1-10人") }, { value: "11-50", label: t("11-50人") },
                { value: "51-200", label: t("51-200人") }, { value: "200+", label: t("200人以上") }
              ]} /></Form.Item></Col>
            </Row>
            <Form.Item name="name" label={t("联系人/简称")} rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
            <Form.Item name="phone" label={t("联系电话")} rules={!editTarget ? [{ required: true, whitespace: true }] : []}
              extra={editTarget ? t("为保护登录标识，现有号码不回显；留空保持不变") : undefined}>
              <Input maxLength={40} autoComplete="off" />
            </Form.Item>
            <Form.Item name="email" label={t("邮箱")}><Input maxLength={160} /></Form.Item>
            {editTarget && <Form.Item name="clearEmail" valuePropName="checked"><Checkbox>{t("清除已保存邮箱")}</Checkbox></Form.Item>}
          </Form>
        </> },
        { key: "invoice", label: t("开票资料"), disabled: !selected, children: <QueryState loading={invoiceProfiles.isLoading} error={invoiceProfiles.error} onRetry={() => invoiceProfiles.refetch({ throwOnError: true })}>
          <ListSection controls={<Button disabled={!canManage} onClick={() => openInvoice()}>{t("新增开票资料")}</Button>}>
          <Table<CustomerCorporateInvoiceProfile> rowKey="id" size="small" onRefresh={() => invoiceProfiles.refetch()} loading={invoiceProfiles.isLoading} refreshing={invoiceProfiles.isFetching} dataSource={invoiceProfiles.data ?? []} pagination={false} scroll={{ x: 720 }} columns={[
            { title: t("开票抬头"), dataIndex: "title" },
            { title: t("类型"), render: (_, row) => row.invoiceType === "vat_special" ? t("增值税专用发票") : t("增值税普通发票") },
            { title: t("税号"), dataIndex: "taxNo" },
            { title: t("默认"), dataIndex: "isDefault", render: (value) => value ? t("是") : "—" },
            { title: t("状态"), dataIndex: "status", render: (value) => value === "active" ? t("启用") : t("停用") },
            { title: t("操作"), render: (_, row) => <Button type="link" disabled={!canManage} onClick={() => openInvoice(row)}>{t("编辑")}</Button> }
          ]} /></ListSection>
          <Modal presentation="side" title={t(invoiceTarget ? "编辑开票资料" : "新增开票资料")} width={640} open={invoiceDialog.visible} onCancel={invoiceDialog.dismiss} afterClose={invoiceDialog.afterClose} destroyOnHidden
            closable={!saveInvoice.isPending} keyboard={!saveInvoice.isPending} maskClosable={!saveInvoice.isPending}
            footer={<><Button disabled={saveInvoice.isPending} onClick={invoiceDialog.dismiss}>{t("取消")}</Button><SaveButton disabled={!canManage || !selected || invoiceProfiles.isError} label={t("保存开票资料")} form={invoiceForm} pending={saveInvoice.isPending} onSave={async values => { const operation = canManage && selected && saveInvoice.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} /></>}>
          <p>{selected?.corporateName ?? selected?.name}</p>
          {invoiceTarget && <Alert type="info" showIcon title={t("敏感资料保护")}
            description={`${t("银行账号")}：${invoiceTarget.bankAccountMasked ?? t("未设置")}；${t("联系电话")}：${invoiceTarget.contactPhoneMasked ?? t("未设置")}。${t("不回显原值；留空为保留，勾选清除才会删除。")}`} style={{ margin: "16px 0" }} />}
          <Form name="corporate-invoice" form={invoiceForm} layout="vertical" disabled={!canManage || saveInvoice.isPending} onFinish={(values) => canManage && selected && saveInvoice.mutate(values)}>
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
          </Form></Modal>
        </QueryState> },
        { key: "contracts", label: t("企业合同"), disabled: !selected, children: <QueryState loading={contracts.isLoading} error={contracts.error} onRetry={() => contracts.refetch({ throwOnError: true })}>
          <ListSection controls={<Button disabled={!canManage} onClick={() => openContract()}>{t("新增合同")}</Button>}>
          <Table<CustomerCorporateContract> rowKey="id" size="small" onRefresh={() => contracts.refetch()} loading={contracts.isLoading} refreshing={contracts.isFetching} dataSource={contracts.data ?? []} pagination={false} scroll={{ x: 760 }} columns={[
            { title: t("合同编号"), dataIndex: "contractNo" }, { title: t("合同名称"), dataIndex: "name" },
            { title: t("有效期"), render: (_, row) => `${row.effectiveFrom.slice(0, 10)} ~ ${row.effectiveTo?.slice(0, 10) ?? t("长期")}` },
            { title: t("状态"), dataIndex: "status", render: (value: string) => t(({ draft: "草稿", active: "生效", expired: "已到期", terminated: "已终止" } as Record<string, string>)[value] ?? value) },
            { title: t("操作"), render: (_, row) => <Button type="link" disabled={!canManage} onClick={() => openContract(row)}>{t("编辑")}</Button> }
          ]} /></ListSection>
          <Modal presentation="side" title={t(contractTarget ? "编辑企业合同" : "新增合同")} width={640} open={contractDialog.visible} onCancel={contractDialog.dismiss} afterClose={contractDialog.afterClose} destroyOnHidden
            closable={!saveContract.isPending} keyboard={!saveContract.isPending} maskClosable={!saveContract.isPending}
            footer={<><Button disabled={saveContract.isPending} onClick={contractDialog.dismiss}>{t("取消")}</Button><SaveButton disabled={!canManage || !selected || contracts.isError} label={t("保存合同")} form={contractForm} pending={saveContract.isPending} onSave={async values => { const operation = canManage && selected && saveContract.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} /></>}>
          <p>{selected?.corporateName ?? selected?.name}</p>
          <Form name="corporate-contract" form={contractForm} layout="vertical" disabled={!canManage || saveContract.isPending} onFinish={(values) => canManage && selected && saveContract.mutate(values)}>
            <Form.Item name="contractNo" label={t("合同编号")} rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
            <Form.Item name="name" label={t("合同名称")} rules={[{ required: true, whitespace: true }]}><Input maxLength={180} /></Form.Item>
            <Form.Item {...dateOnlyBinding} name="signedAt" label={t("签署时间")}><DatePicker /></Form.Item>
            <Row gutter={16}>
              <Col xs={24} sm={12}><Form.Item {...dateOnlyBinding} name="effectiveFrom" label={t("生效时间")} rules={[{ required: true }]}><DatePicker /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item {...dateOnlyBinding} name="effectiveTo" label={t("失效时间")}><DatePicker /></Form.Item></Col>
            </Row>
            <Form.Item name="status" label={t("合同状态")}><Select options={[
              { value: "draft", label: t("草稿") }, { value: "active", label: t("生效") },
              { value: "expired", label: t("已到期") }, { value: "terminated", label: t("已终止") }
            ]} /></Form.Item>
            <Form.Item name="fileRef" label={t("合同文件引用")}><Input maxLength={191} /></Form.Item>
            <Form.Item name="terminatedReason" label={t("终止原因")}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
          </Form></Modal>
        </QueryState> }
      ];
  const employeesPanel = <QueryState loading={employees.isLoading} error={employees.error} onRetry={() => employees.refetch({ throwOnError: true })}>
        <Alert type="info" showIcon title={t("企业成员关系在租户内共享")} description={t("仅可选择租户内的有效个人会员。暂停或退出员工关系后，该个人在租户全部空间均不可再使用此企业身份下单，不会注销其个人会员。")} style={{ marginBottom: 16 }} />
        <Modal presentation="side" title={t(employeeTarget ? "编辑企业成员" : "添加成员")} width={640} open={employeeDialog.visible} onCancel={employeeDialog.dismiss} afterClose={employeeDialog.afterClose} destroyOnHidden
          closable={!saveEmployee.isPending} keyboard={!saveEmployee.isPending} maskClosable={!saveEmployee.isPending}
          footer={<><Button disabled={saveEmployee.isPending} onClick={employeeDialog.dismiss}>{t("取消")}</Button><SaveButton disabled={employeeUnavailable} label={t("保存成员关系")} form={employeeForm} pending={saveEmployee.isPending} onSave={async values => { const operation = !employeeUnavailable && saveEmployee.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} /></>}>
        <p>{selected?.corporateName ?? selected?.name}</p>
        <QueryState loading={personal.isLoading} error={personal.error} onRetry={() => personal.refetch({ throwOnError: true })}>
        {employeeTarget && !personal.isPending && !eligiblePeople.some(item => item.customerId === employeeTarget.personalCustomerId) && <Alert type="warning" showIcon title={t("当前成员不在可选会员中，请先核对个人会员状态")} />}
        <Form name="corporate-employee" form={employeeForm} layout="vertical" disabled={employeeUnavailable || saveEmployee.isPending} onFinish={(values) => !employeeUnavailable && saveEmployee.mutate(values)}>
          <Form.Item name="personalCustomerId" label={t("租户有效个人会员")} rules={[{ required: true }]}><Select disabled={employeeUnavailable || Boolean(employeeTarget) || saveEmployee.isPending} showSearch={{ optionFilterProp: "label" }} onChange={value => {
            const existing = employees.data?.find(row => row.personalCustomerId === value);
            if (existing) openEmployeeEditor(existing);
          }} options={[
            ...eligiblePeople.map((item) => ({ value: item.customerId, label: `${item.name} · ${item.phoneMasked}` })),
            ...(employeeTarget && !eligiblePeople.some(item => item.customerId === employeeTarget.personalCustomerId) ? [{ value: employeeTarget.personalCustomerId, label: employeeTarget.personalCustomerName ?? employeeTarget.personalCustomerId, disabled: true }] : []),
          ]} /></Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item name="role" label={t("企业角色")} rules={[{ required: true }]}><Select options={[{ value: "admin", label: t("企业管理员") }, { value: "employee", label: t("企业员工") }]} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="department" label={t("部门")}><Input maxLength={120} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="employeeNo" label={t("员工号")}><Input maxLength={80} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="status" label={t("关系状态")}><Select options={Object.entries(relationMeta).map(([value, meta]) => ({ value, label: t(meta.text) }))} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item {...dateTimeBinding} name="effectiveFrom" label={t("生效时间")} extra={t("留空为现在")}><DatePicker showTime /></Form.Item></Col>
            {/* The existing upsert omits an empty end date; it cannot clear a saved expiry. */}
            <Col xs={24} sm={12}><Form.Item {...dateTimeBinding} name="effectiveTo" label={t("失效时间")} extra={t(employeeTarget?.effectiveTo ? "已有失效时间可调整，暂不能清空" : "留空为长期有效")}><DatePicker showTime allowClear={!employeeTarget?.effectiveTo} /></Form.Item></Col>
          </Row>
          <Form.Item name="reason" label={t("说明")}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
        </Form></QueryState></Modal>
        <ListSection title={t("管理员与员工")} controls={<ListFilters filter={employeeFilter} placeholder="成员姓名、部门或工号" options={Object.entries(relationMeta).map(([value, meta]) => ({ value, label: meta.text }))} />}
          extra={<Space wrap><LiveRefresh enabled={employeeLive.enabled} onChange={employeeLive.setEnabled} busy={employees.isFetching} updatedAt={employees.dataUpdatedAt} paused={Boolean(drawer || employeeEditorOpen)} />{canEmployeeManage && <Button type="primary" disabled={selected?.membershipStatus !== "active" || saveEmployee.isPending} onClick={() => openEmployeeEditor()}>{t("添加成员")}</Button>}</Space>}><Table<CustomerCorporateMembership> rowKey="id" size="small" loading={employees.isLoading} refreshing={employees.isFetching} onRefresh={() => employees.refetch()} dataSource={employeeFilter.rows} pagination={employeeFilter.pagination} emptyScene={employeeFilter.keyword || employeeFilter.status ? "search" : "empty"} columns={[
          { title: t("个人会员"), dataIndex: "personalCustomerName", render: (_, row) => <CustomerPreview presentation="list" secondary={row.employeeNo || undefined} customerId={row.personalCustomerId} name={row.personalCustomerName ?? "—"} type="personal" /> },
          { title: t("角色"), dataIndex: "role", render: (value) => value === "admin" ? t("企业管理员") : t("企业员工") },
          { title: t("部门"), dataIndex: "department", render: (value) => value ?? "—" },
          { title: t("有效期"), render: (_, row) => <DataTableText primary={localDateTime(row.effectiveFrom)} secondary={row.effectiveTo ? `– ${localDateTime(row.effectiveTo)}` : t("长期")} /> },
          { title: t("状态"), render: (_, row) => <Tag color={relationMeta[row.status].color}>{t(relationMeta[row.status].text)}</Tag> },
          { title: t("操作"), render: (_, row) => <Button type="text" disabled={!canEmployeeManage || selected?.membershipStatus !== "active" || saveEmployee.isPending} onClick={() => openEmployeeEditor(row)}>{t("编辑")}</Button> },
        ]} /></ListSection>
      </QueryState>;
  const creditPanel = <QueryState loading={creditConfig.isLoading} error={creditConfig.error} onRetry={() => creditConfig.refetch({ throwOnError: true })}>
        <Alert type="info" showIcon title={t("企业授信是租户级额度；押金与预授权仍独立处理。")}
          description={t("账期订单确认时占用授信，订单结算后形成应收。调整额度必须填写原因；已有占用或应收未处理前不能把额度调低。")}
          style={{ marginBottom: 16 }} />
        {!creditConfig.data && <p className="muted">{t("尚未配置授信与账期")}</p>}
     {creditConfig.data && <QueryState loading={creditAccount.isLoading || creditLedger.isLoading} error={creditAccount.error ?? creditLedger.error} onRetry={() => Promise.all([creditAccount.refetch({ throwOnError: true }), creditLedger.refetch({ throwOnError: true })])}>
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
            {reversalBlocked && <Alert type="warning" showIcon title={t("无法可靠保存原操作引用，暂不能发起冲销")} />}
            {reversalReference && <Alert type="warning" showIcon title={t("原冲销操作待核对，不能重新提交")}
              action={<ActionButton label={t("读取原冲销收据")} onAction={observeReversal} />} />}
            <ListSection title={t("授信账务流水")} style={{ marginTop: "var(--rental-layout-section-gap)" }}>
              <Table<CustomerCorporateCreditLedgerEntry> rowKey="id" size="small" onRefresh={() => creditLedger.refetch()} loading={creditLedger.isLoading} refreshing={creditLedger.isFetching} dataSource={creditLedger.data ?? []} pagination={{ defaultPageSize: 20 }} scroll={{ x: 960 }} columns={[
                { title: t("发生时间"), dataIndex: "occurredAt", render: (value: string) => new Date(value).toLocaleString(locale) },
                { title: t("业务类型"), dataIndex: "entryType", render: (value: CustomerCorporateCreditLedgerEntry["entryType"]) => t(creditEntryLabel[value]) },
                { title: t("发生金额"), render: (_: unknown, row: CustomerCorporateCreditLedgerEntry) => formatRentalMoney(row.amount, row.currency) },
                { title: t("占用变化"), render: (_: unknown, row: CustomerCorporateCreditLedgerEntry) => formatRentalMoney(row.reservedDelta, row.currency) },
                { title: t("应收变化"), render: (_: unknown, row: CustomerCorporateCreditLedgerEntry) => formatRentalMoney(row.receivableDelta, row.currency) },
                { title: t("订单"), dataIndex: "orderId", render: (value?: string) => value || "—" },
                { title: t("原因"), dataIndex: "reason" },
                { title: t("操作人"), dataIndex: "operator", render: (value?: string) => value || "—" },
                { title: t("操作"), key: "actions", render: (_: unknown, row: CustomerCorporateCreditLedgerEntry) =>
                  row.entryType === "payment" && <Button type="link" disabled={!canReversePayment || reversalBlocked || Boolean(reversalReference) || reversePayment.isPending}
                    onClick={() => { setReversalTarget(row); reversalForm.resetFields(); }}>{t("冲销回款")}</Button> }
              ]} />
            </ListSection>
          </>}
        </QueryState>}
      <details className={recordStyles.disclosure}><summary>{t("授信与账期配置")}</summary>
          {creditDraftChanged && <Alert type="warning" showIcon title={t("资料已变更，请刷新后重新选择")} />}
          <Form name="corporate-credit" form={creditForm} layout="vertical" disabled={!canManage || saveCredit.isPending} onFinish={saveCreditDraft}>
            <Row gutter={16}>
              <Col xs={24} sm={12}><Form.Item name="creditLimit" label={t("授信额度（元）")} rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="settlementTermDays" label={t("账期天数")} rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="billingCycle" label={t("账单周期")} rules={[{ required: true }]}><Select options={Object.entries(creditCycleLabel).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item name="status" label={t("授信状态")} rules={[{ required: true }]}><Select options={Object.entries(creditStatusLabel).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item></Col>
            </Row>
            <Form.Item name="reason" label={t("变更原因")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
            <Space wrap>
              <SaveButton disabled={!canManage || !creditBaseline || creditBaseline.scope !== creditScope || creditBaseline.customerId !== selected?.customerId} label={t("保存授信配置")} form={creditForm} pending={saveCredit.isPending} onSave={saveCreditDraft} />
              <Button disabled={!creditConfig.isSuccess || saveCredit.isPending} onClick={() => {
                if (creditConfig.data !== undefined) loadCreditDraft(creditConfig.data);
              }}>{t("重新载入并放弃当前输入")}</Button>
            </Space>
          </Form>
   </details></QueryState>;
  if (!canView) return <Alert type="warning" showIcon title={t("无权查看租户统一企业会员")} description={t("需要租户级企业会员查看、管理或员工管理权限，且数据范围为全部。")} />;

  return <QueryState loading={corporates.isLoading} error={corporates.error} onRetry={() => corporates.refetch({ throwOnError: true })}>
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
        { title: t("创建时间"), dataIndex: "createdAt", render: (value) => new Date(value).toLocaleDateString(locale) },
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
      {!selected ? <Alert type="warning" showIcon title={t("未找到企业资料")} /> : <Tabs aria-label={t("企业资料")} destroyOnHidden={false} activeKey={corporateTab} onChange={setCorporateTab} items={[
        { key: "analysis", label: t("客户分析"), children: <CustomerAnalysisReader customerId={selected.customerId} /> },
        { key: "profile", label: t("企业资料"), children: <RecordFacts items={[
          { key: "legal", label: "企业法定名称", value: selected.corporateProfile?.legalName ?? selected.corporateName ?? selected.name, wide: true },
          { key: "tax", label: "统一社会信用代码", value: selected.corporateProfile?.unifiedSocialCreditCodeMasked || "—" },
          { key: "rep", label: "法定代表人", value: selected.corporateProfile?.legalRepName || "—" },
          { key: "repPhone", label: "法定代表人联系电话", value: selected.corporateProfile?.legalRepPhoneMasked || "—" },
          { key: "email", label: "邮箱", value: selected.email || "—", wide: true },
          { key: "address", label: "注册地址", value: selected.corporateProfile?.registeredAddress || "—", wide: true },
          { key: "industry", label: "所属行业", value: selected.corporateProfile?.industry ? t((CUSTOMER_CORPORATE_INDUSTRY_LABELS as Record<string, string>)[selected.corporateProfile.industry] ?? selected.corporateProfile.industry) : "—" },
          { key: "scale", label: "企业规模", value: selected.corporateProfile?.scale || "—" },
          { key: "created", label: "创建时间", value: new Date(selected.createdAt).toLocaleString(locale) }
        ]} /> },
        { key: "employees", label: t("管理员与员工"), children: employeesPanel },
        corporatePanels[1], corporatePanels[2],
        ...(canViewCredit ? [{ key: "credit", label: t("授信账务"), children: creditPanel }] : [])
      ]} />}
    </RecordDetailLayout>}

    <Modal presentation="side" title={drawer === "grant" ? t("授予企业会员方案") : editTarget ? t("编辑企业会员") : t("新增企业会员")} width={640} open={corporateDialog.visible} onCancel={corporateDialog.dismiss} afterClose={corporateDialog.afterClose} destroyOnHidden
      closable={!corporateBusy} keyboard={!corporateBusy} maskClosable={!corporateBusy}
      footer={<><Button disabled={corporateBusy} onClick={corporateDialog.dismiss}>{t("取消")}</Button>{drawer === "corporate" ?
        <SaveButton disabled={!canManage} label={t("保存企业资料")} form={corporateForm} pending={saveCorporate.isPending} onSave={async values => { const operation = canManage && saveCorporate.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} />
        : drawer === "grant" && grantTab === "edit" ? <SaveButton disabled={grantUnavailable} label={t("确认授予")} form={grantForm} pending={grant.isPending} onSave={async values => { const operation = !grantUnavailable && grant.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} /> : null}</>}>
      {drawer === "corporate" && corporatePanels[0].children}

      {drawer === "grant" && <><p>{selected?.corporateName ?? selected?.name}</p><Tabs aria-label={t("方案授予")} destroyOnHidden={false} activeKey={grantTab} onChange={key => { if (!corporateBusy) setGrantTab(key); }} items={[
        { key: "edit", label: t("授予方案"), children: <QueryState loading={plans.isLoading || scopeOptions.isLoading} error={plans.error ?? scopeOptions.error} onRetry={() => Promise.all([plans.refetch({ throwOnError: true }), scopeOptions.refetch({ throwOnError: true })])}>
        <Form name="corporate-plan-grant" form={grantForm} layout="vertical" disabled={grantUnavailable || corporateBusy} onFinish={(values) => canGrant && grant.mutate(values)}>
          <Form.Item name="planVersionId" label={t("已发布企业方案")} rules={[{ required: true }]}><Select options={(plans.data ?? []).flatMap((plan) => plan.targetType === "corporate" ? (plan.versions ?? []).filter((version) => version.status === "published").map((version) => ({ value: version.id, label: `${plan.name} · v${version.version}` })) : [])} /></Form.Item>
          {selectedPlanVersion && <Alert type="info" showIcon title={t("本次授予的权益适用范围")} description={<MembershipBenefitScopeSummary benefits={selectedPlanVersion.benefits} options={scopeOptions.data} />} style={{ marginBottom: 16 }} />}
          <Form.Item name="source" label={t("授予来源")} rules={[{ required: true }]}><Select options={[{ value: "manual", label: t("后台人工授予") }, { value: "corporate_contract", label: t("企业合同授予") }]} /></Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item {...dateTimeBinding} name="effectiveFrom" label={t("生效时间")} extra={t("留空为提交时生效")}><DatePicker showTime /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item {...dateTimeBinding} name="effectiveTo" label={t("失效时间")} extra={t("留空为长期有效")}><DatePicker showTime /></Form.Item></Col>
          </Row>
          <Form.Item name="reason" label={t("授予原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
        </QueryState> },
        { key: "history", label: t("当前方案授予记录"), children: <QueryState loading={assignments.isLoading} error={assignments.error} onRetry={() => assignments.refetch({ throwOnError: true })}><ListSection>
          <Table<CustomerMembershipPlanAssignment> rowKey="id" size="small" loading={assignments.isLoading} refreshing={assignments.isFetching} onRefresh={() => assignments.refetch()} dataSource={assignments.data ?? []} pagination={false} scroll={{ x: 750 }} columns={[
            { title: t("方案"), render: (_, row) => row.snapshot.planName },
            { title: t("权益适用范围"), render: (_, row) => <MembershipBenefitScopeSummary benefits={row.snapshot.benefits} options={scopeOptions.data} /> },
            { title: t("有效期"), render: (_, row) => <DataTableText primary={localDateTime(row.effectiveFrom)} secondary={row.effectiveTo ? `– ${localDateTime(row.effectiveTo)}` : t("长期")} /> },
            { title: t("状态"), render: (_, row) => <Tag color={row.status === "active" ? "success" : row.status === "expired" ? "warning" : "default"}>{row.status === "active" ? t("有效") : row.status === "expired" ? t("已过期") : t("已撤销")}</Tag> },
            { title: t("操作"), render: (_, row) => row.status === "active" && <Button type="link" disabled={!canGrant || corporateBusy || assignments.isError} onClick={() => { setRevokeTarget(row); revokeForm.resetFields(); }}>{t("撤销")}</Button> },
          ]} />
        </ListSection></QueryState> }
      ]} /></>}

    </Modal>
    <Drawer presentation="dialog" title={t("冲销原企业回款")} size={520} open={Boolean(reversalTarget)}
      onClose={() => { if (!reversePayment.isPending) { setReversalTarget(undefined); reversalForm.resetFields(); } }} destroyOnHidden>
      <Alert type="warning" showIcon title={t("冲销将恢复原订单应收，不会发起资金退款；原回款与核销记录保留。")} />
      <p>{reversalTarget && formatRentalMoney(reversalTarget.amount, reversalTarget.currency)}</p>
      <Form form={reversalForm} layout="vertical" disabled={!canReversePayment || reversePayment.isPending || Boolean(reversalReference)}>
        <Form.Item name="basisRef" label={t("冲销依据引用")} rules={[{ required: true, whitespace: true, max: 191 }]}><Input /></Form.Item>
        <Form.Item name="reason" label={t("冲销原因")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={3} /></Form.Item>
        <ConfirmAction label={t("冲销回款")} prompt={t("确认按原回款完整冲销并恢复订单应收？")}
          disabled={!canReversePayment || reversePayment.isPending || Boolean(reversalReference) || reversalBlocked}
          onConfirm={async () => submitReversal(await reversalForm.validateFields())} />
      </Form>
    </Drawer>
    <Modal title={`${t("撤销会员方案")}: ${revokeTarget?.snapshot.planName ?? ""}`} width={520} open={revokeDialog.visible} onCancel={revokeDialog.dismiss} afterClose={revokeDialog.afterClose} destroyOnHidden
      closable={!revoke.isPending} keyboard={!revoke.isPending} maskClosable={!revoke.isPending} cancelButtonProps={{ disabled: revoke.isPending }} confirmLoading={revoke.isPending} okText={t("确认撤销")} okButtonProps={{ disabled: !canGrant || !revokeTarget }}
      onConfirm={() => revokeForm.validateFields().then(values => canGrant && revokeTarget ? revoke.mutateAsync({ assignmentId: revokeTarget.id, reason: values.reason }) : Promise.reject(new Error("Operation unavailable")))}>
      <Form name="corporate-plan-revoke" form={revokeForm} layout="vertical" disabled={!canGrant || revoke.isPending} onFinish={(values) => canGrant && revokeTarget && revoke.mutate({ assignmentId: revokeTarget.id, reason: values.reason })}>
        <Form.Item name="reason" label={t("撤销原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} /></Form.Item>
      </Form>
    </Modal>
  </QueryState>;
}
