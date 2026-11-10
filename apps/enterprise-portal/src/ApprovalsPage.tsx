/** Quote review is separate from applicant submission and original-result recovery. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EnterpriseApprovalOriginalResult, EnterpriseBookingApprovalView, EnterpriseOperationResult } from "@rental-os/shared";
import { ActionButton, Alert, Form, Input, SaveButton, Select, Table } from "@/components/ui/customer-entry";
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
    {operation.pending && <ActionButton disabled={operation.busy} intent="review" label={english ? "Read original operation" : "核对原操作"} onAction={() => operation.recover(recoverSubmission)} />}
    {closureOperation.pending && <ActionButton disabled={closureOperation.busy || operation.busy} intent="review" label={english ? "Read original closure result" : "核对原封闭请求结果"} onAction={() => closureOperation.recover(refresh)} />}
    {closureOperation.error && <Alert type="error" title={closureOperation.error} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
}
