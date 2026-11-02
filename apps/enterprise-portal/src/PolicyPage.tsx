/** Company/member policy editor within the merchant's explicit rental upper bounds. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnterpriseMembersResponse, EnterpriseScopePolicyView } from "@rental-os/shared";
import { ActionButton, Alert, Button, Form, SaveButton, Select } from "@/components/ui/customer-entry";
import { EnterprisePolicyFields, enterprisePolicyPayload, enterprisePolicyValues, type EnterprisePolicyForm } from "@/components/EnterprisePolicyFields";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
export function EnterprisePolicyPage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const [memberId, setMemberId] = useState(""), [editing, setEditing] = useState(false), [reviewed, setReviewed] = useState<EnterpriseScopePolicyView>();
  const [form] = Form.useForm<EnterprisePolicyForm>();
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === context.selectedCorporateId);
  const permitted = Boolean(corporate?.actions.includes("policy:manage"));
  const operation = useOriginalWorkflowOperation(`policy:${memberId}`);
  const base = `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}`;
  const path = memberId ? `${base}/members/${encodeURIComponent(memberId)}/policy` : `${base}/policy`;
  const policy = useQuery({ queryKey: ["enterprise-policy", context.identity, memberId], enabled: permitted,
    queryFn: ({ signal }) => operation.read<EnterpriseScopePolicyView>(path, AbortSignal.any([signal, context.signal])) });
  const members = useQuery({ queryKey: ["enterprise-policy-members", context.identity], enabled: permitted && Boolean(corporate?.actions.includes("members:read")),
    queryFn: ({ signal }) => operation.read<EnterpriseMembersResponse>(`${base}/members?tenantCode=${encodeURIComponent(context.tenantCode)}&pageSize=100`, AbortSignal.any([signal, context.signal])) });
  useEffect(() => { setMemberId(""); setEditing(false); setReviewed(undefined); form.resetFields(); }, [context.identity]);
  useEffect(() => { setEditing(false); setReviewed(undefined); form.resetFields(); }, [memberId]);
  const refresh = async () => { await policy.refetch({ throwOnError: true }); operation.assertCurrent(); };
  if (!permitted) return <Alert type="warning" title={english ? "Policy management is not granted" : "请选择已获政策管理权的企业"} />;
  const view = policy.data;
  const reviewVersion = (value: EnterpriseScopePolicyView) => JSON.stringify([value.revision, value.merchantRevision, value.companyRevision, value.employeeRevision]);
  const changed = Boolean(reviewed && view && reviewVersion(reviewed) !== reviewVersion(view));
  return <section>
    <Alert type="info" title={english ? "Rental authority is the intersection, not the portal role" : "可租范围取交集，管理员角色不等于企业付费权"} description={english ? "Merchant limits, company and member policy, current qualifications and Core rules all apply. Approval does not reserve stock or confirm payment." : "商户上限、企业与员工政策、当前资格及Core条件同时生效。批准不保证库存或价格，不代表已支付。逐单模式必须取得独立批准并从原批准明确提交，不能绕过审批。"} />
    <Select aria-label={english ? "Policy target" : "政策对象"} disabled={operation.blocked || editing} value={memberId} options={[{ value: "", label: english ? "Company policy" : "企业政策" }, ...(members.data?.items ?? []).filter(row => row.status === "active").map(row => ({ value: row.membershipId, label: row.displayName }))]} onChange={setMemberId} />
    {members.error && <Alert type="error" title={english ? "Member targets could not be read" : "员工政策对象读取失败"} />}
    {members.data && members.data.total > members.data.items.length && <Alert type="warning" title={english ? "Only the first member page is shown; select other members from their details" : "当前仅显示首批成员；其余成员须从详情定位，未加载成员不视为不存在"} />}
    {policy.error ? <Alert type="error" title={policy.error instanceof Error ? policy.error.message : "政策读取失败"} action={<Button onClick={() => void refresh()}>{english ? "Read again" : "重新读取"}</Button>} /> : !view ? <p>{english ? "Reading policy" : "正在读取政策"}</p> : <>
      <p>{english ? "Merchant / company / member revision" : "商户 / 企业 / 员工修订"}：{view.merchantRevision} / {view.companyRevision} / {view.employeeRevision}</p>
      <p>{english ? "Effective workspace IDs" : "当前交集空间"}：{view.effectiveWorkspaceIds.map(id => view.workspaces.find(row => row.id === id)?.name ?? id).join("、") || (english ? "None authorized" : "尚无受权范围")}</p>
      {!view.merchant ? <Alert type="warning" title={english ? "Merchant upper bounds are not configured" : "商户尚未明确配置上限，新企业业务不可用"} /> : !editing ? <Button disabled={operation.blocked || Boolean(memberId && !view.company)} onClick={() => { operation.assertCurrent(); form.setFieldsValue(enterprisePolicyValues(memberId ? view.employee ?? { ...view.company!, enterprisePaymentAllowed: false } : view.company ?? view.merchant)); setReviewed(view); setEditing(true); }}>{english ? "Edit policy" : "编辑政策"}</Button> : <Form form={form} layout="vertical" disabled={operation.blocked}>
        {changed && <Alert type="warning" title={english ? "Policy revisions changed; review the current limits and reopen this editor" : "政策修订已变化；核对当前上限后重新编辑，不自动改绑旧输入"} />}
        <EnterprisePolicyFields view={reviewed ?? view} merchant={false} english={english} />
        <SaveButton form={form} disabled={operation.blocked || policy.isFetching || changed || !reviewed} label={english ? "Save policy" : "保存政策"} onSave={() => operation.run(async () => { const values = await form.validateFields(); operation.assertCurrent(); if (!reviewed || changed || policy.isFetching || policy.error) throw new Error("原政策审阅修订已变化，请重新核对"); return { path, method: "PUT", input: { policy: enterprisePolicyPayload(values), expectedRevision: reviewed.revision, reason: values.reason } }; }, async () => { await refresh(); setEditing(false); setReviewed(undefined); }, refresh)} />
        <Button disabled={operation.blocked} onClick={() => { setEditing(false); setReviewed(undefined); }}>{english ? "Cancel" : "取消"}</Button>
      </Form>}
    </>}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original policy result" : "核对原政策操作"} onAction={() => operation.recover(async () => { await refresh(); setEditing(false); setReviewed(undefined); })} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
}
