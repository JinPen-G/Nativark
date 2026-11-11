/** Additional spending is reviewed from its original Core preview. This page does
 * not collect payment or treat an approval/pending extension as an effective rental. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { InputNumber } from "antd";
import { enterpriseExtensionServiceRequests, enterpriseExtensionServiceSelectionKey, formatRentalMoney, type ClientCatalogResponse, type ClientOrderView, type ClientQuoteServiceRequest, type EnterpriseExtensionApprovalView, type EnterpriseExtensionOriginalResult, type EnterpriseExtensionRequestOriginalResult, type EnterpriseOperationResult } from "@rental-os/shared";
import { ActionButton, Alert, Button, Checkbox, Form, Input, SaveButton, Select, Table } from "@/components/ui/customer-entry";
import { DatePicker } from "@/components/ui/DatePicker";
import { formSnapshotFingerprint } from "@/app/serverFormSnapshot";
import { zoneSupported, zonedToInstant } from "../../miniprogram/src/core/time";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";

type Operation = ReturnType<typeof useOriginalWorkflowOperation>;
type ExtensionValues = { orderId: string; newEndAt: dayjs.Dayjs; reason: string; services?: Array<{
  serviceId: string; quantity: number; scheduledRange?: [dayjs.Dayjs, dayjs.Dayjs]; serviceLocationId?: string;
}> };
function serviceInstant(value: dayjs.Dayjs, timeZone: string) {
  if (!value?.isValid() || !zoneSupported(timeZone)) throw new Error("原服务时区或时间不可核对 / Service time zone or time unavailable");
  const minute = zonedToInstant(value.format("YYYY-MM-DD"), value.format("HH:mm"), timeZone);
  return new Date(Date.parse(minute) + value.second() * 1000 + value.millisecond()).toISOString();
}
const originalMatches = (result: EnterpriseExtensionOriginalResult, id: string) => result.approval.id === id && result.retryable === false
  && result.original.retryable === false && result.approval.state === "consumed" && result.original.state === "observed"
  && Boolean(result.approval.extensionId) && result.original.extensionId === result.approval.extensionId;
const stateLabel = (state: string, english: boolean) => (english
  ? { pending: "Awaiting approval", approved: "Approved, not submitted", rejected: "Rejected", withdrawn: "Withdrawn", expired: "Expired", consumed: "Submitted to Core", closed: "Original submission sealed", pending_payment: "Awaiting payment, not effective", effective: "Effective", cancelled: "Cancelled" }
  : { pending: "待审批", approved: "已批准，未提交", rejected: "已拒绝", withdrawn: "已撤回", expired: "已失效", consumed: "已提交至Core", closed: "原提交已封闭", pending_payment: "待补款，尚未延期", effective: "已生效", cancelled: "已取消" })[state] ?? state;

function ExtensionDecision({ row, reviewMode, english, operation, closureOperation, refresh, unavailable }: {
  row: EnterpriseExtensionApprovalView; reviewMode: boolean; english: boolean; operation: Operation; closureOperation: Operation; refresh: () => Promise<void>; unavailable: boolean;
}) {
  const context = useEnterprise(), mounted = useRef(true);
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), [original, setOriginal] = useState<EnterpriseExtensionOriginalResult>();
  const [closureReason, setClosureReason] = useState(""), [closureConfirmed, setClosureConfirmed] = useState(false);
  const p = row.preview, blocked = operation.blocked || unavailable;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => { operation.assertCurrent(); if (!mounted.current || unavailable) throw new Error("原续租审阅已变化，请重新核对 / Original extension review changed"); };
  const money = (amount: number) => Number.isFinite(amount) && p.currency ? `${formatRentalMoney(amount, p.currency)} ${p.currency}` : english ? "Original amount unavailable" : "原金额不可核对";
  const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(english ? "en-US" : "zh-CN", { timeZoneName: "short" }) : english ? "Not recorded" : "原依据缺失";
  const readOriginal = async () => {
    current(); const result = await operation.read<EnterpriseExtensionOriginalResult>(`/enterprise/extension-approvals/${encodeURIComponent(row.id)}/result`); current();
    if (result.approval.id !== row.id || result.approval.orderId !== row.orderId || result.approval.applicantCustomerId !== context.session?.customer.customerId
      || result.retryable !== false || result.original.retryable !== false || result.approval.state === "consumed" && !originalMatches(result, row.id)
      || result.original.state === "closed" && (result.approval.state !== "closed" || !result.approval.closedOperationKey)) throw new Error("原续租引用不匹配 / Original extension mismatch");
    setOriginal(result); return result;
  };
  const decide = (decision: "approve" | "reject" | "withdraw") => operation.run(() => {
    current(); if (!reason.trim()) throw new Error("请填写本条处理原因 / A reason is required");
    if (decision === "approve" && p.services?.state !== "available") throw new Error("原服务明细不可用 / Original service details unavailable");
    return { path: `/enterprise/extension-approvals/${encodeURIComponent(row.id)}/decision`, input: { decision, reason, expectedRevision: row.revision } };
  }, refresh, refresh);
  const submit = () => operation.run(() => {
    current(); if (!confirmed || !reason.trim() || row.state !== "approved" || p.services?.state !== "available" || row.applicantCustomerId !== context.session?.customer.customerId) throw new Error("须本人核对后明确提交 / Applicant confirmation required");
    return { path: "/enterprise/extension-approvals/submit", originalTarget: row.id, input: { approvalId: row.id, expectedRevision: row.revision, reason, confirm: true } };
  }, async () => { const result = await readOriginal(); if (!originalMatches(result, row.id)) throw new Error("原消费结果仍待核对，不能重发 / Original result unresolved"); await refresh(); }, refresh);
  const closeExecution = () => closureOperation.run(() => {
    current(); if (!closureConfirmed || !closureReason.trim() || reviewMode || row.applicantCustomerId !== context.session?.customer.customerId || operation.pending?.path !== "/enterprise/extension-approvals/submit" || operation.pending.originalTarget !== row.id) throw new Error("须本人核对原提交后明确请求结束");
    return { path: `/enterprise/extension-approvals/${encodeURIComponent(row.id)}/close-execution`, input: { originalOperationKey: operation.pending.key, expectedRevision: row.revision, reason: closureReason, confirm: true } };
  }, async () => {
    const result = await readOriginal();
    if (!(result.original.state === "closed" && result.approval.closedOperationKey === operation.pending?.key) && !originalMatches(result, row.id)) throw new Error("原结束结果仍待核对");
    await refresh();
  }, refresh);
  const canReview = reviewMode && row.applicantCustomerId !== context.session?.customer.customerId;
  return <section aria-label={english ? "Original extension review" : "原续租明细审阅"}>
    <dl className="enterprise-review-facts">
      <dt>{english ? "Order / original revision" : "订单／原修订"}</dt><dd>{row.orderId} / {row.expectedOrderUpdatedAt}</dd>
      <dt>{english ? "Applicant / actual user" : "申请人／实际使用人"}</dt><dd>{row.applicantCustomerId}</dd>
      <dt>{english ? "Paying enterprise / workspace" : "付款企业／经营空间"}</dt><dd>{row.corporateCustomerId} / {row.workspaceId}</dd>
      <dt>{english ? "Original return time" : "原归还时间"}</dt><dd>{time(p.originalEndAt)}</dd>
      <dt>{english ? "Requested return time" : "申请归还时间"}</dt><dd>{time(p.newEndAt)}</dd>
      <dt>{english ? "Approval expires" : "批准有效期"}</dt><dd>{time(row.expiresAt)}</dd>
      <dt>{english ? "Purpose" : "申请原因"}</dt><dd>{row.reason}</dd>
      <dt>{english ? "State" : "状态"}</dt><dd>{stateLabel(row.state, english)}</dd>
      <dt>{english ? "Added rental" : "新增租金"}</dt><dd>{money(p.rentalAmount)}</dd>
      <dt>{english ? "Added services" : "新增服务费"}</dt><dd>{money(p.serviceAmount)}</dd>
      <dt>{english ? "Rental payable, excluding guarantees" : "租赁应付，不含保证金"}</dt><dd>{money(p.payableAmount)}</dd>
      <dt>{english ? "Deposit delta" : "押金差额"}</dt><dd>{money(p.depositDelta)}</dd>
      <dt>{english ? "Preauthorization delta" : "预授权差额"}</dt><dd>{money(p.preAuthDelta)}</dd>
      <dt>{english ? "Original settlement" : "原结算方式"}</dt><dd>{p.settlementMode === "monthly" ? english ? "Credit, subject to current credit gates" : "账期，仍须当前授信门禁" : english ? "Immediate payment" : "即时补款"}</dd>
    </dl>
    <Table rowKey="index" caption={english ? "Original incremental charges" : "原增量费用"} dataSource={p.chargeLines.map((line, index) => ({ ...line, index }))} pagination={false} sorting={false} columns={[
      { title: english ? "Charge" : "费用", dataIndex: "name" }, { title: english ? "Amount" : "金额", render: (_, line) => money(line.amount) },
    ]} />
    {p.services?.state === "available" ? p.services.items.length === 0
      ? <p>{english ? "The original preview records no added services" : "原预览已记录无新增服务"}</p>
      : p.services.items.map((service, index) => <section key={`${service.serviceId}:${index}`}>
        <h4>{service.serviceName}</h4><p>{service.requiredByRule ? english ? "Required by the original business rule" : "原业务规则要求" : english ? "Selected for this extension" : "本次续租选择"}</p>
        <dl className="enterprise-review-facts"><dt>{english ? "Quantity / amount" : "数量／金额"}</dt><dd>{service.quantity} · {money(service.amount)}</dd>
          <dt>{english ? "Original service plan" : "原服务计划"}</dt><dd>{service.scheduledStartAt} — {service.scheduledEndAt}</dd>
          <dt>{english ? "Original service location" : "原服务地点引用"}</dt><dd>{service.serviceLocationId}</dd>
          <dt>{english ? "Service / terms version" : "服务／条款版本"}</dt><dd>{service.serviceVersion} · {service.termsVersion}</dd></dl><p>{service.terms}</p>
      </section>) : <Alert type="warning" title={english ? "Original service details unavailable" : "原服务明细不可用"}/>}
    <Alert type="info" title={p.paymentRequired ? english ? "Payment is required before the extension takes effect" : "须原补款核验后才能延期" : english ? "Core checks authority, credit and availability before effectiveness" : "生效仍须Core核验权限、授信及可用性"}
      description={english ? "Approval does not reserve stock, collect money or freeze a guarantee. The original booking approval cannot authorize this expense." : "企业批准不预占库存、不收款或冻结保证金；不能复用旧建单批准增加费用。"} />
    {["pending", "approved"].includes(row.state) && <Input.TextArea aria-label={english ? "Reason for this decision" : "本条处理原因"} value={reason} maxLength={500} disabled={blocked} onChange={event => setReason(event.target.value)} />}
    {canReview && row.state === "pending" && <>
      <ActionButton disabled={blocked || !reason.trim() || p.services?.state !== "available"} intent="confirm" label={english ? "Approve this extension" : "批准本条续租"} onAction={() => decide("approve")} />
      <ActionButton disabled={blocked || !reason.trim()} intent="confirm" label={english ? "Reject this extension" : "拒绝本条续租"} onAction={() => decide("reject")} />
    </>}
    {!reviewMode && ["pending", "approved"].includes(row.state) && <ActionButton disabled={blocked || !reason.trim()} intent="confirm" label={english ? "Withdraw this request" : "撤回本条申请"} onAction={() => decide("withdraw")} />}
    {!reviewMode && row.state === "approved" && <>
      <Checkbox checked={confirmed} disabled={blocked || p.services?.state !== "available"} onChange={event => setConfirmed(event.target.checked)}>{english ? "I reviewed this original extension, expense and guarantee differences; explicitly submit" : "我已核对本条原续租、费用及保证金差额，明确提交"}</Checkbox>
      <ActionButton disabled={blocked || !confirmed || !reason.trim() || p.services?.state !== "available"} intent="confirm" label={english ? "Explicitly submit this extension" : "核对后提交本条续租"} onAction={submit} />
    </>}
    {!reviewMode && row.state === "consumed" && <ActionButton disabled={operation.busy || unavailable} intent="review" label={english ? "Read original extension result" : "读取原续租结果"} onAction={readOriginal} />}
    {!reviewMode && operation.pending?.path === "/enterprise/extension-approvals/submit" && operation.pending.originalTarget === row.id && ["approved", "expired"].includes(row.state) && <>
      <Input.TextArea value={closureReason} maxLength={500} disabled={operation.busy || closureOperation.blocked} onChange={event => setClosureReason(event.target.value)} />
      <Checkbox checked={closureConfirmed} disabled={operation.busy || closureOperation.blocked} onChange={event => setClosureConfirmed(event.target.checked)}>{english ? "Seal the original submission; do not cancel or retry a committed extension" : "封闭原提交，不取消已成立续租，也不重试执行"}</Checkbox>
      <ActionButton disabled={operation.busy || closureOperation.blocked || !closureConfirmed || !closureReason.trim()} intent="confirm" label={english ? "Request controlled closure" : "请求受控结束原提交"} onAction={closeExecution} />
    </>}
    {original && <Alert type={original.original.state === "observed" ? "info" : "warning"} title={original.original.state === "observed" ? `${stateLabel(original.original.extensionState, english)}: ${original.original.extensionId}` : original.original.state === "closed" ? english ? "Original submission sealed; new requests require a new preview and approval" : "原提交已封闭；新申请须重新试算与批准" : english ? "Not submitted; no effective extension inferred" : "尚未提交，不推断已延期"} />}
  </section>;
}
export function EnterpriseExtensionApprovalsPage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const [requestClosureReason, setRequestClosureReason] = useState(""), [requestClosureConfirmed, setRequestClosureConfirmed] = useState(false), [requestClosed, setRequestClosed] = useState(false);
  const [mode, setMode] = useState("mine"), [selected, setSelected] = useState("");
  const [form] = Form.useForm<ExtensionValues>(), changed = useRef(0);
  const capturedRequest = useRef<{ identity: string; generation: number; draft: string; catalog?: ClientCatalogResponse } | undefined>(undefined);
  const operation = useOriginalWorkflowOperation(`extension-approvals:${mode}`), closureOperation = useOriginalWorkflowOperation(`extension-closure:${mode}`);
  const canReview = Boolean(context.entry?.corporates.find(c => c.corporateCustomerId === context.selectedCorporateId)?.actions.includes("approvals:review"));
  const path = mode === "review" ? `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/extension-approvals` : "/enterprise/my-extension-approvals";
  const rows = useQuery({ queryKey: ["enterprise-extension-approvals", context.identity, mode], enabled: Boolean(context.session && (mode !== "review" || canReview)), queryFn: ({ signal }) => operation.read<EnterpriseExtensionApprovalView[]>(path, signal) });
  const readCatalog = async (signal?: AbortSignal) => {
    const identity = context.identity, tenantCode = context.tenantCode, workspaceCode = context.session?.workspace?.workspaceCode;
    const value = await operation.read<ClientCatalogResponse>("/catalog", signal); operation.assertCurrent();
    if (identity !== context.identity || value.tenantCode !== tenantCode || value.workspace?.workspaceCode !== workspaceCode
      || !Array.isArray(value.services) || !Array.isArray(value.locations) || typeof value.timeZone !== "string" || !value.timeZone.trim()
      || !zoneSupported(value.timeZone)) throw new Error("原服务候选或时区已变化 / Service catalog or time zone changed");
    return value;
  };
  const catalog = useQuery({ queryKey: ["enterprise-extension-services", context.identity], queryFn: ({ signal }) => readCatalog(signal),
    enabled: Boolean(context.session && mode === "mine"), retry: false, refetchOnWindowFocus: false, refetchInterval: false });
  useEffect(() => { setMode("mine"); setSelected(""); form.resetFields(); setRequestClosureReason(""); setRequestClosureConfirmed(false); setRequestClosed(false); }, [context.identity]);
  const refresh = async () => { await rows.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const row = !rows.error && (mode !== "review" || canReview) ? rows.data?.find(r => r.id === selected) : undefined;
  const finishRequestRecovery = async (original: EnterpriseExtensionRequestOriginalResult) => {
    operation.assertCurrent();
    if (original.state === "closed") { setRequestClosed(true); setSelected(""); form.resetFields(); }
    else if (original.state === "observed") { setRequestClosed(false); setSelected(original.approval.id); }
    else throw new Error("原申请仍待核对");
    setRequestClosureConfirmed(false); setRequestClosureReason(""); await refresh();
  };
  const closeRequest = () => {
    if (!requestClosureConfirmed || !requestClosureReason.trim() || mode !== "mine") throw new Error("须本人独立确认原申请键");
    return operation.closeExtensionRequest(requestClosureReason, finishRequestRecovery);
  };
  const recover = async (receipt?: EnterpriseOperationResult, originalPath?: string) => {
    if (originalPath === "/enterprise/extension-approvals" && operation.pending?.originalTarget) {
      const orderId = operation.pending.originalTarget;
      const original = await operation.read<EnterpriseExtensionRequestOriginalResult>(`/enterprise/orders/${encodeURIComponent(orderId)}/extension-request-operations/${encodeURIComponent(operation.pending.key)}`);
      if (original.state !== "observed" || original.retryable !== false || !original.approval.id || original.approval.orderId !== orderId || original.approval.applicantCustomerId !== context.session?.customer.customerId) throw new Error("原申请仍待精确核对，不能重发");
      setSelected(original.approval.id);
    }
    if (originalPath === "/enterprise/extension-approvals/submit") {
      const original = receipt ?? (operation.pending ? await operation.read<EnterpriseOperationResult>(`/enterprise/operations/${encodeURIComponent(operation.pending.key)}`) : undefined);
      if (original?.state !== "committed" || typeof original.result?.approvalId !== "string" || operation.pending?.originalTarget && operation.pending.originalTarget !== original.result.approvalId) throw new Error("原续租批准引用不可核对 / Original approval reference unavailable");
      const result = await operation.read<EnterpriseExtensionOriginalResult>(`/enterprise/extension-approvals/${encodeURIComponent(original.result.approvalId)}/result`);
      const sealed = original.result.state === "closed" && result.approval.id === original.result.approvalId && result.retryable === false && result.original.retryable === false
        && result.approval.state === "closed" && result.original.state === "closed" && result.approval.closedOperationKey === operation.pending?.key && original.result.closedOperationKey === operation.pending?.key;
      if (!sealed && (!originalMatches(result, original.result.approvalId) || original.result.extensionId !== result.approval.extensionId)) throw new Error("原续租消费仍待核对，保留原引用 / Original extension unresolved");
    }
    await refresh();
  };
  return <section>
    <Alert type="info" title={english ? "Original preview, enterprise approval, then applicant submission" : "原试算、企业批准、本人再提交"} description={english ? "Only your original order in the current customer workspace can be requested. Approval is not payment or an effective extension; an unknown request is recovered by its original key." : "只申请当前客户空间的本人原订单。批准不是付款或已延期；未决请求只能按原键回读。企业待审核仍逐次核验当前审批权。"} />
    <Select aria-label={english ? "Extension approval view" : "续租审批视图"} value={mode} disabled={operation.blocked} options={[{ value: "mine", label: english ? "My requests" : "本人申请" }, ...(canReview ? [{ value: "review", label: english ? "Enterprise review queue" : "企业待审核" }] : [])]} onChange={value => { setSelected(""); setMode(value); }} />
    {mode === "mine" && <Form form={form} layout="vertical" disabled={operation.blocked} onValuesChange={() => { changed.current++; }}>
      <Form.Item name="orderId" label={english ? "Original order reference" : "原订单引用"} rules={[{ required: true, whitespace: true }]}><Input maxLength={191} /></Form.Item>
      <Form.Item name="newEndAt" label={english ? "Requested return time" : "申请归还时间"} rules={[{ required: true }]}><DatePicker showTime /></Form.Item>
      {catalog.data && !catalog.error && <p>{english ? "Service time zone" : "服务营业时区"} · {catalog.data.timeZone}</p>}
      {catalog.error && <Alert type="warning" title={english ? "Published services unavailable" : "原公开服务候选不可用"}/>}
      <Form.List name="services">{(fields, { add, remove }) => <>
        {fields.map(field => <section key={field.key}>
          <Form.Item name={[field.name, "serviceId"]} label={english ? "Added service" : "新增服务"} rules={[{ required: true }]}><Select disabled={!catalog.data || Boolean(catalog.error) || operation.blocked} options={(catalog.data?.services ?? []).filter(service => service.enabled).map(service => ({ value: service.id, label: service.name }))}/></Form.Item>
          <Form.Item name={[field.name, "quantity"]} label={english ? "Service quantity" : "服务数量"} rules={[{ required: true, type: "integer", min: 1 }]}><InputNumber min={1} precision={0}/></Form.Item>
          <Form.Item name={[field.name, "scheduledRange"]} label={english ? "Independent service time range" : "独立服务计划时段"}><DatePicker.RangePicker showTime /></Form.Item>
          <Form.Item name={[field.name, "serviceLocationId"]} label={english ? "Service location" : "服务地点"}><Select allowClear options={(catalog.data?.locations ?? []).filter(location => location.status === "enabled").map(location => ({ value: location.id, label: location.name }))}/></Form.Item>
          <Button disabled={operation.blocked} onClick={() => { changed.current++; remove(field.name); }}>{english ? "Remove selection" : "移除本次选择"}</Button>
        </section>)}
        <Button disabled={operation.blocked || !catalog.data || Boolean(catalog.error) || fields.length >= 100} onClick={() => { changed.current++; add({ quantity: 1 }); }}>{english ? "Add a service selection" : "添加服务选择"}</Button>
      </>}</Form.List>
      <Form.Item name="reason" label={english ? "Purpose" : "用途及原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
      <SaveButton form={form} disabled={operation.blocked || catalog.isFetching || !catalog.data || Boolean(catalog.error)} label={english ? "Request extension approval" : "申请续租批准"}
        onClickCapture={() => { capturedRequest.current = { identity: context.identity, generation: changed.current, draft: formSnapshotFingerprint(form.getFieldsValue(true)), catalog: catalog.data ? structuredClone(catalog.data) : undefined }; }}
        onSave={submitted => {
        // SaveButton validates before onSave. Retain the click's input and catalog through both waits.
        const original = capturedRequest.current ?? { identity: context.identity, generation: changed.current, draft: formSnapshotFingerprint(form.getFieldsValue(true)), catalog: catalog.data ? structuredClone(catalog.data) : undefined };
        capturedRequest.current = undefined;
        const { generation, draft } = original;
        if (original.identity !== context.identity || generation !== changed.current || submitted && draft !== formSnapshotFingerprint(submitted)) return Promise.reject(new Error("原服务选择已变化 / Service selection changed"));
        return operation.run(async () => {
        const values = await form.validateFields(), orderId = values.orderId.trim();
        const source = original.catalog; if (!source || catalog.error || generation !== changed.current || draft !== formSnapshotFingerprint(form.getFieldsValue(true))) throw new Error("原服务选择已变化 / Service selection changed");
        const services: ClientQuoteServiceRequest[] = (values.services ?? []).map(service => ({ serviceId: service.serviceId, quantity: service.quantity,
          ...(service.scheduledRange ? { scheduledStartAt: serviceInstant(service.scheduledRange[0], source.timeZone), scheduledEndAt: serviceInstant(service.scheduledRange[1], source.timeZone) } : {}),
          ...(service.serviceLocationId ? { serviceLocationId: service.serviceLocationId } : {}) }));
        const originalKey = enterpriseExtensionServiceSelectionKey(services, source), currentCatalog = await readCatalog();
        if (generation !== changed.current || draft !== formSnapshotFingerprint(form.getFieldsValue(true)) || originalKey !== enterpriseExtensionServiceSelectionKey(services, currentCatalog)) throw new Error("原服务候选或选择已变化 / Service catalog or selection changed");
        const order = await operation.read<ClientOrderView>(`/orders/${encodeURIComponent(orderId)}`); operation.assertCurrent();
        if (generation !== changed.current || draft !== formSnapshotFingerprint(form.getFieldsValue(true)) || order.id !== orderId || !order.updatedAt || !values.newEndAt?.isValid()) throw new Error("原订单修订或时间不可核对 / Original order or time unavailable");
        return { path: "/enterprise/extension-approvals", originalTarget: orderId, input: { orderId, expectedOrderUpdatedAt: order.updatedAt,
          extension: { newEndAt: serviceInstant(values.newEndAt, source.timeZone), services: enterpriseExtensionServiceRequests(services, currentCatalog) }, expectedRevision: 0, reason: values.reason.trim() } };
      }, async () => { await refresh(); form.resetFields(); }, refresh); }} />
    </Form>}
    {mode === "review" && !canReview ? <Alert type="warning" title={english ? "Approval permission revoked" : "当前审批权限已撤销"} /> : rows.error ? <Alert type="error" title={rows.error instanceof Error ? rows.error.message : "读取失败"} /> : <Table rowKey="id" caption={english ? "Extension approval requests" : "续租批准申请"} dataSource={rows.data ?? []} loading={rows.isFetching} pagination={false} sorting={false} onRefresh={refresh} columns={[
      { title: english ? "Order" : "订单", dataIndex: "orderId" }, { title: english ? "Applicant" : "申请人", dataIndex: "applicantCustomerId" },
      { title: english ? "Purpose" : "用途", dataIndex: "reason" }, { title: english ? "State" : "状态", render: (_, r) => stateLabel(r.state, english) },
      { title: english ? "Actions" : "操作", key: "actions", render: (_, r) => <ActionButton disabled={operation.busy || rows.isFetching} intent="review" label={english ? "Review this extension" : "核对本条续租"} onAction={async () => { operation.assertCurrent(); setSelected(r.id); }} /> },
    ]} />}
    {row && <ExtensionDecision key={JSON.stringify([context.identity, mode, row.id, row.revision, row.state, row.preview])} row={row} reviewMode={mode === "review"} english={english} operation={operation} closureOperation={closureOperation} refresh={refresh} unavailable={rows.isFetching} />}
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original operation" : "核对原续租操作"} onAction={() => operation.pending?.path === "/enterprise/extension-approvals" && operation.pending.originalTarget ? operation.recoverExtensionRequest(finishRequestRecovery) : operation.recover(recover)} />}
    {mode === "mine" && operation.pending?.path === "/enterprise/extension-approvals" && operation.pending.originalTarget && !operation.pending.closureKey && <>
      <Alert type="warning" title={english ? "Seal the original request key, not a rental" : "封闭原申请键，不取消租赁"} description={english ? "If the application already exists, only recover it. Otherwise permanently block this request key; any new application requires a new preview and explicit action." : "申请已成立时只恢复原申请；否则永久阻断该原申请键。新申请须重新试算并明确发起。"} />
      <Input.TextArea aria-label={english ? "Original request closure reason" : "原申请结束原因"} value={requestClosureReason} maxLength={500} disabled={operation.busy} onChange={event => setRequestClosureReason(event.target.value)} />
      <Checkbox checked={requestClosureConfirmed} disabled={operation.busy} onChange={event => setRequestClosureConfirmed(event.target.checked)}>{english ? "I independently confirm closure of this original request key" : "我独立确认结束本条原申请键"}</Checkbox>
      <ActionButton disabled={operation.busy || !requestClosureConfirmed || !requestClosureReason.trim()} intent="confirm" label={english ? "Request original application closure" : "请求受控结束原申请"} onAction={closeRequest} />
    </>}
    {requestClosed && <Alert type="info" title={english ? "Original request key sealed; no existing request or extension was cancelled" : "原申请键已封闭，未取消已成立申请或续租"} />}
    {closureOperation.pending && <ActionButton disabled={closureOperation.busy} intent="review" label={english ? "Read original closure" : "核对原结束请求"} onAction={() => closureOperation.recover(async (receipt, path) => {
      const original = receipt ?? await closureOperation.read<EnterpriseOperationResult>(`/enterprise/operations/${encodeURIComponent(closureOperation.pending!.key)}`);
      const id = original.result?.approvalId;
      if (original.state !== "committed" || typeof id !== "string" || path !== `/enterprise/extension-approvals/${encodeURIComponent(id)}/close-execution`) throw new Error("原结束收据关联不可核对");
      const result = await closureOperation.read<EnterpriseExtensionOriginalResult>(`/enterprise/extension-approvals/${encodeURIComponent(id)}/result`);
      if (!(result.original.state === "closed" && result.approval.state === "closed" && result.approval.id === id && result.retryable === false && result.original.retryable === false
        && Boolean(result.approval.closedOperationKey) && result.approval.closedOperationKey === original.result?.closedOperationKey)
        && !(originalMatches(result, id) && result.approval.extensionId === original.result?.extensionId)) throw new Error("原结束结果仍待核对");
      await refresh();
    })} />}
    {closureOperation.error && <Alert type="error" title={closureOperation.error} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
}
