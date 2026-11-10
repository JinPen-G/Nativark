/** Spending review only. Physical exchange, inspection and funding remain in the
 * original merchant flow; original-key recovery never dispatches another command. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatRentalMoney, type EnterpriseExchangeConfirmationResult, type EnterpriseExchangeRequestOriginalResult, type EnterpriseExchangeChoices, type ClientOrderView, type EnterpriseExchangeApprovalView, type EnterpriseExchangeIntent, type EnterpriseOperationResult } from "@rental-os/shared";
import { ActionButton, Alert, Button, Checkbox, Form, Input, SaveButton, Select, Table } from "@/components/ui/customer-entry";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";

function ExchangeReview({ row, reviewMode, unavailable, operation, refresh }: {
  row: EnterpriseExchangeApprovalView; reviewMode: boolean; unavailable: boolean;
  operation: ReturnType<typeof useOriginalWorkflowOperation>; refresh: () => Promise<void>;
}) {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const money = (value: number) => Number.isFinite(value) && row.preview.currency ? `${formatRentalMoney(value, row.preview.currency)} ${row.preview.currency}` : english ? "Original amount unavailable" : "原金额不可核对";
  const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(english ? "en-US" : "zh-CN", { timeZoneName: "short" }) : english ? "Not recorded" : "原依据缺失";
  const blocked = unavailable || operation.blocked;
  const own = row.applicantCustomerId === context.session?.customer.customerId;
  const decide = (decision: "approve" | "reject" | "withdraw") => operation.run(() => {
    operation.assertCurrent();
    if (unavailable || !reason.trim() || !confirmed || (decision === "withdraw" ? !own || reviewMode : own || !reviewMode)) throw new Error("须核对本条原换货申请后独立确认 / Review and confirm this original request");
    return { path: `/enterprise/exchange-approvals/${encodeURIComponent(row.id)}/decision`, input: { decision, reason, expectedRevision: row.revision } };
  }, refresh, refresh);
  const confirmExpense = () => operation.run(() => {
    operation.assertCurrent();
    if (unavailable || !own || reviewMode || row.state !== "approved" || row.employeeConfirmation || !reason.trim() || !confirmed) throw new Error("须本人核对已批准费用后独立确认");
    return { path: `/enterprise/exchange-approvals/${encodeURIComponent(row.id)}/expense-confirmation`, originalTarget: row.id, input: { reason: reason.trim(), confirm: true, expectedRevision: row.revision } };
  }, async () => { await refresh(); setReason(""); setConfirmed(false); }, refresh);
  return <section aria-label={english ? "Original exchange review" : "原换货申请审阅"}>
    <dl className="enterprise-review-facts">
      <dt>{english ? "Original order" : "原订单"}</dt><dd>{row.orderId}</dd>
      <dt>{english ? "Applicant / actual user" : "申请人／实际使用人"}</dt><dd>{row.applicantCustomerId}</dd>
      <dt>{english ? "Original item" : "原商品"}</dt><dd>{row.preview.originalItemGroupName}</dd>
      <dt>{english ? "Replacement item" : "替换商品"}</dt><dd>{row.preview.replacementItemGroupName}</dd>
      <dt>{english ? "Price basis" : "价格依据"}</dt><dd>{row.exchange.priceBasis === "original_order_price" ? english ? "Original order price" : "原订单价格" : english ? "Replacement current price" : "替换商品当前价格"}</dd>
      <dt>{english ? "Original / replacement amount" : "原商品／新商品金额"}</dt><dd>{money(row.preview.originalAmount)} / {money(row.preview.replacementAmount)}</dd>
      <dt>{english ? "Added enterprise spending" : "新增企业支出"}</dt><dd>{money(row.preview.additionalAmount)}</dd>
      <dt>{english ? "Refund for review" : "待审核核减"}</dt><dd>{money(row.preview.refundAmount)}</dd>
      <dt>{english ? "Deposit / preauthorization delta" : "押金／预授权差额"}</dt><dd>{money(row.preview.depositDelta)} / {money(row.preview.preAuthDelta)}</dd>
      <dt>{english ? "Request expires" : "申请有效期"}</dt><dd>{time(row.expiresAt)}</dd>
      <dt>{english ? "Purpose" : "用途"}</dt><dd>{row.reason}</dd>
    </dl>
    <Alert type="warning" title={english ? "Approval authorizes this expense only" : "批准仅授权本次费用"}
      description={english ? "It does not reserve a replacement, collect funds, complete an inspection or apply the exchange. The original merchant execution is not connected yet." : "不预占替换商品、不收款、不代替现场检查，也不执行换货；原商户执行接点尚未接通。"} />
    {row.employeeConfirmation && <Alert type="info" title={english ? "Expense confirmed by applicant; exchange not executed" : "本人已确认费用；换货尚未执行"}
      description={english ? "Merchant inspection and your confirmation of that inspection remain separate. This consent does not reserve stock or confirm payment." : "商户检查及对该检查的本人确认仍须另行完成；本次同意不预占库存，不确认收付款。"} />}
    {((reviewMode && !own && row.state === "pending") || (!reviewMode && own && ["pending", "approved"].includes(row.state))) && <>
      <Input.TextArea aria-label={english ? "Reason for this exchange decision" : "本条换货处理原因"} value={reason} maxLength={500} disabled={blocked} onChange={event => setReason(event.target.value)} />
      <Checkbox checked={confirmed} disabled={blocked} onChange={event => setConfirmed(event.target.checked)}>{english ? "I reviewed this original exchange and its expense" : "我已核对本条原换货申请及费用"}</Checkbox>
      {reviewMode ? <>
        <ActionButton intent="confirm" disabled={blocked || !confirmed || !reason.trim()} label={english ? "Approve this exchange expense" : "批准本条换货费用"} onAction={() => decide("approve")} />
        <ActionButton intent="confirm" disabled={blocked || !confirmed || !reason.trim()} label={english ? "Reject this exchange expense" : "拒绝本条换货费用"} onAction={() => decide("reject")} />
      </> : <>
        {row.state === "approved" && !row.employeeConfirmation && <ActionButton intent="confirm" disabled={blocked || !confirmed || !reason.trim()} label={english ? "Confirm this approved expense" : "确认本次已批准费用"} onAction={confirmExpense} />}
        <ActionButton intent="confirm" disabled={blocked || !confirmed || !reason.trim()} label={english ? "Withdraw this exchange request" : "撤回本条换货申请"} onAction={() => decide("withdraw")} />
      </>}
    </>}
  </section>;
}
const labels = (state: string, english: boolean) => (english ? { pending: "Awaiting approval", approved: "Approved, not applied", rejected: "Rejected", withdrawn: "Withdrawn", expired: "Expired" } : { pending: "待审批", approved: "已批准，未执行", rejected: "已拒绝", withdrawn: "已撤回", expired: "已失效" })[state] ?? state;
export function EnterpriseExchangeApprovalsPage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const [mode, setMode] = useState("mine"), [selected, setSelected] = useState("");
  const [orderId, setOrderId] = useState(""), [allocationId, setAllocationId] = useState(""), [replacementId, setReplacementId] = useState("");
  const [closureReason, setClosureReason] = useState(""), [closureConfirmed, setClosureConfirmed] = useState(false), [requestClosed, setRequestClosed] = useState(false);
  const [orderPage, setOrderPage] = useState(1);
  const [form] = Form.useForm<EnterpriseExchangeIntent & { orderId: string; reason: string }>();
  const operation = useOriginalWorkflowOperation(`exchange-approvals:${mode}`);
  const canReview = Boolean(context.entry?.corporates.find(c => c.corporateCustomerId === context.selectedCorporateId)?.actions.includes("approvals:review"));
  const path = mode === "review" ? `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/exchange-approvals` : "/enterprise/my-exchange-approvals";
  const rows = useQuery({ queryKey: ["enterprise-exchange-approvals", context.identity, mode], enabled: Boolean(context.session && (mode !== "review" || canReview)), queryFn: ({ signal }) => operation.read<EnterpriseExchangeApprovalView[]>(path, signal) });
  const orders = useQuery({ queryKey: ["enterprise-exchange-orders", context.identity, orderPage], enabled: Boolean(context.session && mode === "mine"),
    queryFn: ({ signal }) => operation.read<{ items: ClientOrderView[]; total: number; page: number }>(`/orders?status=renting&page=${orderPage}&pageSize=20`, signal) });
  const query = new URLSearchParams({ ...(allocationId ? { allocationId } : {}), ...(replacementId ? { replacementItemGroupId: replacementId } : {}) });
  const choices = useQuery({ queryKey: ["enterprise-exchange-choices", context.identity, orderId, allocationId, replacementId], enabled: Boolean(context.session && mode === "mine" && orderId),
    queryFn: ({ signal }) => operation.read<EnterpriseExchangeChoices>(`/enterprise/orders/${encodeURIComponent(orderId)}/exchange-choices?${query}`, signal) });
  const currentChoices = !choices.error && choices.data?.orderId === orderId && choices.data.applicantCustomerId === context.session?.customer.customerId
    && choices.data.selectedAllocationId === (allocationId || undefined) && choices.data.selectedReplacementItemGroupId === (replacementId || undefined) ? choices.data : undefined;
  const replacement = currentChoices?.replacements.find(row => row.itemGroupId === replacementId);
  const resetSelection = () => { setOrderId(""); setAllocationId(""); setReplacementId(""); form.resetFields(); };
  useEffect(() => { setMode("mine"); setSelected(""); setOrderPage(1); setClosureReason(""); setClosureConfirmed(false); setRequestClosed(false); resetSelection(); }, [context.identity]);
  const refresh = async () => { await rows.refetch({ throwOnError: true }); operation.assertCurrent(); };
  const row = !rows.error && (mode !== "review" || canReview) ? rows.data?.find(r => r.id === selected) : undefined;
  const recover = async (receipt?: EnterpriseOperationResult, originalPath?: string) => {
    if (originalPath === "/enterprise/exchange-approvals") {
      const original = receipt ?? (operation.pending ? await operation.read<EnterpriseOperationResult>(`/enterprise/operations/${encodeURIComponent(operation.pending.key)}`) : undefined);
      if (original?.state !== "committed" || typeof original.result?.id !== "string") throw new Error("原换货申请收据不可核对，不能重发");
      const restored = await operation.read<EnterpriseExchangeApprovalView>(`/enterprise/exchange-approvals/${encodeURIComponent(original.result.id)}`);
      if (restored.id !== original.result.id || restored.orderId !== operation.pending?.originalTarget || restored.applicantCustomerId !== context.session?.customer.customerId) throw new Error("原申请关联不匹配");
      setSelected(restored.id);
    }
    if (originalPath?.endsWith("/expense-confirmation")) {
      const id = operation.pending?.originalTarget;
      if (!id || originalPath !== `/enterprise/exchange-approvals/${encodeURIComponent(id)}/expense-confirmation`) throw new Error("原确认目标不可核对");
      const result = await operation.read<EnterpriseExchangeConfirmationResult>(originalPath);
      if (result.original.state !== "observed" || result.original.retryable !== false || result.original.operationKey !== operation.pending?.key
        || result.approval.id !== id || result.approval.applicantCustomerId !== context.session?.customer.customerId
        || result.approval.employeeConfirmation?.operationKey !== result.original.operationKey) throw new Error("原费用确认仍待精确核对，不能重新确认");
      setSelected(id);
    }
    await refresh();
  };
  const requestRead = async (original: EnterpriseExchangeRequestOriginalResult) => {
    operation.assertCurrent();
    if (original.state === "not_recorded") throw new Error("原申请仍待核对，不能重发");
    if (original.state === "closed") { setSelected(""); resetSelection(); setRequestClosed(true); }
    else { setSelected(original.approval.id); await refresh(); }
    setClosureReason(""); setClosureConfirmed(false);
  };
  const recoverOriginal = () => operation.pending?.path === "/enterprise/exchange-approvals" && operation.pending.originalTarget
    ? operation.recoverExchangeRequest(requestRead) : operation.recover(recover);
  return <section>
    {requestClosed && <Alert type="info" title={english ? "Original request key sealed" : "原换货申请键已封闭"} description={english ? "The late request cannot create another approval. No existing approval, physical exchange or payment was cancelled." : "迟到原申请不能再创建批准；不撤回已成立申请，不取消实物换货或支付。新申请须另行明确发起。"} />}
    <Alert type="info" title={english ? "Request original exchange spending approval" : "申请原订单换货费用批准"} description={english ? "Current workspace, applicant's own enterprise order only. Approval does not guarantee price, stock or fulfillment." : "仅当前空间的本人企业订单；申请与批准不保证价格、库存或履约，不复用旧建单或续租批准。"} />
    <Select aria-label={english ? "Exchange approval view" : "换货审批视图"} value={mode} disabled={operation.blocked} options={[{ value: "mine", label: english ? "My requests" : "本人申请" }, ...(canReview ? [{ value: "review", label: english ? "Enterprise review queue" : "企业待审核" }] : [])]} onChange={value => { setSelected(""); setMode(value); }} />
    {mode === "mine" && <Form form={form} layout="vertical" initialValues={{ priceBasis: "original_order_price" }} disabled={operation.blocked}>
      {orders.error && <Alert type="error" title={orders.error instanceof Error ? orders.error.message : "本人订单读取失败"} />}
      <Form.Item name="orderId" label={english ? "Your renting order" : "本人租赁中订单"} rules={[{ required: true }]}><Select showSearch optionFilterProp="label" disabled={orders.isFetching || Boolean(orders.error)} options={(orders.data?.items ?? []).map(order => ({ value: order.id, label: `${order.orderNo} · ${order.lines.map(line => line.itemGroupName).join("、")}` }))}
        onChange={value => { operation.assertCurrent(); setOrderId(value); setAllocationId(""); setReplacementId(""); form.setFieldsValue({ allocationId: undefined, replacementItemGroupId: undefined, replacementAssetId: undefined, replacementPricingGroupId: undefined }); }} /></Form.Item>
      {orders.data && <div><Button disabled={operation.blocked || orders.isFetching || orderPage <= 1} onClick={() => { resetSelection(); setOrderPage(orderPage - 1); }}>{english ? "Previous orders" : "上一页订单"}</Button>
        <span>{english ? `Page ${orderPage}` : `第 ${orderPage} 页`}</span><Button disabled={operation.blocked || orders.isFetching || orderPage * 20 >= orders.data.total} onClick={() => { resetSelection(); setOrderPage(orderPage + 1); }}>{english ? "Next orders" : "下一页订单"}</Button></div>}
      {choices.error && <Alert type="error" title={choices.error instanceof Error ? choices.error.message : "换货候选读取失败"} />}
      {orderId && <ActionButton intent="refresh" disabled={operation.blocked || choices.isFetching} label={english ? "Read current exchange choices" : "重新读取换货候选"} onAction={async () => { await choices.refetch({ throwOnError: true }); operation.assertCurrent(); }} />}
      <Form.Item name="allocationId" label={english ? "Picked-up item" : "已领取商品"} rules={[{ required: true }]}><Select disabled={!currentChoices || choices.isFetching} options={(currentChoices?.lines ?? []).map(line => ({ value: line.allocationId, label: `${line.itemGroupName} × ${line.quantity}${line.assetNo ? ` · ${line.assetNo}` : ""}` }))}
        onChange={value => { operation.assertCurrent(); setAllocationId(value); setReplacementId(""); form.setFieldsValue({ replacementItemGroupId: undefined, replacementAssetId: undefined, replacementPricingGroupId: undefined }); }} /></Form.Item>
      <Form.Item name="replacementItemGroupId" label={english ? "Replacement item" : "替换商品"} rules={[{ required: true }]}><Select disabled={!allocationId || !currentChoices || choices.isFetching} options={(currentChoices?.replacements ?? []).map(item => ({ value: item.itemGroupId, label: item.name }))}
        onChange={value => { operation.assertCurrent(); setReplacementId(value); form.setFieldsValue({ replacementAssetId: undefined, replacementPricingGroupId: undefined }); }} /></Form.Item>
      {replacement?.inventoryMode === "serialized" && <Form.Item name="replacementAssetId" label={english ? "Available replacement asset" : "当前可用替换资产"} rules={[{ required: true }]}><Select disabled={choices.isFetching} options={(currentChoices?.assets ?? []).map(asset => ({ value: asset.assetId, label: asset.assetNo }))} /></Form.Item>}
      {Boolean(replacement?.pricingGroups.length) && <Form.Item name="replacementPricingGroupId" label={english ? "Replacement pricing group (optional)" : "替换定价分组（可选）"}><Select allowClear disabled={choices.isFetching} options={replacement!.pricingGroups.map(group => ({ value: group.id, label: group.name }))} /></Form.Item>}
      {replacement?.inventoryMode === "serialized" && !choices.isFetching && !currentChoices?.assets.length && <Alert type="warning" title={english ? "No replacement asset is currently available" : "当前没有可用替换资产"} />}
      <p>{english ? "Candidates are not reserved. Price and availability are checked again when you request approval." : "候选尚未预占；申请时再次核对价格、资源和企业付费资格。"}</p>
      <Form.Item name="priceBasis" label={english ? "Price basis" : "价格依据"} rules={[{ required: true }]}><Select options={[{ value: "original_order_price", label: english ? "Original order price" : "原订单价格" }, { value: "replacement_current_price", label: english ? "Replacement current price" : "替换商品当前价格" }]} /></Form.Item>
      <Form.Item name="reason" label={english ? "Purpose" : "用途及原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
      <SaveButton form={form} disabled={operation.blocked || choices.isFetching || !replacement || replacement.inventoryMode === "serialized" && !currentChoices?.assets.length} label={english ? "Request exchange expense approval" : "申请换货费用批准"} onSave={() => operation.run(async () => {
        const values = await form.validateFields(), targetOrderId = values.orderId.trim();
        const line = currentChoices?.lines.find(line => line.allocationId === values.allocationId);
        if (choices.isFetching || !currentChoices || !replacement || !line || targetOrderId !== orderId || values.allocationId !== allocationId || values.replacementItemGroupId !== replacementId
          || replacement.inventoryMode === "serialized" && !currentChoices.assets.some(asset => asset.assetId === values.replacementAssetId)
          || replacement.inventoryMode === "quantity" && values.replacementAssetId
          || values.replacementPricingGroupId && !replacement.pricingGroups.some(group => group.id === values.replacementPricingGroupId)) throw new Error("须重新核对原订单与当前换货候选 / Read the current original exchange choices");
        const order = await operation.read<ClientOrderView>(`/orders/${encodeURIComponent(targetOrderId)}`); operation.assertCurrent();
        if (order.id !== targetOrderId || order.updatedAt !== currentChoices.expectedOrderUpdatedAt) throw new Error("原订单已变化，请重新读取候选 / Original order changed");
        const exchange: EnterpriseExchangeIntent = { orderLineId: line.orderLineId, allocationId: values.allocationId.trim(), replacementItemGroupId: values.replacementItemGroupId.trim(), priceBasis: values.priceBasis,
          ...(values.replacementAssetId?.trim() ? { replacementAssetId: values.replacementAssetId.trim() } : {}), ...(values.replacementPricingGroupId?.trim() ? { replacementPricingGroupId: values.replacementPricingGroupId.trim() } : {}) };
        return { path: "/enterprise/exchange-approvals", originalTarget: orderId, input: { orderId: targetOrderId, expectedOrderUpdatedAt: currentChoices.expectedOrderUpdatedAt, exchange, expectedRevision: 0, reason: values.reason.trim() } };
      }, async () => { await refresh(); resetSelection(); }, refresh)} />
    </Form>}
    {rows.error ? <Alert type="error" title={rows.error instanceof Error ? rows.error.message : "读取失败"} /> : <Table rowKey="id" caption={english ? "Exchange spending requests" : "换货费用申请"} dataSource={rows.data ?? []} loading={rows.isFetching} pagination={false} sorting={false} onRefresh={refresh} columns={[
      { title: english ? "Order" : "订单", dataIndex: "orderId" }, { title: english ? "Applicant" : "申请人", dataIndex: "applicantCustomerId" }, { title: english ? "Purpose" : "用途", dataIndex: "reason" },
      { title: english ? "State" : "状态", render: (_, r) => labels(r.state, english) },
      { title: english ? "Actions" : "操作", render: (_, r) => <ActionButton intent="review" disabled={operation.busy || rows.isFetching} label={english ? "Review this exchange request" : "核对本条换货申请"} onAction={async () => { operation.assertCurrent(); setSelected(r.id); }} /> }
    ]} />}
    {row && <ExchangeReview key={JSON.stringify([context.identity, mode, row])} row={row} reviewMode={mode === "review"} unavailable={rows.isFetching} operation={operation} refresh={refresh} />}
    {mode === "mine" && operation.pending?.path === "/enterprise/exchange-approvals" && operation.pending.originalTarget && !operation.pending.closureKey && <section aria-label={english ? "Original exchange request closure" : "原换货申请终结"}>
      <Alert type="warning" title={english ? "End only this unknown original request" : "仅终结这条未知原申请"} description={english ? "If the request committed, read its original approval. Otherwise permanently seal its key. This is not withdrawal or physical exchange cancellation." : "原申请已成立时只恢复原批准；未成立时永久封闭原键，不是撤回、取消换货或退款。"} />
      <Input.TextArea aria-label={english ? "Original request closure reason" : "原申请终结原因"} value={closureReason} maxLength={500} disabled={operation.busy} onChange={event => setClosureReason(event.target.value)} />
      <Checkbox checked={closureConfirmed} disabled={operation.busy} onChange={event => setClosureConfirmed(event.target.checked)}>{english ? "I independently confirm ending this original request" : "我独立确认终结这条原申请"}</Checkbox>
      <ActionButton intent="confirm" disabled={operation.busy || !closureConfirmed || !closureReason.trim()} label={english ? "Request original application closure" : "请求终结原换货申请"} onAction={async () => {
        operation.assertCurrent(); if (!closureConfirmed || !closureReason.trim()) throw new Error("须独立确认原申请及结束原因");
        await operation.closeExchangeRequest(closureReason.trim(), requestRead);
      }} />
    </section>}
    {operation.pending && <ActionButton intent="review" disabled={operation.busy} label={english ? "Read original exchange operation" : "核对原换货操作"} onAction={recoverOriginal} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
}
