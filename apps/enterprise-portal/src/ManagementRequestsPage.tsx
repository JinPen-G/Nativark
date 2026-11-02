/** Corporate proposals are review-only; no customer-side master, policy or money mutation. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnterpriseManagementRequestType, EnterpriseManagementRequestView, EnterpriseProfileView } from "@rental-os/shared";
import { ActionButton, Alert, Button, Form, Input, SaveButton, Select, Table } from "@/components/ui/customer-entry";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
import { AuthorityUpload } from "./AuthorityUpload";
type Values = { legalName?: string; registeredAddress?: string; email?: string; requestedCreditLimit?: string; currency?: string; workspaces?: string; categories?: string; reason: string; evidence: string[] };
export function EnterpriseManagementRequestsPage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const [type, setType] = useState<EnterpriseManagementRequestType>("profile_change"), [editing, setEditing] = useState<EnterpriseManagementRequestView>(), [fileBusy, setFileBusy] = useState(false);
  const [reviewed, setReviewed] = useState<{ identity: string; type: EnterpriseManagementRequestType; revision: string }>();
  const [form] = Form.useForm<Values>(), operation = useOriginalWorkflowOperation("management-requests");
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === context.selectedCorporateId);
  const permitted = Boolean(corporate?.actions.includes("requests:manage"));
  const profile = useQuery({ queryKey: ["enterprise-profile", context.identity], enabled: Boolean(corporate), queryFn: ({ signal }) => operation.read<EnterpriseProfileView>(`/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/profile`, signal) });
  const list = useQuery({ queryKey: ["enterprise-management-requests", context.identity], queryFn: ({ signal }) => operation.read<EnterpriseManagementRequestView[]>("/enterprise/management-requests", signal) });
  useEffect(() => { setEditing(undefined); setReviewed(undefined); form.resetFields(); }, [context.identity]);
  const currentRevision = profile.data ? type === "profile_change" ? profile.data.profileRevision : type === "credit_change"
    ? profile.data.creditRevision === null ? undefined : String(profile.data.creditRevision) : String(profile.data.merchantPolicyRevision) : undefined;
  useEffect(() => {
    if (currentRevision !== undefined && (!reviewed || reviewed.identity !== context.identity || reviewed.type !== type)) setReviewed({ identity: context.identity, type, revision: currentRevision });
  }, [context.identity, type, currentRevision, reviewed]);
  const refresh = async () => { await Promise.all([list.refetch({ throwOnError: true }), ...(corporate ? [profile.refetch({ throwOnError: true })] : [])]); operation.assertCurrent(); };
  const blocked = operation.blocked || fileBusy || profile.isFetching || list.isFetching || Boolean(profile.error) || Boolean(list.error) || !list.data || !permitted || !profile.data;
  const label = (value: EnterpriseManagementRequestType) => value === "profile_change" ? english ? "Profile correction" : "资料更正" : value === "credit_change" ? english ? "Credit limit request" : "授信调整申请" : english ? "Rental scope request" : "使用范围调整";
  const revision = () => {
    if (!reviewed || reviewed.identity !== context.identity || reviewed.type !== type || currentRevision === undefined) throw new Error("原对象修订尚未核对 / Review the original object revision first");
    return reviewed.revision;
  };
  const revisionChanged = Boolean(reviewed && currentRevision !== undefined && reviewed.revision !== currentRevision);
  const save = (submit: boolean) => operation.run(async () => {
    operation.assertCurrent(); if (blocked) throw new Error("当前企业申请不可提交 / Enterprise request unavailable");
    const values = await form.validateFields(), split = (value?: string) => value?.split(/[,，\n]/u).map(v => v.trim()).filter(Boolean) ?? [];
    const proposal = type === "profile_change" ? Object.fromEntries(["legalName", "registeredAddress", "email"].flatMap(key => { const value = values[key as keyof Values]; return typeof value === "string" && value.trim() ? [[key, value.trim()]] : []; }))
      : type === "credit_change" ? { requestedCreditLimit: values.requestedCreditLimit, currency: values.currency } : { workspaceIds: split(values.workspaces), categoryCodes: split(values.categories) };
    return { path: `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/management-requests`, input: { requestId: editing?.id,
      requestType: type, objectRevision: revision(), proposal, evidenceFileIds: values.evidence ?? [], submit, expectedRevision: editing?.revision ?? 0, reason: values.reason } };
  }, async () => { await refresh(); setEditing(undefined); setReviewed(undefined); form.resetFields(); }, refresh);
  return <section>
    <Alert type="info" title={english ? "A request does not change business facts" : "申请与审核不直接改变业务事实"}
      description={english ? "Credit, profile and scope changes remain with the merchant's original authorized services. Approval here does not apply a limit, confirm payment or change a ledger. Formal bill, payment-proof and dispute requests are unavailable." : "额度、主档与范围仍由商户原受权服务实际变更。此处审核通过不改额度、不确认到账、不写账本；正式账单、回款凭证及账单异议尚不可用。"} />
    {profile.error && <Alert type="error" title={profile.error instanceof Error ? profile.error.message : "企业资料读取失败"} />}
    {profile.data && !profile.error && <dl className="enterprise-review-facts">
      <dt>{english ? "Enterprise" : "企业"}</dt><dd>{profile.data.corporateName}</dd>
      <dt>{english ? "Verified legal name" : "已核验主体名称"}</dt><dd>{profile.data.legalName ?? (english ? "Not recorded" : "未记录")}</dd>
      <dt>{english ? "Legal identifier" : "主体标识"}</dt><dd>{profile.data.legalIdentifierMasked ?? (english ? "Not recorded" : "未记录")}</dd>
      <dt>{english ? "Membership" : "会员状态"}</dt><dd>{profile.data.membershipStatus}</dd>
      <dt>{english ? "Registered address" : "企业注册地址"}</dt><dd>{profile.data.registeredAddress ?? (english ? "Not recorded" : "未记录")}</dd>
    </dl>}
    {!permitted && <Alert type="warning" title={english ? "Select an enterprise with request-management authority to create a proposal" : "请选择有申请管理权的企业后新建申请；本人旧申请仍可核对"} />}
    {permitted && <Form form={form} layout="vertical" disabled={blocked} initialValues={{ evidence: [] }}>
      <Select aria-label={english ? "Request type" : "申请类别"} value={type} disabled={blocked || Boolean(editing)} options={profile.data?.requestTypes.map(value => ({ value, label: label(value) })) ?? []}
        onChange={value => { operation.assertCurrent(); setType(value as EnterpriseManagementRequestType); setReviewed(undefined); form.resetFields(); }} />
      {reviewed && <p>{english ? "Reviewed original object revision" : "已核对的原对象修订"}: {reviewed.revision}</p>}
      {revisionChanged && <Alert type="warning" title={english ? "The original object changed; your proposal keeps its reviewed revision" : "原对象已变化，申请仍保留原审阅修订"}
        description={english ? "Read the current facts and explicitly adopt the new revision before applying your proposal to them. Refresh does not rebase an unsaved request." : "先核对上方当前事实，再明确采用新修订；刷新不会把未保存申请自动绑定到新对象。"}
        action={<ActionButton disabled={blocked} intent="confirm" label={english ? "Use this reviewed current revision" : "核对后采用当前修订"} onAction={async () => { operation.assertCurrent(); if (currentRevision === undefined) throw new Error("当前原对象不可核对"); setReviewed({ identity: context.identity, type, revision: currentRevision }); }} />} />}
      {type === "profile_change" ? <>
        <Form.Item name="legalName" label={english ? "Proposed legal name" : "申请更正的主体名称"}><Input maxLength={191} /></Form.Item>
        <Form.Item name="registeredAddress" label={english ? "Proposed registered address" : "申请更正的企业注册地址"}><Input.TextArea maxLength={1000} /></Form.Item>
        <Form.Item name="email" label={english ? "Proposed contact email" : "申请更正的企业联系邮箱"}><Input maxLength={191} /></Form.Item>
      </> : type === "credit_change" ? <>
        <Form.Item name="requestedCreditLimit" label={english ? "Requested limit" : "申请额度"} rules={[{ required: true, pattern: /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u }]}><Input inputMode="decimal" /></Form.Item>
        <Form.Item name="currency" label={english ? "Original supported currency" : "原授信支持币种"} rules={[{ required: true }]}><Select options={[{ value: "CNY", label: "CNY" }]} /></Form.Item>
      </> : <>
        <Form.Item name="workspaces" label={english ? "Requested workspace references (comma-separated)" : "申请空间引用（逗号分隔）"}><Input.TextArea /></Form.Item>
        <Form.Item name="categories" label={english ? "Registered category codes (comma-separated)" : "登记品类代码（逗号分隔）"}><Input /></Form.Item>
      </>}
      <Form.Item name="reason" label={english ? "Reason" : "申请依据与原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
      <Form.Item name="evidence" label={english ? "Archived evidence references" : "已归档材料引用"}><Select mode="tags" /></Form.Item>
      <AuthorityUpload english={english} disabled={blocked} onBusy={setFileBusy} onFile={id => { operation.assertCurrent(); form.setFieldValue("evidence", [...new Set([...(form.getFieldValue("evidence") ?? []), id])]); }} />
      <SaveButton form={form} disabled={blocked} label={english ? "Save draft" : "保存草稿"} onSave={() => save(false)} />
      <SaveButton form={form} disabled={blocked} label={english ? "Request merchant review" : "提交商户审核"} onSave={() => save(true)} />
      {editing && <Button disabled={operation.blocked || fileBusy} onClick={() => { setEditing(undefined); setReviewed(undefined); form.resetFields(); }}>{english ? "Close editor" : "结束编辑"}</Button>}
    </Form>}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original request result" : "核对原申请结果"} onAction={() => operation.recover(async () => { await refresh(); setEditing(undefined); setReviewed(undefined); form.resetFields(); })} />}
    {operation.error && <Alert type="error" title={operation.error} />}
    {list.error ? <Alert type="error" title={list.error instanceof Error ? list.error.message : "本人申请读取失败"} /> : <Table rowKey="id" caption={english ? "Your management requests" : "本人企业管理申请"} dataSource={list.data ?? []} loading={list.isFetching} pagination={false} sorting={false} onRefresh={refresh} columns={[
      { title: english ? "Type" : "类别", render: (_, row: EnterpriseManagementRequestView) => label(row.requestType) }, { title: english ? "State" : "状态", dataIndex: "state" },
      { title: english ? "Reason" : "申请原因", dataIndex: "reason" }, { title: english ? "Review feedback" : "审核反馈", dataIndex: "decisionReason" },
      { title: english ? "Actions" : "操作", render: (_, row: EnterpriseManagementRequestView) => <>
        {permitted && row.corporateCustomerId === context.selectedCorporateId && ["draft", "supplement_required"].includes(row.state) && <Button disabled={blocked} onClick={() => { operation.assertCurrent(); setEditing(row); setType(row.requestType); setReviewed({ identity: context.identity, type: row.requestType, revision: row.objectRevision }); form.resetFields(); form.setFieldsValue({ ...row.proposal, reason: row.reason, evidence: row.evidenceFileIds, workspaces: row.proposal.workspaceIds?.join(","), categories: row.proposal.categoryCodes?.join(",") }); }}>{english ? "Edit original request" : "编辑原申请"}</Button>}
        {["draft", "pending", "supplement_required"].includes(row.state) && <ActionButton disabled={operation.blocked || list.isFetching} intent="confirm" label={english ? "Explicitly withdraw" : "明确撤回"} onAction={() => operation.run(() => ({ path: `/enterprise/management-requests/${encodeURIComponent(row.id)}/withdraw`, input: { expectedRevision: row.revision, reason: "本人明确撤回企业管理申请，原业务事实不变" } }), refresh, refresh)} />}
      </> },
    ]} />}
  </section>;
}
