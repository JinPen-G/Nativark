/** Quote review is separate from applicant submission and original-result recovery. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatRentalMoney, type EnterpriseApprovalOriginalResult, type EnterpriseBookingApprovalView, type EnterpriseOperationResult,
  type EnterpriseOrderDelegationOriginal, type EnterpriseOrderDelegationRequestReference, type RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { ActionButton, Alert, Checkbox, Form, Input, SaveButton, Select, Table } from "@/components/ui/customer-entry";
import { formSnapshotFingerprint } from "@/app/serverFormSnapshot";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
import { approvalReviewKey } from "./ApprovalReview";
import { EnterpriseApprovalDecision } from "./ApprovalDecision";
export function EnterpriseApprovalsPage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const [mode, setMode] = useState("mine"), [selected, setSelected] = useState("");
  const [form] = Form.useForm<{ quoteId: string; purpose: string }>();
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === context.selectedCorporateId);
  const canReview = Boolean(corporate?.actions.includes("approvals:review"));
  const operation = useOriginalWorkflowOperation(`approvals:${mode}`);
  // Sealing an unresolved execution is a different explicit command, not a retry
  // or replacement of its original submission. Keep both receipts independently.
  const closureOperation = useOriginalWorkflowOperation("approval-execution-close");
  const path = mode === "review" ? `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/approvals` : "/enterprise/my-approvals";
  const rows = useQuery({ queryKey: ["enterprise-approvals", context.identity, mode], enabled: Boolean(context.session && (mode !== "review" || canReview)), queryFn: ({ signal }) => operation.read<EnterpriseBookingApprovalView[]>(path, AbortSignal.any([signal, context.signal])) });
  useEffect(() => { setMode("mine"); setSelected(""); form.resetFields(); }, [context.identity]);
  const refresh = async () => { await rows.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const review = !rows.error && (mode !== "review" || canReview) ? rows.data?.find(row => row.id === selected) : undefined;
  const recoverSubmission = async (receipt?: EnterpriseOperationResult, originalPath?: string) => {
    if (originalPath === "/enterprise/approvals/submit") {
      const id = receipt?.result?.approvalId;
      // In-memory committed responses still need the original receipt's target.
      const original = id ? receipt : operation.pending ? await operation.read<EnterpriseOperationResult>(`/enterprise/operations/${encodeURIComponent(operation.pending.key)}`) : undefined;
      if (original?.state !== "committed" || typeof original.result?.approvalId !== "string") throw new Error("原执行批准引用尚未核对 / Original approval reference unavailable");
      const result = await operation.read<EnterpriseApprovalOriginalResult>(`/enterprise/approvals/${encodeURIComponent(original.result.approvalId)}/result`);
      if (result.approval.id !== original.result.approvalId || result.retryable !== false || result.original.retryable !== false
        || !(result.original.state === "closed" && result.approval.state === "closed" && !result.approval.orderId
          || result.original.state === "observed" && result.approval.state === "consumed" && typeof result.original.orderId === "string" && result.original.orderId === result.approval.orderId)) throw new Error("原执行仍待核对；只能读取或明确请求受控结束 / Original execution unresolved");
    }
    await refresh();
  };
  return <section>
    <Alert type="info" title={english ? "Approval does not place an order" : "批准不自动下单，也不预占库存或额度"} description={english ? "The applicant must verify the original quote and explicitly submit. Unknown submission is checked by its original reference; never submit again with a new key. This list covers the current customer workspace only." : "申请员工返回原请求，核对仍有效的报价与主体后明确提交。提交失应答只查原收据，不换键重做；Core仍核验资格、库存、资金和商户订单审核。当前列表只覆盖客户会话的经营空间。"} />
    <Select aria-label={english ? "Approval view" : "审批视图"} value={mode} disabled={operation.blocked} options={[{ value: "mine", label: english ? "My requests" : "本人申请" }, ...(canReview ? [{ value: "review", label: english ? "Enterprise review queue" : "企业待审核" }] : [])]} onChange={value => { setSelected(""); setMode(value); }} />
    {mode === "mine" && <Form form={form} layout="vertical" disabled={operation.blocked}>
      <Form.Item name="quoteId" label={english ? "Original Core quote reference" : "原Core报价引用"} rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
      <Form.Item name="purpose" label={english ? "Purpose" : "用途"} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
      <SaveButton form={form} disabled={operation.blocked} label={english ? "Request approval" : "申请企业付费批准"} onSave={() => operation.run(async () => { const values = await form.validateFields(); return { path: "/enterprise/approvals", input: { ...values, expectedRevision: 0, reason: values.purpose } }; }, async () => { await refresh(); form.resetFields(); }, refresh)} />
    </Form>}
    {mode === "review" && !canReview ? <Alert type="warning" title={english ? "Approval viewing is no longer granted" : "当前审批查看权已撤销"} /> : rows.error ? <Alert type="error" title={rows.error instanceof Error ? rows.error.message : "读取失败"} /> : <Table rowKey="id" caption={english ? "Approval requests" : "预约审批"} dataSource={rows.data ?? []} loading={rows.isFetching} pagination={false} sorting={false} onRefresh={refresh} columns={[
      { title: english ? "Reference" : "申请引用", dataIndex: "id" }, { title: english ? "Applicant" : "申请人", render: (_, row: EnterpriseBookingApprovalView) => row.quote.applicantName ?? row.applicantCustomerId },
      { title: english ? "Purpose" : "用途", dataIndex: "purpose" }, { title: english ? "State" : "状态", dataIndex: "state" },
      { title: english ? "Rental payable" : "租赁应付", render: (_, row: EnterpriseBookingApprovalView) => `${row.amount} ${row.currency}` },
      { title: english ? "Actions" : "操作", key: "actions", render: (_, row: EnterpriseBookingApprovalView) => <ActionButton disabled={operation.busy || closureOperation.busy || rows.isFetching} intent="review" label={english ? "Review this request" : "核对本条申请"} onAction={async () => { operation.assertCurrent(); setSelected(row.id); }} /> },
    ]} />}
    {review && <EnterpriseApprovalDecision key={approvalReviewKey(`${context.identity}:${mode}`, review)} row={review} reviewMode={mode === "review"}
      english={english} operation={operation} closureOperation={closureOperation} refresh={refresh} unavailable={rows.isFetching} canDecide={review.applicantCustomerId !== context.session?.customer.customerId} />}
    {mode === "mine" && <EnterpriseOrderDelegationControls approval={review} english={english} refresh={refresh} />}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original operation" : "核对原操作"} onAction={() => operation.recover(recoverSubmission)} />}
    {closureOperation.pending && <ActionButton disabled={closureOperation.busy || operation.busy} intent="review" label={english ? "Read original closure result" : "核对原封闭请求结果"} onAction={() => closureOperation.recover(refresh)} />}
    {closureOperation.error && <Alert type="error" title={closureOperation.error} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
}

function EnterpriseOrderDelegationControls({ approval, english, refresh }: { approval?: EnterpriseBookingApprovalView; english: boolean; refresh: () => Promise<void> }) {
  const context = useEnterprise(), operation = useOriginalWorkflowOperation("order-delegations"), mounted = useRef(true);
  const [kind, setKind] = useState("approval"), [quoteId, setQuoteId] = useState(""), [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false), [revokeConfirmed, setRevokeConfirmed] = useState(false), [key, setKey] = useState("");
  const [material, setMaterial] = useState<{ reference: EnterpriseOrderDelegationRequestReference; expectedRevision: number; data: EnterpriseApprovalOriginalResult | RentalQuoteSnapshotV1; hash: string }>();
  const [original, setOriginal] = useState<EnterpriseOrderDelegationOriginal>();
  const latest = useRef({ kind, quoteId, reason, confirmed, material, key, revokeConfirmed, approvalId: approval?.id }); latest.current = { kind, quoteId, reason, confirmed, material, key, revokeConfirmed, approvalId: approval?.id };
  useEffect(() => { mounted.current = true; setMaterial(undefined); setOriginal(undefined); setKey(""); setReason(""); setQuoteId(""); setConfirmed(false); setRevokeConfirmed(false);
    return () => { mounted.current = false; }; }, [context.identity]);
  useEffect(() => { setMaterial(undefined); setConfirmed(false); }, [kind, quoteId, approval?.id, approval?.revision]);
  const current = () => { operation.assertCurrent(); if (!mounted.current) throw new Error("原委托页面已变化 / Original delegation view changed"); };
  const readMaterial = async (reference: EnterpriseOrderDelegationRequestReference) => {
    current();
    const data = "approvalId" in reference
      ? await operation.read<EnterpriseApprovalOriginalResult>(`/enterprise/approvals/${encodeURIComponent(reference.approvalId)}/result`)
      : await operation.read<RentalQuoteSnapshotV1>(`/quotes/${encodeURIComponent(reference.quoteId)}`);
    current();
    if ("approvalId" in reference) {
      const result = data as EnterpriseApprovalOriginalResult;
      if (result.approval.id !== reference.approvalId || result.approval.applicantCustomerId !== context.session?.customer.customerId
        || result.approval.state !== "approved" || result.original.state !== "not_submitted" || result.retryable !== false) throw new Error("原本人批准不可委托 / Original applicant approval unavailable");
    } else {
      const quote = data as RentalQuoteSnapshotV1, snapshot = quote.membershipSnapshot;
      if (quote.id !== reference.quoteId || quote.request.customerId !== context.session?.customer.customerId || quote.consumedAt || quote.consumedOrderId
        || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now() || !snapshot?.enterpriseContractAndPayer
        || snapshot.enterpriseBasis?.approvalMode !== "without_per_order" || snapshot.enterpriseBasis.guaranteePayer !== "enterprise") throw new Error("原免逐单企业报价不可委托 / Original authorized enterprise quote unavailable");
    }
    return { reference, expectedRevision: "approval" in data ? data.approval.revision : 0, data, hash: formSnapshotFingerprint(data) };
  };
  const inspect = async () => {
    const selection = { kind: latest.current.kind, quoteId: latest.current.quoteId, approvalId: approval?.id };
    const reference = selection.kind === "approval" && selection.approvalId ? { approvalId: selection.approvalId } : { quoteId: selection.quoteId.trim() };
    const value = await readMaterial(reference); current();
    if (selection.kind !== latest.current.kind || selection.quoteId !== latest.current.quoteId || selection.approvalId !== latest.current.approvalId) throw new Error("原委托定位已变化 / Original delegation reference changed");
    setMaterial(value); setConfirmed(false);
  };
  const readSource = async (sourceKey: string) => {
    current(); const value = await operation.read<EnterpriseOrderDelegationOriginal>(`/enterprise/order-delegations/${encodeURIComponent(sourceKey)}`); current();
    if (value.delegationKey !== sourceKey || value.retryable !== false) throw new Error("原委托键或收据不一致 / Original delegation key mismatch");
    return value;
  };
  const finish = async (value: EnterpriseOrderDelegationOriginal, sourceKey: string, reference?: EnterpriseOrderDelegationRequestReference) => {
    if (value.delegationKey !== sourceKey || value.state === "not_recorded") throw new Error("原委托仍待核对 / Original delegation unresolved");
    if (reference && formSnapshotFingerprint(value.requestReference) !== formSnapshotFingerprint(reference)) throw new Error("原委托请求引用不一致 / Original delegation request mismatch");
    const actual = await readSource(sourceKey); if (actual.state === "not_recorded") throw new Error("原委托仍待核对 / Original delegation unresolved");
    setKey(sourceKey); setOriginal(actual); setConfirmed(false); setRevokeConfirmed(false); await refresh();
  };
  const issue = () => {
    const reviewed = latest.current.material, frozenReason = latest.current.reason.trim(), explicit = latest.current.confirmed;
    return operation.run<EnterpriseOrderDelegationOriginal>(async () => {
      current(); if (!reviewed || !explicit || !latest.current.confirmed || !frozenReason) throw new Error("须本人读取原请求并明确确认 / Read and explicitly confirm the original request");
      const fresh = await readMaterial(reviewed.reference); current();
      if (latest.current.material !== reviewed || !latest.current.confirmed || latest.current.reason.trim() !== frozenReason || fresh.hash !== reviewed.hash) throw new Error("原请求、确认或原因已变化 / Original request or confirmation changed");
      return { path: "/enterprise/order-delegations/issue", input: { requestReference: reviewed.reference, expectedRevision: reviewed.expectedRevision, confirm: true, reason: frozenReason } };
    }, value => finish(value, value.delegationKey, reviewed?.reference), refresh);
  };
  const revoke = () => {
    const source = original, sourceKey = key, frozenReason = reason.trim(), explicit = revokeConfirmed;
    return operation.run<EnterpriseOrderDelegationOriginal>(async () => { current();
      if (!source || source.state === "not_recorded" || !["issued", "expired"].includes(source.state) || source.delegationKey !== sourceKey
        || !explicit || !latest.current.revokeConfirmed || !frozenReason || latest.current.key !== sourceKey) throw new Error("须独立确认撤销原委托 / Independently confirm original delegation revocation");
      return { path: `/enterprise/order-delegations/${encodeURIComponent(sourceKey)}/revoke`, input: { delegationKey: sourceKey, expectedRevision: source.revision, confirm: true, reason: frozenReason } };
    }, value => finish(value, sourceKey), refresh);
  };
  const data = material?.data, quote = data && ("approval" in data ? data.approval.quote : data), currency = quote?.currency;
  const money = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) && currency ? `${formatRentalMoney(value, currency)} ${currency}` : english ? "Original amount unavailable" : "原金额不可核对";
  return <section><h2>{english ? "Delegate this original submission" : "委托本商户提交原请求"}</h2>
    <Alert type="info" title={english ? "One original request and confirmation" : "一份原请求与本人确认"} description={english ? "The source records your explicit delegation. Core checks the original authorization, qualifications and resources before execution. Read the original key when the response is unknown." : "此处保存本人明确委托源。Core 执行前核原授权、资格与资源，失应答时按原键读取。"} />
    <Select value={kind} disabled={operation.blocked} options={[{ value: "approval", label: english ? "Approved request" : "已批准申请" }, { value: "quote", label: english ? "Authorized quote without per-order approval" : "免逐单企业原报价" }]} onChange={value => { setKind(value); setMaterial(undefined); setConfirmed(false); }} />
    {kind === "approval" ? <p>{approval?.id ?? (english ? "Select your original approved request above" : "请先在上方选择本人原批准")}</p>
      : <Input value={quoteId} maxLength={191} disabled={operation.blocked} aria-label={english ? "Original quote" : "原报价引用"} onChange={event => { setQuoteId(event.target.value); setMaterial(undefined); setConfirmed(false); }} />}
    <ActionButton intent="review" disabled={operation.blocked || kind === "approval" && (!approval || approval.state !== "approved" || approval.applicantCustomerId !== context.session?.customer.customerId) || kind === "quote" && !quoteId.trim()} label={english ? "Read original delegation material" : "读取原委托材料"} onAction={inspect} />
    {quote && <dl><dt>{english ? "Period" : "原租期"}</dt><dd>{"request" in quote ? quote.request.startAt : quote.startAt} — {"request" in quote ? quote.request.endAt : quote.endAt}</dd>
      <dt>{english ? "Rental payable" : "租赁应付"}</dt><dd>{money(quote.payableAmount)}</dd><dt>{english ? "Deposit / preauthorization" : "押金／预授权"}</dt><dd>{money(quote.depositAmount)} / {money(quote.preAuthAmount)}</dd></dl>}
    <Input.TextArea value={reason} maxLength={500} disabled={operation.blocked} aria-label={english ? "Delegation reason" : "本次委托原因"} onChange={event => { setReason(event.target.value); setConfirmed(false); }} />
    <Checkbox checked={confirmed} disabled={operation.blocked || !material} onChange={event => setConfirmed(event.target.checked)}>{english ? "I reviewed this original request and explicitly delegate submission to this merchant" : "我已核对本条原请求，明确委托本商户提交"}</Checkbox>
    <ActionButton intent="confirm" disabled={operation.blocked || !material || !confirmed || !reason.trim()} label={english ? "Issue original delegation" : "签发原委托源"} onAction={issue} />
    <Input value={key} maxLength={128} disabled={operation.busy} aria-label={english ? "Original delegation key" : "原委托键"} onChange={event => { setKey(event.target.value); setOriginal(undefined); setRevokeConfirmed(false); }} />
    <ActionButton intent="review" disabled={operation.busy || !key.trim()} label={english ? "Read original delegation" : "读取原委托源"} onAction={async () => { const sourceKey = key.trim(), value = await readSource(sourceKey); if (latest.current.key.trim() !== sourceKey) throw new Error("原委托定位已变化"); setOriginal(value); setRevokeConfirmed(false); }} />
    {original && <p>{original.state}{original.state !== "not_recorded" && <> · {original.expiresAt}{original.original.state === "consumed" && <> · {original.original.orderId}</>}</>}</p>}
    {original && original.state !== "not_recorded" && ["issued", "expired"].includes(original.state) && <>
      <Checkbox checked={revokeConfirmed} disabled={operation.blocked} onChange={event => setRevokeConfirmed(event.target.checked)}>{english ? "Independently request revocation of this original delegation after Core verifies safe closure" : "独立请求撤销本条原委托，由Core核对可安全封闭的原执行依据"}</Checkbox>
      <ActionButton intent="confirm" disabled={operation.blocked || !revokeConfirmed || !reason.trim()} label={english ? "Revoke original delegation" : "撤销原委托源"} onAction={revoke} />
    </>}
    {operation.pending && <ActionButton intent="review" disabled={operation.busy} label={english ? "Read original delegation operation" : "核对原委托操作"} onAction={() => operation.recover(async receipt => {
      const pending = operation.pending;
      if (!pending) throw new Error("原委托操作引用仍待核对");
      // A known commit may omit the callback receipt. Read the same command
      // before retiring its reference, including after a failed refresh.
      const original = receipt ?? await operation.read<EnterpriseOperationResult>(`/enterprise/operations/${encodeURIComponent(pending.key)}`);
      if (original.state !== "committed" || !original.result || typeof original.result.delegationKey !== "string") throw new Error("原委托操作收据仍待核对");
      const sourceKey = pending.path === "/enterprise/order-delegations/issue" ? pending.key : pending.path.match(/^\/enterprise\/order-delegations\/([^/]+)\/revoke$/u)?.[1];
      if (!sourceKey) throw new Error("原委托操作路径不一致");
      const decoded = decodeURIComponent(sourceKey);
      if (original.result.delegationKey !== decoded) throw new Error("原委托操作键与原源不一致");
      await finish(await readSource(decoded), decoded);
    })} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
}
