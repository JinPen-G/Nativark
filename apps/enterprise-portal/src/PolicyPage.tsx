/** Company/member policy editor freezes original bounds and target before asynchronous validation.
 * Current permission, intersection, monetary bounds and final rental authority remain server/Core responsibilities. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnterpriseMembersResponse, EnterpriseScopePolicyView, SaveEnterpriseScopePolicyRequest } from "@rental-os/shared";
import { copyEnterprisePolicy as copyPolicy, copyEnterprisePolicyView as copyView, captureEnterprisePolicyInput as captureInput } from "@/components/enterprise-policy-material";
import { ActionButton, Alert, Button, Form, SaveButton, Select } from "@/components/ui/customer-entry";
import { EnterprisePolicyFields, enterprisePolicyValues, type EnterprisePolicyForm } from "@/components/EnterprisePolicyFields";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
import { EnterpriseMemberOperationRecovery } from "./MemberOperationRecovery";

const unavailable = () => new Error("原政策材料、对象或修订不可用，请重新核对 / Original policy material, target or revision unavailable");
const policyUtc = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function EnterprisePolicyPage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const [target, setTarget] = useState({ identity: context.identity, id: "" });
  const memberId = target.identity === context.identity ? target.id : "";
  const [reviewed, setReviewed] = useState<{ scope: string; view: EnterpriseScopePolicyView; key: string; targetKey: string; updatedAt?: string }>();
  const [form] = Form.useForm<EnterprisePolicyForm>();
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === context.selectedCorporateId);
  const permitted = Boolean(corporate?.actions.includes("policy:manage"));
  const operation = useOriginalWorkflowOperation(`policy:${memberId}`);
  const base = `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}`;
  const path = memberId ? `${base}/members/${encodeURIComponent(memberId)}/policy` : `${base}/policy`, scope = JSON.stringify([context.identity, path]);
  const policy = useQuery({ queryKey: ["enterprise-policy", context.identity, memberId], enabled: permitted,
    queryFn: ({ signal }) => operation.read<EnterpriseScopePolicyView>(path, AbortSignal.any([signal, context.signal])) });
  const members = useQuery({ queryKey: ["enterprise-policy-members", context.identity], enabled: permitted && Boolean(corporate?.actions.includes("members:read")),
    queryFn: ({ signal }) => operation.read<EnterpriseMembersResponse>(`${base}/members?tenantCode=${encodeURIComponent(context.tenantCode)}&pageSize=100`, AbortSignal.any([signal, context.signal])) });
  let view: EnterpriseScopePolicyView | undefined;
  try { view = copyView(policy.data); } catch { /* Bad original material is unavailable, never repaired from defaults. */ }
  const member = memberId ? members.data?.items.find(row => row.membershipId === memberId && row.status === "active") : undefined;
  const targetKey = memberId ? member && policyUtc(member.updatedAt) ? JSON.stringify([memberId, member.updatedAt, member.status]) : undefined : "company";
  const original = reviewed?.scope === scope ? reviewed : undefined, editing = Boolean(original);
  const key = view && JSON.stringify(view), changed = Boolean(original && (original.key !== key || original.targetKey !== targetKey));
  const latest = useRef({ context, scope, path, memberId, policy, members, original });
  latest.current = { context, scope, path, memberId, policy, members, original };
  useEffect(() => { setReviewed(undefined); form.resetFields(); }, [context.identity, memberId]);
  const refresh = async () => {
    await policy.refetch({ throwOnError: true }); operation.assertCurrent();
    if (memberId) { await members.refetch({ throwOnError: true }); operation.assertCurrent(); }
  };
  const beginEdit = () => {
    operation.assertCurrent();
    if (!permitted || context.loading || policy.isFetching || policy.error || !view?.merchant || !targetKey
      || memberId && (members.isFetching || members.error || !view.company)) throw unavailable();
    // Query, original review and form have independent arrays and workspace records.
    const editable = copyPolicy(memberId ? view.employee ?? { ...view.company!, enterprisePaymentAllowed: false } : view.company ?? view.merchant);
    form.resetFields(); form.setFieldsValue(enterprisePolicyValues(editable));
    setReviewed({ scope, view, key: JSON.stringify(view), targetKey, updatedAt: member?.updatedAt });
  };
  const assertOriginal = () => {
    operation.assertCurrent(); const now = latest.current, current = copyView(now.policy.data);
    const activeTarget = now.memberId ? now.members.data?.items.find(row => row.membershipId === now.memberId && row.status === "active") : undefined;
    const currentTargetKey = now.memberId ? activeTarget && policyUtc(activeTarget.updatedAt) ? JSON.stringify([now.memberId, activeTarget.updatedAt, activeTarget.status]) : undefined : "company";
    const allowed = now.context.entry?.corporates.find(row => row.corporateCustomerId === now.context.selectedCorporateId)?.actions.includes("policy:manage");
    if (!original || now.original !== original || now.scope !== original.scope || now.path !== path || !allowed || now.context.loading || now.policy.isFetching || now.policy.error
      || !current?.merchant || original.key !== JSON.stringify(current) || currentTargetKey !== original.targetKey || now.memberId && (now.members.isFetching || now.members.error)) throw unavailable();
    return original;
  };
  const currentInput = () => captureInput({ workspaceIds: form.getFieldValue("workspaceIds"), categoryCodes: form.getFieldValue("categoryCodes"),
    personalPaymentAllowed: form.getFieldValue("personalPaymentAllowed"), enterprisePaymentAllowed: form.getFieldValue("enterprisePaymentAllowed"), approvalMode: form.getFieldValue("approvalMode"),
    noticeVersion: form.getFieldValue("noticeVersion"), noticeText: form.getFieldValue("noticeText"), maxRequestAmount: form.getFieldValue("maxRequestAmount"), currency: form.getFieldValue("currency"),
    approvalLifetimeMinutes: form.getFieldValue("approvalLifetimeMinutes"), reason: form.getFieldValue("reason") });
  const save = async (validated?: EnterprisePolicyForm) => {
    // Freeze before the Web Lock/validator yields; later form edits never change this command's input.
    const input = validated === undefined ? currentInput() : captureInput(validated);
    await operation.run(async () => {
      const reviewedOriginal = assertOriginal(), checked = captureInput(await form.validateFields()); assertOriginal();
      if (JSON.stringify(checked) !== JSON.stringify(input) || JSON.stringify(currentInput()) !== JSON.stringify(input)) throw unavailable();
      if (memberId && !policyUtc(reviewedOriginal.updatedAt)) throw unavailable();
      const commandInput: Omit<SaveEnterpriseScopePolicyRequest, "operationKey"> = { policy: input.policy, expectedRevision: reviewedOriginal.view.revision, reason: input.reason,
        ...(memberId ? { expectedMembershipUpdatedAt: reviewedOriginal.updatedAt } : {}) };
      return { path, method: "PUT", input: commandInput };
    }, async () => { await refresh(); if (latest.current.original === original) setReviewed(undefined); }, refresh);
    operation.assertCurrent(); context.reload();
  };
  const recoverOriginal = async () => {
    const receipt = await operation.recover(async () => {});
    if (receipt?.state === "committed") { operation.assertCurrent(); setReviewed(undefined); context.reload(); }
  };
  if (!permitted) return <><Alert type="warning" title={english ? "Policy management is not granted" : "请选择已获政策管理权的企业"} /><EnterpriseMemberOperationRecovery english={english} /></>;
  return <section>
    <Alert type="info" title={english ? "Rental authority is the intersection, not the portal role" : "可租范围取交集，管理员角色不等于企业付费权"} description={english ? "Merchant limits, company and member policy, current qualifications and Core rules all apply. Approval does not reserve stock or confirm payment." : "商户上限、企业与员工政策、当前资格及Core条件同时生效。批准不保证库存或价格，不代表已支付。逐单模式必须取得独立批准并从原批准明确提交，不能绕过审批。"} />
    <Select aria-label={english ? "Policy target" : "政策对象"} disabled={operation.blocked || editing} value={memberId} options={[{ value: "", label: english ? "Company policy" : "企业政策" }, ...(members.data?.items ?? []).filter(row => row.status === "active").map(row => ({ value: row.membershipId, label: row.displayName }))]} onChange={id => {
      operation.assertCurrent(); if (latest.current.original || operation.blocked || typeof id !== "string" || id && !members.data?.items.some(row => row.membershipId === id && row.status === "active")) return;
      setTarget({ identity: context.identity, id });
    }} />
    {members.error && <Alert type="error" title={english ? "Member targets could not be read" : "员工政策对象读取失败"} />}
    {members.data && members.data.total > members.data.items.length && <Alert type="warning" title={english ? "Only the first member page is shown; select other members from their details" : "当前仅显示首批成员；其余成员须从详情定位，未加载成员不视为不存在"} />}
    {policy.error || policy.data && !view ? <Alert type="error" title={english ? "Original policy material could not be read" : "原政策材料不可读取，请重新核对"} action={<ActionButton intent="review" label={english ? "Read again" : "重新读取"} onAction={refresh} />} /> : !view ? <p>{english ? "Reading policy" : "正在读取政策"}</p> : <>
      <p>{english ? "Merchant / company / member revision" : "商户 / 企业 / 员工修订"}：{view.merchantRevision} / {view.companyRevision} / {view.employeeRevision}</p>
      <p>{english ? "Effective workspace IDs" : "当前交集空间"}：{view.effectiveWorkspaceIds.map(id => view!.workspaces.find(row => row.id === id)?.name ?? id).join("、") || (english ? "None authorized" : "尚无受权范围")}</p>
      {!view.merchant ? <Alert type="warning" title={english ? "Merchant upper bounds are not configured" : "商户尚未明确配置上限，新企业业务不可用"} /> : !original ? <Button disabled={operation.blocked || context.loading || policy.isFetching || !targetKey || Boolean(memberId && (members.isFetching || members.error || !view.company))} onClick={beginEdit}>{english ? "Edit policy" : "编辑政策"}</Button> : <Form form={form} layout="vertical" disabled={operation.blocked}>
        <p>{english ? "Original policy target" : "原政策对象"}：{memberId || context.selectedCorporateId}{original.updatedAt && ` / ${original.updatedAt}`}</p>
        {changed && <Alert type="warning" title={english ? "Original policy material or target changed; review again without rebinding old input" : "原政策材料、对象或修订已变化；重新审阅，不自动改绑旧输入"} />}
        <EnterprisePolicyFields view={original.view} merchant={false} english={english} />
        <SaveButton form={form} disabled={operation.blocked || context.loading || policy.isFetching || Boolean(policy.error) || changed} label={english ? "Save policy" : "保存政策"} onSave={values => save(values)} />
        <Button disabled={operation.blocked} onClick={() => { operation.assertCurrent(); if (latest.current.original === original) setReviewed(undefined); }}>{english ? "Cancel" : "取消"}</Button>
      </Form>}
    </>}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original policy result" : "核对原政策操作"} onAction={recoverOriginal} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
}
