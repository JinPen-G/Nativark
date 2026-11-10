/** Explicit original transfer recovery. C is not an acceptance retry or an undo.
 * Permission entry is re-read only after exact evidence and local reference retirement. */
import { useEffect, useState } from "react";
import type { EnterpriseWorkflowView } from "@rental-os/shared";
import { ActionButton, Alert, Checkbox, ConfirmAction, Input } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
import type { useOriginalWorkflowOperation } from "./original-workflow-operation";
import { EnterpriseWorkflowReview } from "./WorkflowReview";
import { readAdministratorTransferMaterial } from "./administrator-transfer-review";
type Operation = ReturnType<typeof useOriginalWorkflowOperation>;
type Review = { identity: string; key: string; row: EnterpriseWorkflowView; reason: string; confirmed: boolean };
const reviewKey = (identity: string, row: EnterpriseWorkflowView, originalKey: string) => JSON.stringify([identity, originalKey, row.id, row.kind, row.state, row.revision,
  row.payload?.fromCustomerId, row.payload?.targetMembershipId, readAdministratorTransferMaterial(row)]);
export function EnterpriseTransferDecisionRecovery({ row, operation, refresh, unavailable, english }: {
  row?: EnterpriseWorkflowView; operation: Operation; refresh: () => Promise<void>; unavailable: boolean; english: boolean;
}) {
  const context = useEnterprise(), pending = operation.pending, id = operation.transferDecisionId;
  const [review, setReview] = useState<Review>();
  useEffect(() => setReview(undefined), [context.identity, pending?.key, pending?.closureKey]);
  const owned = row?.kind === "administrator_transfer" && row.id === id && row.applicantCustomerId === context.session?.customer.customerId;
  const key = owned && pending ? reviewKey(context.identity, row!, pending.key) : undefined;
  const reviewed = review?.identity === context.identity ? review : undefined, changed = Boolean(reviewed && reviewed.key !== key);
  const canStart = Boolean(pending && pending.state === "unknown" && !pending.closureKey && owned && row?.state === "pending" && !unavailable && !operation.busy);
  const confirmed = Boolean(canStart && reviewed && !changed && reviewed.reason.trim() && reviewed.confirmed);
  if (!pending || !id) return null;
  const readOriginal = async () => {
    const original = pending.closureKey
      ? await operation.recoverTransferDecision(async () => { await refresh(); operation.assertCurrent(); })
      : await operation.recover(async () => { await refresh(); operation.assertCurrent(); });
    operation.assertCurrent();
    // Reload outside the original gate, after K/C were retired; reload aborts the old readers.
    if (original && ("decision" in original ? original.decision.state === "approved" : original.result?.state === "approved")) context.reload();
  };
  return <section aria-label={english ? "Original transfer recovery" : "原交接结果核对"}>
    <Alert type="warning" title={pending.closureKey
      ? (english ? "The independent refusal is unconfirmed. Read both original K/C receipts; do not send it again." : "独立拒绝结果待核对；只核原 K/C 收据，不再次发送。")
      : (english ? "Keep the original decision. A missing receipt does not prove no write." : "保留原交接决策；缺收据不代表未写入。")}/>
    <ActionButton intent="review" disabled={operation.busy || context.loading || !context.session} label={pending.closureKey ? (english ? "Read original K/C result" : "核对原 K/C 结果") : (english ? "Read original result" : "核对原交接结果")} onAction={readOriginal}/>
    {!pending.closureKey && (!reviewed || changed) && <ActionButton intent="review" disabled={!canStart} label={english ? "Review original refusal" : "核对本条独立拒绝"} onAction={async () => {
      operation.assertCurrent(); if (!canStart || !row || !key) throw new Error(english ? "Read this recipient's pending original transfer first." : "须先读取本人本条待处理交接。");
      setReview({ identity: context.identity, key, row, reason: "", confirmed: false });
    }}/>}
    {changed && <Alert type="warning" title={english ? "The original material changed. Review again; earlier input is not rebound." : "原交接材料已变化，须重新核对；旧输入不自动改绑。"}/>}
    {reviewed && !pending.closureKey && <>
      <EnterpriseWorkflowReview row={reviewed.row} english={english}/>
      <Input.TextArea aria-label={english ? "Original transfer refusal reason" : "本条原交接拒绝原因"} maxLength={500} disabled={!canStart || changed} value={reviewed.reason} onChange={event => setReview({ ...reviewed, reason: event.target.value })}/>
      <Checkbox disabled={!canStart || changed} checked={reviewed.confirmed} onChange={event => setReview({ ...reviewed, confirmed: event.target.checked })}>
        {english ? "I request refusal only while this original transfer is pending. An existing decision is only read, never undone or regranted." : "我只请求拒绝本条仍待处理的交接；已成立决策只核对，不撤销或重授管理员权限。"}
      </Checkbox>
      <ConfirmAction disabled={!confirmed} label={english ? "Confirm original refusal" : "确认拒绝原交接"} prompt={english ? "Refuse this original pending transfer? If its decision committed first, only read that result." : "明确拒绝本条原待处理交接？原决策若已先成立，仅核对其结果。"} onConfirm={async () => {
        const resolution = await operation.closeTransferDecision(() => {
          operation.assertCurrent(); if (!confirmed || !reviewed || reviewed.key !== key) throw new Error(english ? "Review and explicitly confirm this original refusal first." : "须先核对并明确确认本条原拒绝。");
          return { expectedRevision: reviewed.row.revision, reason: reviewed.reason.trim() };
        }, async () => { await refresh(); operation.assertCurrent(); });
        operation.assertCurrent(); if (resolution.decision.state === "approved") context.reload();
      }}/>
    </>}
    {!canStart && !pending.closureKey && <p>{english ? "New refusal requires this recipient's readable pending original. Existing decisions and unavailable data remain read-only." : "新拒绝须本人原待处理交接可读取；已处理或读取不可用时，只核原结果。"}</p>}
    {operation.error && <Alert type="error" title={operation.error}/>}
  </section>;
}
