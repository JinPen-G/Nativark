/** Customer-owned application and membership pages; no operator endpoint is called.
 * Each page shares one original-operation gate across all form and row actions. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ClientPublicDocumentResponse, EnterpriseApplicationInput, EnterpriseInviteCreated, EnterpriseInviteView, EnterpriseWorkflowView, EnterpriseOwnRelation, EnterpriseInvitePreview } from "@rental-os/shared";
import { ActionButton, Alert, Button, Checkbox, Form, Input, SaveButton, Table } from "@/components/ui/customer-entry";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
import { AuthorityUpload } from "./AuthorityUpload";
import { EnterpriseWorkflowReview } from "./WorkflowReview";
import { clearEnterpriseInvite, readEnterpriseInvite } from "@rental-os/web-client";

type OriginalOperation = ReturnType<typeof useOriginalWorkflowOperation>;
function OperationStatus({ operation, refresh, en, onRecovered }: { operation: OriginalOperation; refresh: () => Promise<void>; en: boolean; onRecovered?: (path?: string) => void }) {
  return <>
    {operation.pending && <>
      <Alert type={operation.pending.state === "committed" ? "info" : "warning"} title={operation.pending.state === "committed"
        ? (en ? "The operation committed. Refresh only; do not send it again." : "操作已提交；只能刷新结果，不要再次发送。")
        : (en ? "The outcome is unconfirmed. Keep the original request; a missing receipt does not mean no write." : "结果待核对，请保留原请求；没有收据不代表未写入。")}/>
      <ActionButton disabled={operation.busy} label={operation.pending.state === "committed" ? (en ? "Refresh committed result" : "刷新已提交结果") : (en ? "Read original result" : "核对原操作")}
        intent="review" onAction={() => operation.recover(async (_, path) => { await refresh(); operation.assertCurrent(); onRecovered?.(path); })} />
    </>}
    {operation.error && <Alert type="error" title={operation.error}/>}</>;
}

export function EnterpriseApplicationPage() {
  const context = useEnterprise(), { locale } = useLocale(), en = locale === "en-US";
  const operation = useOriginalWorkflowOperation("applications");
  const [editing, setEditing] = useState<EnterpriseWorkflowView>(), [fileBusy, setFileBusy] = useState(false), [accepted, setAccepted] = useState(false);
  const [form] = Form.useForm<EnterpriseApplicationInput>();
  const list = useQuery({ queryKey: ["enterprise-applications", context.identity], queryFn: ({ signal }) => operation.read<EnterpriseWorkflowView[]>("/enterprise/applications", signal) });
  const agreement = useQuery({ queryKey: ["enterprise-agreement", context.identity], queryFn: ({ signal }) => operation.read<ClientPublicDocumentResponse>(`/public/documents/user_agreement?tenantCode=${encodeURIComponent(context.tenantCode)}`, signal) });
  const unavailable = context.loading || operation.blocked || fileBusy || list.isFetching || Boolean(list.error) || !list.data;
  useEffect(() => { setEditing(undefined); setAccepted(false); form.resetFields(); }, [context.identity, form]);
  useEffect(() => { setAccepted(false); }, [agreement.data?.version]);
  const refresh = async () => { await list.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const refreshRevision = async () => {
    const result = await list.refetch({ throwOnError: true }); operation.assertCurrent();
    // Refresh the revision, not the unsaved values. A disappeared/non-editable draft cannot become a new application.
    if (editing) {
      const latest = result.data?.find(row => row.id === editing.id);
      if (!latest) throw new Error(en ? "The original application is no longer readable." : "原申请已不可读取，请保留表单并核对。");
      setEditing(latest);
    }
  };
  const save = (submit: boolean) => operation.run(async () => {
    if (unavailable) throw new Error(en ? "Read the current applications first." : "请先读取当前申请。");
    const application = await form.validateFields(); operation.assertCurrent();
    if (editing && !["draft", "supplement_required"].includes(editing.state)) throw new Error(en ? "This application is no longer editable." : "原申请状态已不允许编辑，请核对处理结果。");
    const evidenceFileIds = typeof application.evidenceFileIds === "string" ? String(application.evidenceFileIds).split(",").map(x => x.trim()).filter(Boolean) : application.evidenceFileIds ?? [];
    if (submit && (!accepted || !agreement.data?.body || !agreement.data.version || agreement.error)) throw new Error(en ? "Read and explicitly accept this merchant's current agreement." : "请读取并明确同意当前商户协议；缺正文或版本时不能提交。");
    return { path: "/enterprise/applications", input: { requestId: editing?.id, expectedRevision: editing?.revision ?? 0,
      reason: submit ? "本人提交企业申请" : "本人保存企业申请草稿", submit, application: { ...application, evidenceFileIds, agreementVersion: agreement.data?.version ?? application.agreementVersion, agreementAcknowledged: submit && accepted } } };
  }, async () => { await refresh(); setEditing(undefined); form.resetFields(); }, refreshRevision);
  return <section><h2>{en ? "Apply for enterprise membership" : "申请企业会员"}</h2>
    <Alert type="info" title={en ? "An application is not approval. The merchant verifies your authority." : "提交仅是申请，由商户核验企业及代表资格。"}/>
    <Form form={form} layout="vertical" disabled={unavailable}>
      {[["legalName", "企业法定名称 / Legal name"], ["region", "地区代码 / Region"], ["legalIdentifier", "主体标识 / Legal identifier"], ["contactName", "联系人 / Contact"], ["contactPhone", "联系电话 / Phone"], ["email", "邮箱 / Email"], ["existingCorporateCustomerId", "存量企业引用（仅商户提供） / Existing reference"], ["agreementVersion", "商户协议版本 / Agreement version"], ["authorityStatement", "代表资格说明 / Authority statement"], ["evidenceFileIds", "已归档授权附件引用（逗号分隔） / Evidence references"]].map(([name, label]) =>
        <Form.Item key={name} name={name} label={label} rules={!["email", "existingCorporateCustomerId", "evidenceFileIds"].includes(name) ? [{ required: true, whitespace: true }] : []}><Input maxLength={name === "authorityStatement" ? 2000 : 191}/></Form.Item>)}
      <Alert type="info" title={en ? "Only real archived authority files are accepted. If storage is unavailable, save a draft." : "提交只接受真实归档授权材料；存储未配置时可保存草稿，不能假归档。"}/>
    </Form>
    <AuthorityUpload english={en} disabled={operation.blocked || Boolean(list.error)} onBusy={setFileBusy} onFile={id => { const previous = form.getFieldValue("evidenceFileIds"); const ids = Array.isArray(previous) ? previous : String(previous ?? "").split(",").filter(Boolean); form.setFieldValue("evidenceFileIds", [...new Set([...ids, id])].join(",")); }} />
    {agreement.error ? <Alert type="error" title={en ? "Merchant agreement could not be read" : "商户协议读取失败，不能提交"} /> : agreement.data?.body ? <details><summary>{agreement.data.name} / {agreement.data.version}</summary><pre>{agreement.data.body}</pre></details> : <Alert type="warning" title={en ? "No in-app merchant agreement text; submission unavailable" : "商户协议正文未提供，暂不能提交；不打开未经核验的外部链接"} />}
    <Checkbox checked={accepted} disabled={unavailable || !agreement.data?.body} onChange={event => { setAccepted(event.target.checked); if (agreement.data?.version) form.setFieldValue("agreementVersion", agreement.data.version); }}>{en ? "I have read and accept the current merchant agreement" : "我已阅读并同意当前商户协议"}</Checkbox>
    <ActionButton disabled={unavailable} label={en ? "Save draft" : "保存草稿"} intent="save" onAction={() => save(false)}/>
    <ActionButton disabled={unavailable || !accepted || !agreement.data?.body} label={en ? "Submit application" : "提交申请"} intent="confirm" onAction={() => save(true)}/>
    <OperationStatus operation={operation} refresh={refresh} en={en} onRecovered={path => {
      if (path === "/enterprise/applications" || path === `/enterprise/applications/${encodeURIComponent(editing?.id ?? "")}/withdraw`) { setEditing(undefined); form.resetFields(); }
    }}/>
    {list.error && <Alert type="error" title={String(list.error)}/>}
    <ActionButton disabled={operation.blocked || list.isFetching} label={en ? "Refresh applications" : "重新读取申请"} intent="refresh" onAction={refresh}/>
    <Table rowKey="id" dataSource={list.error ? [] : list.data ?? []} loading={list.isFetching} sorting={false} pagination={false} onRefresh={refresh} columns={[
      { title: en ? "State" : "状态", dataIndex: "state" }, { title: en ? "Revision" : "修订", dataIndex: "revision" }, { title: en ? "Reason" : "处理原因", dataIndex: "decisionReason" },
      { title: en ? "Actions" : "操作", render: (_, row: EnterpriseWorkflowView) => <>
        {["draft", "supplement_required"].includes(row.state) && <Button disabled={unavailable} onClick={() => { operation.assertCurrent(); setEditing(row); form.resetFields(); form.setFieldsValue({ ...row.payload, evidenceFileIds: (row.payload.evidenceFileIds as string[] ?? []).join(",") } as unknown as EnterpriseApplicationInput); }}>{en ? "Edit" : "编辑"}</Button>}
        {["draft", "pending", "supplement_required"].includes(row.state) && <ActionButton disabled={unavailable} label={en ? "Withdraw" : "撤回"} intent="confirm"
          onAction={() => operation.run(() => ({ path: `/enterprise/applications/${encodeURIComponent(row.id)}/withdraw`, input: { expectedRevision: row.revision, reason: "申请人明确撤回" } }), async () => {
            await refresh(); if (editing?.id === row.id) { setEditing(undefined); form.resetFields(); }
          }, refreshRevision)}/>}
      </> }]}/>
  </section>;
}

export function EnterpriseJoinPage() {
  const context = useEnterprise(), { locale } = useLocale(), en = locale === "en-US", operation = useOriginalWorkflowOperation("join");
  const [form] = Form.useForm<{ inviteCode: string; department?: string; employeeNo?: string; agreementVersion: string; acknowledged: boolean }>();
  const [preview, setPreview] = useState<{ code: string; value: EnterpriseInvitePreview }>(), [previewBusy, setPreviewBusy] = useState(false), [previewError, setPreviewError] = useState("");
  const previewLock = useRef(false), previewOwner = useRef(context.identity); previewOwner.current = context.identity;
  const previewMounted = useRef(true);
  useEffect(() => { previewMounted.current = true; return () => { previewMounted.current = false; }; }, []);
  useEffect(() => {
    form.resetFields();
    setPreview(undefined); setPreviewError(""); setPreviewBusy(false);
    try { const code = readEnterpriseInvite(context.basePath); if (code) form.setFieldValue("inviteCode", code); }
    catch { setPreviewError(en ? "Reopen the original invitation after sign-in." : "请在登录后重新打开原邀请链接。"); }
  }, [context.identity]);
  const previewInvite = async () => {
    operation.assertCurrent(); if (previewLock.current || operation.blocked) return; previewLock.current = true; setPreviewBusy(true); setPreviewError("");
    try {
      const code = String(form.getFieldValue("inviteCode") ?? "").trim();
      const value = await context.write<EnterpriseInvitePreview>("/enterprise/invites/preview", { inviteCode: code }); operation.assertCurrent();
      if (form.getFieldValue("inviteCode") !== code) throw new Error("邀请已变化，请重新核对");
      setPreview({ code, value }); form.setFieldsValue({ agreementVersion: value.agreementVersion, acknowledged: false });
    } catch (e) { if (previewMounted.current && previewOwner.current === context.identity) setPreviewError(e instanceof Error ? e.message : "邀请不可用"); throw e; }
    finally { previewLock.current = false; if (previewMounted.current && previewOwner.current === context.identity) setPreviewBusy(false); }
  };
  const mine = useQuery({ queryKey: ["enterprise-my-requests", context.identity], queryFn: ({ signal }) => operation.read<EnterpriseWorkflowView[]>("/enterprise/my-requests", signal) });
  const relations = useQuery({ queryKey: ["enterprise-own-relations", context.identity], queryFn: ({ signal }) => operation.read<EnterpriseOwnRelation[]>("/enterprise/my-relations", signal) });
  const unavailable = context.loading || operation.blocked || mine.isFetching || Boolean(mine.error) || !mine.data;
  const refresh = async () => { await Promise.all([mine.refetch({ throwOnError: true }), relations.refetch({ throwOnError: true })]); operation.assertCurrent(); };
  return <section><h2>{en ? "Join an enterprise" : "申请加入企业"}</h2>
    <Form form={form} layout="vertical" disabled={unavailable}>
      <Form.Item name="inviteCode" label={en ? "Invite code" : "邀请码"} rules={[{ required: true, whitespace: true }]}><Input autoComplete="off" maxLength={128} disabled={previewBusy} onChange={() => { setPreview(undefined); form.setFieldValue("acknowledged", false); }}/></Form.Item>
      <ActionButton disabled={unavailable || previewBusy} intent="review" label={en ? "Read invitation details" : "核对邀请说明"} onAction={previewInvite}/>
      {preview && <Alert type="info" title={preview.value.corporateName} description={`${preview.value.noticeText} / ${preview.value.expiresAt}`} />}
      {previewError && <Alert type="error" title={previewError} />}
      <Form.Item name="department" label={en ? "Department" : "部门"}><Input maxLength={120}/></Form.Item>
      <Form.Item name="employeeNo" label={en ? "Employee number" : "工号"}><Input maxLength={80}/></Form.Item>
      <Form.Item name="agreementVersion" label={en ? "Notice version" : "企业告知版本"} rules={[{ required: true, whitespace: true }]}><Input maxLength={191} readOnly/></Form.Item>
      <Form.Item name="acknowledged" valuePropName="checked" rules={[{ validator: (_, v) => v ? Promise.resolve() : Promise.reject(new Error(en ? "Confirm enterprise order visibility." : "请确认企业身份订单可被受权管理员查看")) }]}>
        <Checkbox>{en ? "I understand enterprise identity orders, including personal payment with enterprise benefits, are visible to authorized administrators; personal orders remain private." : "我知悉企业身份订单（包括企业优惠个人付款）可被受权管理员查看，纯个人订单仍独立。"}</Checkbox>
      </Form.Item>
      <SaveButton form={form} disabled={unavailable || previewBusy || !preview} label={en ? "Request to join" : "提交加入申请"} onSave={values => operation.run(() => {
        if (!preview || preview.code !== values.inviteCode || preview.value.agreementVersion !== values.agreementVersion) throw new Error("须先核对本邀请企业及当前告知");
        return { path: "/enterprise/join", input: { ...values, noticeHash: preview.value.noticeHash, expectedRevision: 0, reason: "本人确认加入企业" } };
      }, async () => { await refresh(); clearEnterpriseInvite(context.basePath); form.resetFields(); setPreview(undefined); }, refresh)}/>
    </Form>
    <OperationStatus operation={operation} refresh={refresh} en={en} onRecovered={path => { if (path === "/enterprise/join") clearEnterpriseInvite(context.basePath); form.resetFields(); }}/>
    {relations.error && <Alert type="error" title={en ? "Your enterprise relationships could not be read" : "本人企业关系读取失败"} />}
    <h3>{en ? "Your enterprise relationships" : "本人企业关系"}</h3>
    <Alert type="info" title={en ? "Exit ends new enterprise authority, not existing rental responsibilities" : "主动退出终止新企业消费权，不删除个人会员或已成立订单"}
      description={en ? "Contact the merchant for ongoing handover. The final administrator must arrange an accepted handoff first." : "有在途租赁请联系商户安排交接；最后管理员须先完成对方已接受的交接。"} />
    <Table rowKey="membershipId" sorting={false} pagination={false} dataSource={relations.error ? [] : relations.data ?? []} loading={relations.isFetching} onRefresh={refresh} columns={[
      { title: en ? "Enterprise" : "企业", dataIndex: "corporateName" }, { title: en ? "Role" : "角色", dataIndex: "role" }, { title: en ? "State" : "关系状态", dataIndex: "status" },
      { title: en ? "Actions" : "操作", render: (_, relation: EnterpriseOwnRelation) => relation.status !== "exited" ? <ActionButton disabled={operation.blocked || relations.isFetching} intent="confirm"
        label={en ? "Explicitly exit this enterprise" : "明确退出本企业"} onAction={() => operation.run(() => ({ path: `/enterprise/corporates/${encodeURIComponent(relation.corporateCustomerId)}/members/${encodeURIComponent(relation.membershipId)}/exit`,
          input: { status: "exited", expectedRevision: 0, expectedUpdatedAt: relation.updatedAt, reason: en ? "The member explicitly exits this enterprise" : "本人明确退出本企业，原订单责任不变" } }), refresh, refresh)} /> : null }
    ]} />
    {mine.error && <Alert type="error" title={String(mine.error)}/>}
    <Table rowKey="id" sorting={false} pagination={false} dataSource={mine.error ? [] : mine.data ?? []} loading={mine.isFetching} onRefresh={refresh} columns={[
      { title: en ? "Kind" : "申请类型", dataIndex: "kind" }, { title: en ? "State" : "状态", dataIndex: "state" }, { title: en ? "Decision reason" : "处理原因", dataIndex: "decisionReason" },
      { title: en ? "Original material" : "原申请材料", render: (_, row: EnterpriseWorkflowView) => <details><summary>{en ? "Read this original request" : "核对本条原申请"}</summary><EnterpriseWorkflowReview row={row} english={en} /></details> },
      { title: en ? "Actions" : "操作", render: (_, row: EnterpriseWorkflowView) => row.state === "pending" ? <>
        {row.kind === "join_request" && <ActionButton disabled={unavailable} label={en ? "Withdraw request" : "撤回加入申请"} intent="confirm" onAction={() => operation.run(() => ({ path: `/enterprise/join-requests/${encodeURIComponent(row.id)}/withdraw`, input: { expectedRevision: row.revision, reason: "本人明确撤回加入申请" } }), refresh, refresh)}/>}
        {row.kind === "administrator_transfer" && <>
          <ActionButton disabled={unavailable} label={en ? "Accept transfer" : "接受管理员交接"} intent="confirm" onAction={async () => {
            await operation.run(() => ({ path: `/enterprise/transfers/${encodeURIComponent(row.id)}/decision`, input: { expectedRevision: row.revision, accept: true, reason: "本人明确接受管理员交接" } }), refresh, refresh);
            operation.assertCurrent(); context.reload();
          }}/>
          <ActionButton disabled={unavailable} label={en ? "Decline transfer" : "拒绝管理员交接"} intent="confirm" onAction={() => operation.run(() => ({ path: `/enterprise/transfers/${encodeURIComponent(row.id)}/decision`, input: { expectedRevision: row.revision, accept: false, reason: "本人明确拒绝管理员交接，原授权不改变" } }), refresh, refresh)} />
        </>}
      </> : null }]}/>
  </section>;
}

export function EnterpriseInvitesPage() {
  const context = useEnterprise(), id = context.selectedCorporateId, { locale } = useLocale(), en = locale === "en-US", operation = useOriginalWorkflowOperation("invites");
  const [code, setCode] = useState<{ identity: string; value: string }>(), [form] = Form.useForm<{ lifetimeHours: number; maxUses: number }>();
  const list = useQuery({ queryKey: ["enterprise-invites", context.identity], queryFn: ({ signal }) => operation.read<EnterpriseInviteView[]>(`/enterprise/corporates/${encodeURIComponent(id)}/invites`, signal), enabled: Boolean(id) });
  const unavailable = !id || context.loading || operation.blocked || list.isFetching || Boolean(list.error) || !list.data;
  useEffect(() => { setCode(undefined); form.resetFields(); }, [context.identity, form]);
  const refresh = async () => { await list.refetch({ throwOnError: true }); operation.assertCurrent(); };
  return <section><h2>{en ? "Invitations" : "邀请管理"}</h2>
    <Form form={form} layout="vertical" disabled={unavailable}>
      <Form.Item name="lifetimeHours" label={en ? "Lifetime hours" : "有效小时数"} rules={[{ required: true }]}><Input type="number" min={1} max={8760} step={1}/></Form.Item>
      <Form.Item name="maxUses" label={en ? "Maximum uses" : "允许人数"} rules={[{ required: true }]}><Input type="number" min={1} max={1000} step={1}/></Form.Item>
      <SaveButton form={form} disabled={unavailable} label={en ? "Create invite" : "生成邀请"} onSave={v => operation.run<EnterpriseInviteCreated>(() => ({ path: `/enterprise/corporates/${encodeURIComponent(id)}/invites`, input: { lifetimeHours: Number(v.lifetimeHours), maxUses: Number(v.maxUses), expectedRevision: 0, reason: "管理员显式创建企业邀请" } }), async result => { operation.assertCurrent(); setCode(result.code ? { identity: context.identity, value: result.code } : undefined); await refresh(); }, refresh)}/>
    </Form>
    {code?.identity === context.identity && <>
      <p>{en ? "Copy now; this code cannot be read again" : "请现在复制，原码不再回读"}：<code>{code.value}</code></p>
      <ActionButton intent="none" label={en ? "Copy invite code" : "复制邀请码"} onAction={async () => { operation.assertCurrent(); await navigator.clipboard.writeText(code.value); operation.assertCurrent(); }}/>
      <ActionButton intent="none" label={en ? "Copy registered invitation link" : "复制本商户邀请链接"} onAction={async () => {
        operation.assertCurrent(); const link = new URL(`${context.basePath}/join`, window.location.origin); link.hash = new URLSearchParams({ invite: code.value }).toString();
        await navigator.clipboard.writeText(link.href); operation.assertCurrent();
      }}/>
    </>}
    <OperationStatus operation={operation} refresh={refresh} en={en}/>
    {list.error && <Alert type="error" title={String(list.error)}/>}
    <Table rowKey="id" dataSource={list.error ? [] : list.data ?? []} loading={list.isFetching} sorting={false} pagination={false} onRefresh={refresh} columns={[
      { title: en ? "State" : "状态", dataIndex: "status" }, { title: en ? "Expires" : "到期", dataIndex: "expiresAt" }, { title: en ? "Used" : "已占用", dataIndex: "used" }, { title: en ? "Limit" : "上限", dataIndex: "maxUses" },
      { title: en ? "Actions" : "操作", render: (_, row: EnterpriseInviteView) => row.status === "active" ? <ActionButton disabled={unavailable} label={en ? "Revoke" : "停用"} intent="confirm"
        onAction={() => operation.run(() => ({ path: `/enterprise/corporates/${encodeURIComponent(id)}/invites/${encodeURIComponent(row.id)}/revoke`, input: { expectedRevision: row.revision, reason: "管理员停用邀请" } }), refresh, refresh)}/> : null }]}/>
  </section>;
}

export function EnterpriseJoinReviewPage() {
  const context = useEnterprise(), id = context.selectedCorporateId, { locale } = useLocale(), en = locale === "en-US", operation = useOriginalWorkflowOperation("join-review");
  const [selection, setSelection] = useState<{ identity: string; id: string; revision: number; reason: string }>();
  const selected = selection?.identity === context.identity ? selection : undefined;
  const list = useQuery({ queryKey: ["enterprise-join-review", context.identity], enabled: Boolean(id), queryFn: ({ signal }) => operation.read<EnterpriseWorkflowView[]>(`/enterprise/corporates/${encodeURIComponent(id)}/join-requests`, signal) });
  const unavailable = !id || context.loading || operation.blocked || list.isFetching || Boolean(list.error) || !list.data;
  useEffect(() => setSelection(undefined), [context.identity]);
  const refresh = async () => { await list.refetch({ throwOnError: true }); operation.assertCurrent(); };
  return <section><h2>{en ? "Join requests" : "加入审核"}</h2>
    {list.error && <Alert type="error" title={String(list.error)}/>}
    <OperationStatus operation={operation} refresh={refresh} en={en} onRecovered={() => setSelection(undefined)}/>
    <Table rowKey="id" sorting={false} pagination={false} dataSource={list.error ? [] : list.data ?? []} loading={list.isFetching} onRefresh={refresh} columns={[
      { title: en ? "Applicant" : "申请人", dataIndex: "applicantCustomerId" }, { title: en ? "State" : "状态", dataIndex: "state" }, { title: en ? "Decision reason" : "处理原因", dataIndex: "decisionReason" },
      { title: en ? "Actions" : "操作", render: (_, row: EnterpriseWorkflowView) => row.state === "pending" ? selected?.id === row.id && selected.revision === row.revision ? <>
        <EnterpriseWorkflowReview row={row} english={en} />
        <Input.TextArea aria-label={en ? "Review reason for this request" : "本条加入申请审核原因"} value={selected.reason} disabled={unavailable} onChange={event => setSelection({ ...selected, reason: event.target.value })} maxLength={500} />
        {(["approve", "reject"] as const).map(decision => <ActionButton key={decision} disabled={unavailable || !selected.reason.trim()} label={decision === "approve" ? (en ? "Approve" : "批准加入") : (en ? "Reject" : "拒绝")} intent="confirm" onAction={() => operation.run(() => {
          operation.assertCurrent(); if (selected.id !== row.id || selected.revision !== row.revision || !selected.reason.trim()) throw new Error(en ? "Review this original request first." : "请先核对本条原加入申请。");
          return { path: `/enterprise/corporates/${encodeURIComponent(id)}/join-requests/${encodeURIComponent(row.id)}/decision`, input: { decision, expectedRevision: row.revision, reason: selected.reason.trim() } };
        }, async () => { await refresh(); setSelection(undefined); }, refresh)}/>)}
      </> : <ActionButton disabled={unavailable} intent="review" label={en ? "Review this request" : "核对本条加入申请"} onAction={async () => { operation.assertCurrent(); setSelection({ identity: context.identity, id: row.id, revision: row.revision, reason: "" }); }} /> : <details><summary>{en ? "Read original feedback" : "核对原处理结果"}</summary><EnterpriseWorkflowReview row={row} english={en} /></details> }]}/>
  </section>;
}
