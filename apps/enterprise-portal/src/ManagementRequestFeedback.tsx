/** Exact own feedback, review-only labels and registered editor/withdrawal controls.
 * The reader never writes, verifies K or grants rights; commands stay with the parent/gate. */
import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { customerFetch } from "@rental-os/web-client";
import type { EnterpriseManagementRequestView } from "@rental-os/shared";
import { ActionButton, Alert } from "@/components/ui/customer-entry";
import { copyEnterpriseManagementRequest } from "@/components/enterprise-management-material";
import { CLIENT_BASE, useEnterprise } from "./enterprise-session";
const stateLabels: Record<EnterpriseManagementRequestView["state"], readonly [string, string]> = {
  draft: ["草稿", "Draft"], pending: ["待商户审核", "Awaiting merchant review"], supplement_required: ["要求补件", "Additional evidence requested"],
  approved: ["已记录审核通过", "Review recorded as approved"], rejected: ["申请被拒绝", "Request rejected"], withdrawn: ["已撤回", "Withdrawn"],
};
export function managementRequestStateLabel(state: EnterpriseManagementRequestView["state"], english: boolean): string {
  return Object.hasOwn(stateLabels, state) ? stateLabels[state][english ? 1 : 0] : english ? "Request state unavailable" : "申请状态不可核对";
}
export function EnterpriseManagementRequestFeedback({ requestId, english, onEdit, editDisabled = false, renderWithdrawal }: { requestId: string; english: boolean; onEdit?: (original: EnterpriseManagementRequestView) => Promise<void>; editDisabled?: boolean; renderWithdrawal?: (original: EnterpriseManagementRequestView) => ReactNode }) {
  const context = useEnterprise(), valid = /^[a-zA-Z0-9_-]{1,191}$/u.test(requestId), scope = JSON.stringify([context.identity, requestId]);
  const latest = useRef({ context, scope, onEdit, editDisabled }), mounted = useRef(true); latest.current = { context, scope, onEdit, editDisabled };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, [scope]);
  const unavailable = () => new Error("原本人管理申请反馈不可核对 / Original own request feedback unavailable");
  const assertCurrent = () => {
    const now = latest.current;
    if (!mounted.current || now.scope !== scope || !valid || !now.context.session || now.context.identity !== context.identity || context.signal.aborted) throw unavailable();
  };
  const project = (value: EnterpriseManagementRequestView) => {
    const copy = copyEnterpriseManagementRequest(value);
    if (copy.id !== requestId || copy.applicantCustomerId !== latest.current.context.session?.customer.customerId) throw unavailable();
    return copy;
  };
  const query = useQuery({ queryKey: ["enterprise-management-feedback", scope], enabled: valid && Boolean(context.session) && !context.loading,
    queryFn: async ({ signal }) => { assertCurrent(); const value = await context.read<EnterpriseManagementRequestView>(`/enterprise/management-requests/${encodeURIComponent(requestId)}`, AbortSignal.any([signal, context.signal])); assertCurrent(); return project(value); } });
  let material: EnterpriseManagementRequestView | undefined, malformed = false;
  try { if (query.data && valid && context.session && !context.loading && !context.signal.aborted && !query.isFetching && !query.error) material = project(query.data); } catch { malformed = true; }
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === material?.corporateCustomerId);
  const fileAllowed = Boolean(material?.requestType === "payment_proof" && context.selectedCorporateId === material.corporateCustomerId
    && ["requests:manage", "orders:read", "finance:read"].every(action => corporate?.actions.some(permission => permission === action)));
  const fileScope = JSON.stringify([scope, context.selectedCorporateId, corporate?.actions, material, query.isFetching, Boolean(query.error)]), currentFileScope = useRef(fileScope); currentFileScope.current = fileScope;
  const evidence = async (fileId: string) => {
    const original = material;
    const check = () => { assertCurrent(); if (!fileAllowed || !original || currentFileScope.current !== fileScope || !original.evidenceFileIds.includes(fileId)) throw unavailable(); };
    check();
    const response = await customerFetch(context.tenantCode, CLIENT_BASE, `/enterprise/management-requests/${encodeURIComponent(original!.id)}/files/${encodeURIComponent(fileId)}`, { signal: context.signal });
    check();
    if (!response.ok) throw unavailable();
    const bytes = await response.blob(); check();
    if (!["application/pdf", "image/png", "image/jpeg"].includes(bytes.type) || bytes.size < 1 || bytes.size > 20 * 1024 * 1024) throw unavailable();
    const url = URL.createObjectURL(bytes), link = document.createElement("a"); link.href = url; link.download = "enterprise-payment-proof";
    try { check(); link.click(); } finally { URL.revokeObjectURL(url); }
  };
  const refresh = async () => { assertCurrent(); await query.refetch({ throwOnError: true }); assertCurrent(); };
  const edit = async () => {
    assertCurrent(); const now = latest.current;
    if (!now.onEdit || now.editDisabled || query.isFetching || query.error || !query.data) throw unavailable();
    const original = project(query.data), corporate = now.context.entry?.corporates.find(row => row.corporateCustomerId === original.corporateCustomerId);
    if (now.context.selectedCorporateId !== original.corporateCustomerId || !corporate?.actions.includes("requests:manage") || !["draft", "supplement_required"].includes(original.state)) throw unavailable();
    await now.onEdit(original); assertCurrent();
  };
  const fields: Record<string, string> = english ? { legalName: "Proposed legal name", registeredAddress: "Proposed registered address", email: "Proposed contact email", requestedCreditLimit: "Requested limit (not an approved balance)", currency: "Request currency", workspaceIds: "Requested workspace references", categoryCodes: "Requested category codes", orderId: "Original order", workspaceId: "Original workspace", reportedAmount: "Reported rental-fee payment", paymentPurpose: "Payment-evidence purpose" }
    : { legalName: "申请主体名称", registeredAddress: "申请注册地址", email: "企业联系邮箱", requestedCreditLimit: "申请额度（非已批准额度）", currency: "申请币种", workspaceIds: "申请空间引用", categoryCodes: "申请品类代码", orderId: "原订单引用", workspaceId: "原经营空间", reportedAmount: "申报费用回款金额", paymentPurpose: "回款核对用途" };
  return <section aria-label={english ? "Original own management request feedback" : "本人原管理申请反馈"}>
    <h3>{english ? "Original request feedback" : "本条原申请反馈"}</h3>
    <Alert type="info" title={english ? "Feedback does not apply a business change or resolve an unknown operation" : "申请反馈不代表业务已变更，也不解除未决原操作"}
      description={english ? "Only your persisted request is read. The URL does not select an enterprise, grant editing authority or verify a command K. Evidence references do not grant downloads." : "仅读本人的原持久申请。URL不选择企业、不授编辑权限，也不核销原K；材料引用不代表下载授权。"} />
    {(!valid || query.error || malformed) && <Alert type="warning" title={english ? "Original request feedback unavailable" : "原本人申请反馈不可核对"} />}
    <ActionButton disabled={!valid || context.loading || !context.session || query.isFetching} intent="review" label={english ? "Read this request again" : "重新读取本条申请"} onAction={refresh} />
    {query.isFetching && <p>{english ? "Reading original feedback" : "正在读取原反馈"}</p>}
    {material && <>
      <dl className="enterprise-review-facts">
        <dt>{english ? "Original request ID" : "原申请 ID"}</dt><dd>{material.id}</dd>
        <dt>{english ? "Original enterprise ID" : "原企业 ID"}</dt><dd>{material.corporateCustomerId}</dd>
        <dt>{english ? "Request state" : "申请状态"}</dt><dd>{managementRequestStateLabel(material.state, english)}</dd>
        <dt>{english ? "Request revision" : "申请修订"}</dt><dd>{material.revision}</dd>
        <dt>{english ? "Reviewed object revision" : "原对象修订"}</dt><dd>{material.objectRevision}</dd>
        <dt>{english ? "Original reason" : "原申请原因"}</dt><dd>{material.reason}</dd>
        <dt>{english ? "Merchant feedback" : "商户处理反馈"}</dt><dd>{material.decisionReason ?? (english ? "Not recorded" : "未记录")}</dd>
        <dt>{english ? "Created (UTC)" : "申请时间（UTC）"}</dt><dd>{material.createdAt}</dd>
        <dt>{english ? "Updated (UTC)" : "更新时间（UTC）"}</dt><dd>{material.updatedAt}</dd>
        {Object.entries(material.proposal).map(([key, value]) => <div key={key}><dt>{fields[key]}</dt><dd>{key === "paymentPurpose" ? english ? "Rental fees" : "租赁费用" : Array.isArray(value) ? value.join("、") : value}</dd></div>)}
      </dl>
      {onEdit && <ActionButton disabled={editDisabled || context.selectedCorporateId !== material.corporateCustomerId || !context.entry?.corporates.find(row => row.corporateCustomerId === material.corporateCustomerId)?.actions.includes("requests:manage") || !["draft", "supplement_required"].includes(material.state)}
        intent="review" label={english ? "Edit this original request" : "编辑本条原申请"} onAction={edit} />}
      {renderWithdrawal && ["draft", "pending", "supplement_required"].includes(material.state) && renderWithdrawal(copyEnterpriseManagementRequest(material))}
      <p>{english ? "Archived evidence references" : "已归档材料引用"}: {material.evidenceFileIds.length ? material.evidenceFileIds.join("、") : english ? "None recorded" : "未记录"}</p>
      {fileAllowed && material.evidenceFileIds.map((id, index) => <ActionButton key={id} intent="review" label={`${english ? "Read payment evidence" : "读取回款凭证"} ${index + 1}`} onAction={() => evidence(id)} />)}
      {material.state === "supplement_required" && <Alert type="warning" title={english ? "Read the original feedback before editing supplemental evidence" : "先核对原补件反馈，再编辑本条申请"}
        description={english ? "Editing requires current request-management authority for the original enterprise and an explicit original-request editor. Reading here does not rebase your unsaved input." : "补件仍须原企业的当前申请管理权及明确原申请编辑；本页读取不改绑未保存输入。"} />}
    </>}
  </section>;
}
