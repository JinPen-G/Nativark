/** Corporate proposals are review-only. Freeze original material before async validation;
 * the server owns authorization, revision checks, file ACL and actual business changes. */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { parseEnterpriseRoute } from "@rental-os/web-client";
import { ENTERPRISE_REVIEW_REQUEST_TYPES, RENTAL_CURRENCY_CODES, type EnterpriseManagementRequestType, type EnterpriseManagementRequestView, type EnterprisePaymentProofBasis, type EnterpriseProfileView, type SaveEnterpriseManagementRequest } from "@rental-os/shared";
import { ActionButton, Alert, Button, ConfirmAction, Form, Input, SaveButton, Select, Table } from "@/components/ui/customer-entry";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
import { AuthorityUpload } from "./AuthorityUpload";
import { copyEnterpriseManagementRequest as copyRequest } from "@/components/enterprise-management-material";
import { EnterpriseMemberOperationRecovery } from "./MemberOperationRecovery";
import { EnterpriseManagementRequestFeedback, managementRequestStateLabel } from "./ManagementRequestFeedback";
type Values = { legalName?: string; registeredAddress?: string; email?: string; requestedCreditLimit?: string; currency?: string; workspaces?: string; categories?: string; orderId?: string; reportedAmount?: string; reason: string; evidence: string[] };
const types = ENTERPRISE_REVIEW_REQUEST_TYPES;
const valueFields = ["legalName", "registeredAddress", "email", "requestedCreditLimit", "currency", "workspaces", "categories", "orderId", "reportedAmount", "reason", "evidence"] as const;
const unavailableTypes: EnterpriseProfileView["unavailable"] = ["formal_bills", "payment_proof", "bill_dispute", "contract_files"];
const unavailable = () => new Error("原申请材料或输入已变化，请重新核对 / Original request material or input changed; review again");
const textValue = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const reference = (value: unknown): value is string => textValue(value, 191) && /^[a-zA-Z0-9_-]+$/u.test(value);
const references = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every(reference);
const revisionOf = (view: EnterpriseProfileView, type: EnterpriseManagementRequestType, paymentBasis?: EnterprisePaymentProofBasis) => type === "payment_proof" ? paymentBasis?.objectRevision : type === "profile_change" ? view.profileRevision : type === "credit_change"
  ? view.creditRevision === null ? undefined : String(view.creditRevision) : String(view.merchantPolicyRevision);
function copyPaymentBasis(value: EnterprisePaymentProofBasis | undefined, corporateId: string, orderId: unknown, workspaceCode: string | undefined, permissionRevision: string | undefined): EnterprisePaymentProofBasis | undefined {
  if (!value) return undefined;
  if (value.corporateCustomerId !== corporateId || value.orderId !== orderId || !/^[a-zA-Z0-9._:-]{1,191}$/u.test(value.orderId)
    || !/^[a-zA-Z0-9._:-]{1,191}$/u.test(value.workspaceId) || value.workspaceCode !== workspaceCode || value.permissionRevision !== permissionRevision
    || !RENTAL_CURRENCY_CODES.some(code => code === value.currency) || value.source !== "original_enterprise_paid_order" || value.purpose !== "rental_fee"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.objectRevision) || !Number.isFinite(Date.parse(value.objectRevision))) throw unavailable();
  return { corporateCustomerId: value.corporateCustomerId, orderId: value.orderId, workspaceId: value.workspaceId, workspaceCode: value.workspaceCode,
    currency: value.currency, objectRevision: value.objectRevision, permissionRevision: value.permissionRevision, source: value.source, purpose: value.purpose };
}
function copyProfile(value: EnterpriseProfileView | undefined, corporateId: string): EnterpriseProfileView | undefined {
  if (!value) return undefined;
  if (value.corporateCustomerId !== corporateId || !reference(corporateId) || !textValue(value.corporateName, 191)
    || !textValue(value.profileRevision, 191) || !value.profileRevision.trim() || !textValue(value.membershipStatus, 32)
    || ![value.creditRevision, value.merchantPolicyRevision].every((revision, index) => index === 0 && revision === null || typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0)
    || !Array.isArray(value.requestTypes) || value.requestTypes.length > types.length || new Set(value.requestTypes).size !== value.requestTypes.length || value.requestTypes.some(type => !types.includes(type))
    || !Array.isArray(value.unavailable) || value.unavailable.length > 4 || new Set(value.unavailable).size !== value.unavailable.length || value.unavailable.some(type => !unavailableTypes.includes(type))
    || ![value.legalName, value.legalIdentifierMasked].every(field => field === null || textValue(field, 191))
    || value.registeredAddress !== null && !textValue(value.registeredAddress, 1000)) throw unavailable();
  return { corporateCustomerId: value.corporateCustomerId, corporateName: value.corporateName, legalName: value.legalName, legalIdentifierMasked: value.legalIdentifierMasked,
    registeredAddress: value.registeredAddress, membershipStatus: value.membershipStatus, profileRevision: value.profileRevision, creditRevision: value.creditRevision,
    merchantPolicyRevision: value.merchantPolicyRevision, requestTypes: [...value.requestTypes], unavailable: [...value.unavailable] };
}
function copyInput(value: Values): Values {
  const result = {} as Values;
  for (const key of valueFields) {
    const field = value[key];
    if (key === "evidence") { if (field !== undefined && !references(field, 10)) throw unavailable(); result.evidence = [...(field as string[] | undefined ?? [])]; }
    else if (field !== undefined) {
      if (!textValue(field, key === "registeredAddress" ? 1000 : key === "reason" ? 500 : key === "workspaces" || key === "categories" ? 40000 : 191)) throw unavailable();
      Object.assign(result, { [key]: field });
    }
  }
  if (!result.reason?.trim()) throw unavailable();
  return result;
}
type Reviewed = { scope: string; type: EnterpriseManagementRequestType; revision: string; basisRevision: string; profileKey: string; paymentBasis?: EnterprisePaymentProofBasis; paymentKey?: string };
type Editing = { scope: string; value: EnterpriseManagementRequestView; key: string; source?: "detail" };
export function EnterpriseManagementRequestsPage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US", location = useLocation();
  const requestIds = new URLSearchParams(location.search).getAll("requestId"), requestedId = requestIds.length === 1 ? requestIds[0] : requestIds.length > 1 ? "" : undefined;
  const locatedOrders = new URLSearchParams(location.search).getAll("orderId"), locatedOrder = locatedOrders.length === 1 && /^[a-zA-Z0-9._:-]{1,191}$/u.test(locatedOrders[0]) ? locatedOrders[0] : undefined;
  const [type, setType] = useState<EnterpriseManagementRequestType>("profile_change"), [editing, setEditing] = useState<Editing>(), [fileBusy, setFileBusy] = useState(false);
  const [reviewed, setReviewed] = useState<Reviewed>();
  const withdrawalReviews = useRef(new Map<string, Editing>());
  const [withdrawal, setWithdrawal] = useState<{ identity: string; id: string; revision: number }>();
  const [form] = Form.useForm<Values>(), operation = useOriginalWorkflowOperation("management-requests"), queries = useQueryClient();
  const paymentOrderId = Form.useWatch("orderId", form);
  const path = `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/management-requests`, scope = JSON.stringify([context.identity, context.selectedCorporateId, path]);
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === context.selectedCorporateId);
  const permitted = Boolean(corporate?.actions.includes("requests:manage"));
  const profile = useQuery({ queryKey: ["enterprise-profile", context.identity], enabled: Boolean(corporate), queryFn: ({ signal }) => operation.read<EnterpriseProfileView>(`/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/profile`, signal) });
  const list = useQuery({ queryKey: ["enterprise-management-requests", context.identity], queryFn: ({ signal }) => operation.read<EnterpriseManagementRequestView[]>("/enterprise/management-requests", signal) });
  const paymentAllowed = Boolean(permitted && corporate?.actions.includes("orders:read") && corporate.actions.includes("finance:read") && context.session?.workspace);
  const paymentBasis = useQuery({ queryKey: ["enterprise-payment-proof-basis", scope, paymentOrderId], retry: false,
    enabled: type === "payment_proof" && paymentAllowed && typeof paymentOrderId === "string" && /^[a-zA-Z0-9._:-]{1,191}$/u.test(paymentOrderId),
    queryFn: async ({ signal }) => {
      operation.assertCurrent();
      if (typeof paymentOrderId !== "string" || !/^[a-zA-Z0-9._:-]{1,191}$/u.test(paymentOrderId)) throw unavailable();
      const result = await operation.read<EnterprisePaymentProofBasis>(`/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/orders/${encodeURIComponent(paymentOrderId)}/payment-proof-basis`, signal);
      operation.assertCurrent();
      return copyPaymentBasis(result, context.selectedCorporateId, paymentOrderId, context.session?.workspace?.workspaceCode, corporate?.permissionRevision)!;
    } });
  let profileView: EnterpriseProfileView | undefined, proofView: EnterprisePaymentProofBasis | undefined, materialError = false;
  try { profileView = copyProfile(profile.data, context.selectedCorporateId); } catch { materialError = true; }
  try { if (type === "payment_proof") proofView = copyPaymentBasis(paymentBasis.data, context.selectedCorporateId, paymentOrderId, context.session?.workspace?.workspaceCode, corporate?.permissionRevision); } catch { materialError = true; }
  const proofKey = proofView ? JSON.stringify(proofView) : "", profileKey = profileView ? JSON.stringify(profileView) : "", currentRevision = profileView ? revisionOf(profileView, type, proofView) : undefined;
  useEffect(() => { setEditing(undefined); setReviewed(undefined); withdrawalReviews.current.clear(); setWithdrawal(undefined); form.resetFields(); }, [scope]);
  useEffect(() => { if (locatedOrder && requestedId === undefined) { setType("payment_proof"); setReviewed(undefined); form.setFieldsValue({ orderId: locatedOrder }); } }, [scope, locatedOrder, requestedId]);
  useEffect(() => {
    if (currentRevision !== undefined && (!reviewed || reviewed.scope !== scope || reviewed.type !== type)) setReviewed({ scope, type, revision: currentRevision, basisRevision: currentRevision, profileKey,
      ...(type === "payment_proof" ? { paymentBasis: proofView, paymentKey: proofKey } : {}) });
  }, [scope, type, currentRevision, profileKey, reviewed, proofKey]);
  const latest = useRef({ context, scope, type, editing, reviewed, profileKey, currentRevision, profileView, profile, list, fileBusy, permitted, requestedId, proofView, proofKey, paymentBasis, paymentAllowed });
  latest.current = { context, scope, type, editing, reviewed, profileKey, currentRevision, profileView, profile, list, fileBusy, permitted, requestedId, proofView, proofKey, paymentBasis, paymentAllowed };
  const readExact = async (id: string, editable = false) => {
    operation.assertCurrent(); const value = copyRequest(await operation.read<EnterpriseManagementRequestView>(`/enterprise/management-requests/${encodeURIComponent(id)}`)); operation.assertCurrent();
    const now = latest.current;
    if (now.scope !== scope || now.requestedId !== id || value.id !== id || value.applicantCustomerId !== now.context.session?.customer.customerId
      || editable && !["draft", "supplement_required"].includes(value.state)) throw unavailable();
    return value;
  };
  const refreshExact = async (id: string, includeProfile = false) => {
    const value = await readExact(id);
    queries.setQueryData(["enterprise-management-feedback", JSON.stringify([context.identity, id])], value);
    // A person's withdrawal authority is independent of today's enterprise/profile grant.
    if (includeProfile && corporate) await profile.refetch({ throwOnError: true });
    operation.assertCurrent();
  };
  const refreshFor = async (original?: Editing) => {
    if (original?.source === "detail") await refreshExact(original.value.id, true);
    else await Promise.all([list.refetch({ throwOnError: true }), ...(corporate ? [profile.refetch({ throwOnError: true })] : [])]);
    operation.assertCurrent();
    if (latest.current.type === "payment_proof" && latest.current.proofView) await paymentBasis.refetch({ throwOnError: true });
  };
  const refresh = () => refreshFor(latest.current.editing);
  const baseBlocked = operation.blocked || fileBusy || profile.isFetching || Boolean(profile.error) || !permitted || !profileView;
  const listBlocked = baseBlocked || list.isFetching || Boolean(list.error) || !Array.isArray(list.data);
  const blocked = editing?.source === "detail" ? baseBlocked || requestedId !== editing.value.id : listBlocked;
  const proofBlocked = type === "payment_proof" && (!paymentAllowed || paymentBasis.isFetching || Boolean(paymentBasis.error) || !proofView);
  const label = (value: EnterpriseManagementRequestType) => value === "profile_change" ? english ? "Profile correction" : "资料更正" : value === "credit_change" ? english ? "Credit limit request" : "授信调整申请"
    : value === "payment_proof" ? english ? "Order rental-fee payment evidence" : "逐单费用回款凭证核对" : english ? "Rental scope request" : "使用范围调整";
  const feedbackPath = (row: EnterpriseManagementRequestView) => {
    try {
      const value = copyRequest(row), path = `${context.basePath}/profile`;
      if (!context.session || context.loading || context.signal.aborted || list.isFetching || list.error
        || value.applicantCustomerId !== context.session.customer.customerId || parseEnterpriseRoute(path)?.basePath !== context.basePath) return undefined;
      // Navigation only locates an own request; it never clears K or adopts editor input.
      return `${path}?${new URLSearchParams({ requestId: value.id })}`;
    } catch { return undefined; }
  };
  const assertOriginal = (original: Reviewed) => {
    operation.assertCurrent(); const now = latest.current, view = copyProfile(now.profile.data, now.context.selectedCorporateId);
    const authorized = now.context.entry?.corporates.find(row => row.corporateCustomerId === now.context.selectedCorporateId)?.actions.includes("requests:manage");
    const revision = view ? revisionOf(view, original.type, now.proofView) : undefined;
    if (now.scope !== scope || now.reviewed !== original || original.scope !== scope || now.type !== original.type || !authorized || now.fileBusy
      || now.profile.isFetching || now.profile.error || !view || now.editing?.source !== "detail" && (now.list.isFetching || now.list.error || !Array.isArray(now.list.data))
      || !view.requestTypes.includes(original.type) || revision === undefined
      || revision === original.basisRevision && JSON.stringify(view) !== original.profileKey) throw unavailable();
    if (original.type === "payment_proof" && (!now.paymentAllowed || now.paymentBasis.isFetching || now.paymentBasis.error || !now.proofView
      || now.proofKey !== original.paymentKey || JSON.stringify(original.paymentBasis) !== original.paymentKey || form.getFieldValue("orderId") !== original.paymentBasis?.orderId)) throw unavailable();
    if (now.editing) {
      const row = now.editing.source === "detail" ? now.requestedId === now.editing.value.id ? now.editing.value : undefined : now.list.data?.find(value => value.id === now.editing!.value.id);
      if (now.editing.scope !== scope || !row || JSON.stringify(copyRequest(row)) !== now.editing.key || row.corporateCustomerId !== now.context.selectedCorporateId
        || !["draft", "supplement_required"].includes(row.state) || now.context.session && row.applicantCustomerId !== now.context.session.customer.customerId) throw unavailable();
    }
  };
  const currentInput = () => copyInput(Object.fromEntries(valueFields.map(key => [key, form.getFieldValue(key)])) as Values);
  const revisionChanged = Boolean(reviewed && currentRevision !== undefined && (reviewed.revision !== currentRevision || reviewed.basisRevision === currentRevision && reviewed.profileKey !== profileKey
    || reviewed.type === "payment_proof" && reviewed.paymentKey !== proofKey));
  const currentProfileKey = () => JSON.stringify(copyProfile(latest.current.profile.data, latest.current.context.selectedCorporateId));
  type SaveSnapshot = { original: Reviewed; frozen: Values; originalEditing?: Editing; originalProfileKey: string; submit: boolean };
  const capturedSave = useRef<{ value?: SaveSnapshot; error?: Error } | undefined>(undefined);
  const freezeSave = (submit: boolean): SaveSnapshot => {
    const original = reviewed; if (!original) throw unavailable(); assertOriginal(original);
    const frozen = currentInput();
    if (original.type === "payment_proof" && (typeof frozen.reportedAmount !== "string" || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u.test(frozen.reportedAmount)
      || Number(frozen.reportedAmount) <= 0 || submit && !frozen.evidence.length)) throw new Error(english ? "Enter a positive payment amount and attach archived evidence before review." : "请填写正金额，提交审核前须附已归档回款凭证。");
    return { original, frozen, originalEditing: editing, originalProfileKey: currentProfileKey(), submit };
  };
  const captureSave = (submit: boolean) => {
    // SaveButton validates before onSave. Capture the click (also implicit Enter)
    // without dispatching; validation failures remain with the original Form.
    try { capturedSave.current = { value: freezeSave(submit) }; }
    catch (error) { capturedSave.current = { error: error instanceof Error ? error : unavailable() }; }
  };
  const save = async (submit: boolean, submitted?: Values) => {
    const captured = capturedSave.current; capturedSave.current = undefined;
    if (captured?.error) throw captured.error;
    const snapshot = captured?.value ?? freezeSave(submit);
    const { original, frozen, originalEditing, originalProfileKey } = snapshot;
    if (snapshot.submit !== submit || submitted && JSON.stringify(copyInput(submitted)) !== JSON.stringify(frozen)) throw unavailable();
    return operation.run(async () => {
      assertOriginal(original);
      if (latest.current.editing !== originalEditing || currentProfileKey() !== originalProfileKey) throw unavailable();
      const values = copyInput(await form.validateFields()); assertOriginal(original);
      if (originalEditing?.source === "detail") {
        // Re-read the same owned draft after validation/lock waits, without adopting
        // a newer material revision, object basis, target or unsaved input.
        const current = await readExact(originalEditing.value.id, true);
        if (JSON.stringify(current) !== originalEditing.key) throw unavailable();
        assertOriginal(original);
      }
      if (latest.current.editing !== originalEditing || currentProfileKey() !== originalProfileKey || JSON.stringify(values) !== JSON.stringify(frozen) || JSON.stringify(currentInput()) !== JSON.stringify(frozen)) throw unavailable();
      const split = (value?: string) => value?.split(/[,，\n]/u).map(v => v.trim()).filter(Boolean) ?? [];
      const proposal = original.type === "profile_change" ? Object.fromEntries(["legalName", "registeredAddress", "email"].flatMap(key => { const value = frozen[key as keyof Values]; return typeof value === "string" && value.trim() ? [[key, value.trim()]] : []; }))
        : original.type === "credit_change" ? { requestedCreditLimit: frozen.requestedCreditLimit, currency: frozen.currency }
        : original.type === "payment_proof" ? { orderId: original.paymentBasis!.orderId, workspaceId: original.paymentBasis!.workspaceId, currency: original.paymentBasis!.currency,
          reportedAmount: frozen.reportedAmount, paymentPurpose: "rental_fee" as const } : { workspaceIds: split(frozen.workspaces), categoryCodes: split(frozen.categories) };
      const input: Omit<SaveEnterpriseManagementRequest, "operationKey"> = { requestId: originalEditing?.value.id, requestType: original.type, objectRevision: original.revision,
        proposal, evidenceFileIds: [...frozen.evidence], submit, expectedRevision: originalEditing?.value.revision ?? 0, reason: frozen.reason };
      return { path, input };
    }, async () => { await refreshFor(originalEditing); if (latest.current.reviewed === original) { setEditing(undefined); setReviewed(undefined); form.resetFields(); } }, () => refreshFor(originalEditing));
  };
  const editDetail = async (row: EnterpriseManagementRequestView) => {
    const original = copyRequest(row), originalKey = JSON.stringify(original);
    const assertEditable = () => {
      operation.assertCurrent(); const now = latest.current, view = copyProfile(now.profile.data, now.context.selectedCorporateId);
      const allowed = now.context.entry?.corporates.find(value => value.corporateCustomerId === now.context.selectedCorporateId)?.actions.includes("requests:manage");
      if (now.scope !== scope || now.requestedId !== original.id || !allowed || now.fileBusy || now.profile.isFetching || now.profile.error || !view || !view.requestTypes.includes(original.requestType)
        || original.corporateCustomerId !== now.context.selectedCorporateId || original.applicantCustomerId !== now.context.session?.customer.customerId || !["draft", "supplement_required"].includes(original.state)
        || now.editing && now.editing.value.id !== original.id || operation.blocked) throw unavailable();
      return view;
    };
    assertEditable(); const current = await readExact(original.id, true); const view = assertEditable();
    if (JSON.stringify(current) !== originalKey) throw unavailable();
    const proof = original.requestType === "payment_proof" ? copyPaymentBasis(await operation.read<EnterprisePaymentProofBasis>(`/enterprise/corporates/${encodeURIComponent(original.corporateCustomerId)}/orders/${encodeURIComponent(original.proposal.orderId!)}/payment-proof-basis`),
      original.corporateCustomerId, original.proposal.orderId, context.session?.workspace?.workspaceCode, corporate?.permissionRevision) : undefined;
    assertEditable();
    const basisRevision = revisionOf(view, original.requestType, proof); if (basisRevision === undefined) throw unavailable();
    setEditing({ scope, value: current, key: originalKey, source: "detail" }); setType(original.requestType);
    setReviewed({ scope, type: original.requestType, revision: original.objectRevision, basisRevision, profileKey: JSON.stringify(view), ...(proof ? { paymentBasis: proof, paymentKey: JSON.stringify(proof) } : {}) });
    form.resetFields(); form.setFieldsValue({ ...current.proposal, reason: current.reason, evidence: [...current.evidenceFileIds], workspaces: current.proposal.workspaceIds?.join(","), categories: current.proposal.categoryCodes?.join(",") });
  };
  const retireWithdrawalEditor = (id: string) => { if (latest.current.editing?.value.id === id) { setEditing(undefined); setReviewed(undefined); form.resetFields(); } };
  const recordWithdrawal = (value: unknown) => {
    operation.assertCurrent(); const result = value as { id?: unknown; state?: unknown; revision?: unknown } | undefined;
    if (!result || !reference(result.id) || result.state !== "withdrawn" || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 2) throw unavailable();
    setWithdrawal({ identity: context.identity, id: result.id, revision: result.revision });
  };
  const withdrawalAction = (row: EnterpriseManagementRequestView, source?: "detail") => {
    let value: EnterpriseManagementRequestView;
    try { value = copyRequest(row); } catch { return <Alert type="warning" title={english ? "Original request unavailable" : "原申请不可核对"} />; }
    const reviewKey = `${source ?? "list"}:${value.id}`;
    const assertWithdrawal = (original: Editing) => {
      operation.assertCurrent(); const now = latest.current, current = original.source === "detail" ? original.value : now.list.data?.find(item => item.id === original.value.id);
      if (now.scope !== scope || original.scope !== scope || now.fileBusy || original.source === "detail" && now.requestedId !== original.value.id
        || original.source !== "detail" && (now.list.isFetching || now.list.error || !Array.isArray(now.list.data))
        || !current || current.applicantCustomerId !== now.context.session?.customer.customerId || !["draft", "pending", "supplement_required"].includes(current.state)
        || JSON.stringify(copyRequest(current)) !== original.key) throw unavailable();
    };
    return <ConfirmAction disabled={operation.blocked || fileBusy || !context.session || (source === "detail" ? requestedId !== value.id : list.isFetching || Boolean(list.error))}
      label={english ? "Explicitly withdraw" : "明确撤回"} prompt={`${english ? "Withdraw this request only? Enterprise, membership, evidence and rental/payment facts remain." : "仅撤回本条申请？企业、会员与材料保留，租赁和资金事实不变。"} ${value.id} / ${value.revision}`}
      onStateChange={state => {
        // The adapter invokes its latest callback; retain the original opening across rerenders.
        if (state === "confirming") withdrawalReviews.current.set(reviewKey, { scope, value, key: JSON.stringify(value), source });
        else if (state === "idle" || state === "done") withdrawalReviews.current.delete(reviewKey);
      }} onConfirm={async () => {
        const original = withdrawalReviews.current.get(reviewKey); if (!original) throw unavailable(); assertWithdrawal(original);
        return operation.run(async () => {
          assertWithdrawal(original);
          if (original.source === "detail") {
            const current = await readExact(original.value.id);
            if (JSON.stringify(current) !== original.key) throw unavailable();
            assertWithdrawal(original);
          }
          return { path: `/enterprise/management-requests/${encodeURIComponent(original.value.id)}/withdraw`, input: { expectedRevision: original.value.revision, reason: "本人明确撤回企业管理申请，原业务事实不变" } };
        }, async result => {
          recordWithdrawal(result);
          if (original.source === "detail") await refreshExact(original.value.id); else await refresh();
          retireWithdrawalEditor(original.value.id);
        }, () => original.source === "detail" ? refreshExact(original.value.id) : refresh());
      }} />;
  };
  const recoverOriginal = async () => {
    operation.assertCurrent();
    if (operation.managementWithdrawalId) {
      const id = operation.managementWithdrawalId, original = await operation.recover(async () => {});
      if (original?.state === "committed") {
        recordWithdrawal(original.result); retireWithdrawalEditor(id);
        withdrawalReviews.current.delete(`list:${id}`); withdrawalReviews.current.delete(`detail:${id}`);
        if (latest.current.requestedId === id) await refreshExact(id); else await refresh();
      }
      return;
    }
    if (!operation.managementSaveCorporateId) return operation.recover(async () => { await refresh(); setEditing(undefined); setReviewed(undefined); form.resetFields(); });
    if (operation.managementSaveCorporateId !== context.selectedCorporateId || operation.pending?.path !== path) throw unavailable();
    const original = await operation.recover(async () => {});
    if (original?.state === "committed") {
      const originalEditing = latest.current.editing;
      setEditing(undefined); setReviewed(undefined); form.resetFields();
      // Historical proof retires K first. Today's failed read cannot authorize replay.
      try { await refreshFor(originalEditing); } finally { context.reload(); }
    }
  };
  return <section>
    {requestedId !== undefined && <EnterpriseManagementRequestFeedback key={`${context.identity}:${requestedId}`} requestId={requestedId} english={english} onEdit={editDetail} editDisabled={baseBlocked || Boolean(editing && editing.value.id !== requestedId)} renderWithdrawal={row => withdrawalAction(row, "detail")} />}
    <Alert type="info" title={english ? "A request does not change business facts" : "申请与审核不直接改变业务事实"}
      description={english ? "The merchant reviews proposals through the original authorized services. Rental-fee payment evidence can reference an original enterprise-paid order. Formal statements, statement disputes and original guarantee sources are awaiting connection." : "商户按原授权核对申请。费用回款凭证可关联原企业承担订单；正式账单、账单异议和保证金原来源仍待接通。"} />
    {(profile.error || materialError) && <Alert type="error" title={english ? "Enterprise facts unavailable" : "企业资料不可核对"}
      action={<ActionButton disabled={operation.busy} intent="review" label={english ? "Read enterprise facts" : "重新读取企业资料"} onAction={refresh} />} />}
    {profileView && !profile.error && <dl className="enterprise-review-facts">
      <dt>{english ? "Enterprise" : "企业"}</dt><dd>{profileView.corporateName}</dd>
      <dt>{english ? "Verified legal name" : "已核验主体名称"}</dt><dd>{profileView.legalName ?? (english ? "Not recorded" : "未记录")}</dd>
      <dt>{english ? "Legal identifier" : "主体标识"}</dt><dd>{profileView.legalIdentifierMasked ?? (english ? "Not recorded" : "未记录")}</dd>
      <dt>{english ? "Membership" : "会员状态"}</dt><dd>{profileView.membershipStatus}</dd>
      <dt>{english ? "Registered address" : "企业注册地址"}</dt><dd>{profileView.registeredAddress ?? (english ? "Not recorded" : "未记录")}</dd>
    </dl>}
    {!permitted && <Alert type="warning" title={english ? "Select an enterprise with request-management authority to create a proposal" : "请选择有申请管理权的企业后新建申请；本人旧申请仍可核对"} />}
    {permitted && <Form form={form} layout="vertical" disabled={blocked} initialValues={{ evidence: [] }}>
      <Select aria-label={english ? "Request type" : "申请类别"} value={type} disabled={blocked || Boolean(editing)} options={profileView?.requestTypes.map(value => ({ value, label: label(value) })) ?? []}
        onChange={value => { operation.assertCurrent(); if (blocked || editing || !types.includes(value as EnterpriseManagementRequestType)) throw unavailable(); setType(value as EnterpriseManagementRequestType); setReviewed(undefined); form.resetFields(); }} />
      {editing?.source === "detail" && <p>{english ? "Editing original request" : "正在编辑原申请"}: {editing.value.id} / {editing.value.revision}</p>}
      {editing?.source === "detail" && requestedId !== editing.value.id && <Alert type="warning" title={english ? "The detail locator changed; close this original editor before editing another request" : "详情定位已变化；请明确结束当前原编辑，再编辑其他申请"} />}
      {reviewed?.scope === scope && <p>{english ? "Reviewed original object revision" : "已核对的原对象修订"}: {reviewed.revision}</p>}
      {revisionChanged && <Alert type="warning" title={english ? "The original object changed; your proposal keeps its reviewed revision" : "原对象已变化，申请仍保留原审阅修订"}
        description={english ? "Read the current facts and explicitly adopt the new revision before applying your proposal to them. Refresh does not rebase an unsaved request." : "先核对上方当前事实，再明确采用新修订；刷新不会把未保存申请自动绑定到新对象。"}
        action={<ActionButton disabled={blocked} intent="confirm" label={english ? "Use this reviewed current revision" : "核对后采用当前修订"} onAction={async () => { operation.assertCurrent(); const now = latest.current;
          if (now.scope !== scope || now.type !== type || !now.permitted || now.profile.isFetching || now.profile.error || !now.profileView || now.currentRevision === undefined || now.profileKey !== profileKey) throw unavailable();
          if (type === "payment_proof" && (!now.proofView || now.paymentBasis.isFetching || now.paymentBasis.error)) throw unavailable();
          setReviewed({ scope, type, revision: now.currentRevision, basisRevision: now.currentRevision, profileKey: now.profileKey,
            ...(type === "payment_proof" ? { paymentBasis: now.proofView, paymentKey: now.proofKey } : {}) }); }} />} />}
      {type === "profile_change" ? <>
        <Form.Item name="legalName" label={english ? "Proposed legal name" : "申请更正的主体名称"}><Input maxLength={191} /></Form.Item>
        <Form.Item name="registeredAddress" label={english ? "Proposed registered address" : "申请更正的企业注册地址"}><Input.TextArea maxLength={1000} /></Form.Item>
        <Form.Item name="email" label={english ? "Proposed contact email" : "申请更正的企业联系邮箱"}><Input maxLength={191} /></Form.Item>
      </> : type === "credit_change" ? <>
        <Form.Item name="requestedCreditLimit" label={english ? "Requested limit" : "申请额度"} rules={[{ required: true, pattern: /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u }]}><Input inputMode="decimal" /></Form.Item>
        <Form.Item name="currency" label={english ? "Original supported currency" : "原授信支持币种"} rules={[{ required: true }]}><Select options={[{ value: "CNY", label: "CNY" }]} /></Form.Item>
      </> : type === "payment_proof" ? <>
        <Form.Item name="orderId" label={english ? "Original enterprise-paid order" : "原企业承担订单引用"} rules={[{ required: true, pattern: /^[a-zA-Z0-9._:-]{1,191}$/u }]}><Input maxLength={191} disabled={Boolean(editing)} /></Form.Item>
        {proofView && <p>{english ? "Rental-fee payment evidence" : "租赁费用回款核对"} · {proofView.workspaceCode} · {proofView.currency}</p>}
        {paymentBasis.error && <Alert type="warning" title={english ? "Original payment-evidence basis unavailable" : "原费用回款依据不可用"} />}
        <Form.Item name="reportedAmount" label={english ? "Reported rental-fee payment amount" : "申报费用回款金额"} rules={[{ required: true, pattern: /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u }]}><Input inputMode="decimal" maxLength={13} /></Form.Item>
      </> : <>
        <Form.Item name="workspaces" label={english ? "Requested workspace references (comma-separated)" : "申请空间引用（逗号分隔）"}><Input.TextArea /></Form.Item>
        <Form.Item name="categories" label={english ? "Registered category codes (comma-separated)" : "登记品类代码（逗号分隔）"}><Input /></Form.Item>
      </>}
      <Form.Item name="reason" label={english ? "Reason" : "申请依据与原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
      <Form.Item name="evidence" label={english ? "Archived evidence references" : "已归档材料引用"}><Select mode="tags" /></Form.Item>
      <AuthorityUpload english={english} disabled={blocked || proofBlocked} purpose={type === "payment_proof" ? "payment_proof" : "authority"} paymentProof={type === "payment_proof" ? proofView : undefined} onBusy={setFileBusy} onFile={id => { operation.assertCurrent(); if (latest.current.scope !== scope || !latest.current.permitted || !reference(id)) throw unavailable();
        const evidence = form.getFieldValue("evidence") ?? []; if (!references(evidence, 10)) throw unavailable(); const next = [...new Set([...evidence, id])]; if (next.length > 10) throw unavailable(); form.setFieldValue("evidence", next); }} />
      <SaveButton form={form} disabled={blocked || proofBlocked || type === "payment_proof" && revisionChanged} label={english ? "Save draft" : "保存草稿"} onClickCapture={() => captureSave(false)} onSave={values => save(false, values)} />
      <SaveButton form={form} disabled={blocked || proofBlocked || type === "payment_proof" && revisionChanged} label={english ? "Request merchant review" : "提交商户审核"} onClickCapture={() => captureSave(true)} onSave={values => save(true, values)} />
      {editing && <Button disabled={operation.blocked || fileBusy} onClick={() => { operation.assertCurrent(); if (latest.current.scope !== scope || operation.blocked || fileBusy) throw unavailable(); setEditing(undefined); setReviewed(undefined); form.resetFields(); }}>{english ? "Close editor" : "结束编辑"}</Button>}
    </Form>}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original request result" : "核对原申请结果"} onAction={recoverOriginal} />}
    {!permitted && <EnterpriseMemberOperationRecovery english={english} />}
    {withdrawal?.identity === context.identity && <Alert type="info" title={english ? "Original request withdrawal verified" : "原管理申请撤回已核对"} description={`${withdrawal.id} / ${withdrawal.revision}`} />}
    {operation.error && <Alert type="error" title={operation.error} />}
    {list.error ? <Alert type="error" title={english ? "Your requests unavailable" : "本人申请读取失败"} /> : <Table rowKey="id" caption={english ? "Your management requests" : "本人企业管理申请"} dataSource={list.data ?? []} loading={list.isFetching} pagination={false} sorting={false} onRefresh={() => refreshFor()} columns={[
      { title: english ? "Type" : "类别", render: (_, row: EnterpriseManagementRequestView) => label(row.requestType) },
      { title: english ? "State" : "状态", render: (_, row: EnterpriseManagementRequestView) => { try { return managementRequestStateLabel(copyRequest(row).state, english); } catch { return english ? "Request state unavailable" : "申请状态不可核对"; } } },
      { title: english ? "Reason" : "申请原因", dataIndex: "reason" }, { title: english ? "Review feedback" : "审核反馈", dataIndex: "decisionReason" },
      { title: english ? "Original feedback" : "本条反馈", render: (_, row: EnterpriseManagementRequestView) => { const path = feedbackPath(row); return path ? <Link to={path}>{english ? "Read this request" : "读取本条申请"}</Link> : english ? "Original entry unavailable" : "原入口不可用"; } },
      { title: english ? "Actions" : "操作", render: (_, row: EnterpriseManagementRequestView) => <>
        {row.requestType !== "payment_proof" && permitted && row.corporateCustomerId === context.selectedCorporateId && ["draft", "supplement_required"].includes(row.state) && <Button disabled={listBlocked} onClick={() => {
          operation.assertCurrent(); const now = latest.current, value = copyRequest(row), current = now.list.data?.find(item => item.id === value.id);
          if (now.scope !== scope || !now.permitted || now.profile.isFetching || now.list.isFetching || now.profile.error || now.list.error || !now.profileView || !now.profileView.requestTypes.includes(value.requestType)
            || !current || JSON.stringify(copyRequest(current)) !== JSON.stringify(value) || value.corporateCustomerId !== now.context.selectedCorporateId || !["draft", "supplement_required"].includes(value.state)
            || now.context.session && value.applicantCustomerId !== now.context.session.customer.customerId) throw unavailable();
          const basisRevision = revisionOf(now.profileView, value.requestType); if (basisRevision === undefined) throw unavailable();
          setEditing({ scope, value, key: JSON.stringify(value) }); setType(value.requestType); setReviewed({ scope, type: value.requestType, revision: value.objectRevision, basisRevision, profileKey: now.profileKey });
          form.resetFields(); form.setFieldsValue({ ...value.proposal, reason: value.reason, evidence: [...value.evidenceFileIds], workspaces: value.proposal.workspaceIds?.join(","), categories: value.proposal.categoryCodes?.join(",") });
        }}>{english ? "Edit original request" : "编辑原申请"}</Button>}
        {["draft", "pending", "supplement_required"].includes(row.state) && withdrawalAction(row)}
      </> },
    ]} />}
  </section>;
}
