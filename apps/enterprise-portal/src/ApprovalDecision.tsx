/** Confirmation belongs to one immutable approval review, not the whole queue. */
import { useEffect, useRef, useState } from "react";
import type { EnterpriseApprovalOriginalResult, EnterpriseBookingApprovalView } from "@rental-os/shared";
import { ActionButton, Alert, Checkbox, Input } from "@/components/ui/customer-entry";
import { EnterpriseApprovalReview } from "./ApprovalReview";
import type { useOriginalWorkflowOperation } from "./original-workflow-operation";

type Operation = ReturnType<typeof useOriginalWorkflowOperation>;
export function EnterpriseApprovalDecision({ row, reviewMode, english, operation, closureOperation, refresh, unavailable, canDecide }: {
  row: EnterpriseBookingApprovalView; reviewMode: boolean; english: boolean; operation: Operation; closureOperation: Operation; refresh: () => Promise<void>; unavailable: boolean; canDecide: boolean;
}) {
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [original, setOriginal] = useState<EnterpriseApprovalOriginalResult>(), [reading, setReading] = useState(false), [readError, setReadError] = useState("");
  const mounted = useRef(true), readLock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => { operation.assertCurrent(); if (!mounted.current) throw new Error("原审批审阅已变化，请重新核对 / Approval review changed"); };
  const blocked = (row.state === "executing" ? operation.busy || closureOperation.blocked : operation.blocked) || unavailable;
  const writable = () => { current(); if (unavailable || (reviewMode && !canDecide)) throw new Error("当前申请尚不可处理 / This request cannot be changed now"); };
  const decide = async (decision: "approve" | "reject" | "withdraw") => operation.run(() => {
    writable(); if (!reason.trim()) throw new Error("请填写本次原因 / A reason is required");
    return { path: `/enterprise/approvals/${encodeURIComponent(row.id)}/decision`, input: { decision, expectedRevision: row.revision, reason } };
  }, refresh, refresh);
  const submit = async () => operation.run(() => {
    writable(); if (!confirmed || !reason.trim() || row.state !== "approved") throw new Error("须核对本条批准与原报价 / Review this approval first");
    return { path: "/enterprise/approvals/submit", input: { approvalId: row.id, confirm: true, expectedRevision: row.revision, reason } };
  }, refresh, refresh);
  const closeExecution = () => closureOperation.run(() => {
    writable(); if (!confirmed || !reason.trim() || row.state !== "executing") throw new Error("须本人明确结束本条原执行 / Explicitly confirm closing this execution");
    return { path: `/enterprise/approvals/${encodeURIComponent(row.id)}/close-execution`, input: { confirm: true, expectedRevision: row.revision, reason } };
  }, refresh, refresh);
  const readOriginal = async () => {
    current(); if (readLock.current) return; readLock.current = true; setReading(true); setReadError("");
    try {
      const result = await operation.read<EnterpriseApprovalOriginalResult>(`/enterprise/approvals/${encodeURIComponent(row.id)}/result`); current();
      if (result.approval.id !== row.id || result.approval.quoteId !== row.quoteId) throw new Error("原结果引用不匹配 / Original result reference mismatch");
      setOriginal(result);
    } catch (error) { if (mounted.current) setReadError(error instanceof Error ? error.message : "原结果待核对"); throw error; }
    finally { readLock.current = false; if (mounted.current) setReading(false); }
  };
  return <section aria-label={english ? "Selected approval" : "本条审批"}>
    <h2>{english ? "Review this request" : "核对本条申请"}</h2>
    <EnterpriseApprovalReview row={row} english={english} />
    {["pending", "approved", "executing"].includes(row.state) && <Input.TextArea aria-label={english ? "Reason for this request" : "本条申请处理原因"} value={reason} maxLength={500}
      disabled={blocked} onChange={event => setReason(event.target.value)} />}
    {reviewMode && canDecide && row.state === "pending" && <>
      <ActionButton disabled={blocked || !reason.trim()} intent="confirm" label={english ? "Approve this request" : "批准本条申请"} onAction={() => decide("approve")} />
      <ActionButton disabled={blocked || !reason.trim()} intent="confirm" label={english ? "Reject this request" : "拒绝本条申请"} onAction={() => decide("reject")} />
    </>}
    {!reviewMode && ["pending", "approved"].includes(row.state) && <ActionButton disabled={blocked || !reason.trim()} intent="confirm" label={english ? "Withdraw this request" : "撤回本条申请"} onAction={() => decide("withdraw")} />}
    {!reviewMode && row.state === "approved" && <>
      <Checkbox checked={confirmed} disabled={blocked} onChange={event => setConfirmed(event.target.checked)}>
        {english ? "I reviewed this original quote and enterprise responsibility, including the stated guarantee limitations; explicitly submit this request" : "我已核对本条原报价、企业责任及上述保证金未核实事项，明确提交本条请求"}
      </Checkbox>
      <ActionButton disabled={blocked || !confirmed || !reason.trim()} intent="confirm" label={english ? "Explicitly submit this request" : "核对后提交本条请求"} onAction={submit} />
    </>}
    {!reviewMode && ["executing", "consumed"].includes(row.state) && <ActionButton disabled={operation.busy || closureOperation.busy || reading} intent="review" label={english ? "Read original business result" : "核对原业务结果"} onAction={readOriginal} />}
    {!reviewMode && row.state === "executing" && <>
      <Checkbox checked={confirmed} disabled={blocked} onChange={event => setConfirmed(event.target.checked)}>{english ? "Request closure of this original execution, without cancelling a committed order or retrying submission" : "请求受控结束本条原执行，不取消已成立订单，也不重试下单"}</Checkbox>
      <ActionButton disabled={blocked || !confirmed || !reason.trim()} intent="confirm" label={english ? "Request controlled closure" : "请求受控结束原执行"} onAction={closeExecution} />
    </>}
    {row.state === "closed" && <Alert type="info" title={english ? "The original execution is sealed; obtain a new quote and approval before a new request" : "原执行已封闭；新申请必须重新报价并取得新的批准"} />}
    {original && <Alert type={original.original.state === "observed" || original.original.state === "closed" ? "info" : "warning"}
      title={original.original.state === "observed" ? `${english ? "Original order reference" : "原订单引用"}: ${original.original.orderId}` : original.original.state === "closed" ? english ? "Original execution sealed, not retried" : "原执行已封闭，未重试下单" : english ? "Original execution is not yet confirmed; do not submit again" : "尚未确认原执行结果；不能再次提交"}
      description={english ? "An order reference does not prove payment, a guarantee freeze or formal confirmation." : "订单引用不证明已付款、已冻结保证金或已正式确认订单。"} />}
    {readError && <Alert type="error" title={readError} />}
  </section>;
}
