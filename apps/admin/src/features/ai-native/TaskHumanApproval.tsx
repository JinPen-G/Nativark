/** Explicit original-proposal review/decision only. No runner/Core write port.
 * Persist only the exact pending decision reference, never proposal contents. */
import { useEffect, useId, useRef, useState } from "react";
import { AI_PROPOSAL_DRAFT_VERSION, type AiTaskDecisionQueryDraft, type AiTaskHumanReviewDraft,
  type AiTaskHumanDecisionReceiptDraft, type AiTaskReviewQueryDraft } from "@rental-os/shared";
import { aiTaskCenterApi } from "@/api/aiTaskCenter";
import { useLocale } from "@/app/locale";
import { ActionButton, Alert, ConfirmAction, Select } from "@/components/ui";
import { safeDisplayText } from "./safe-display";
import { formatAmount, formatTimestamp } from "./formatters";

const amountLabels = { rentalAmount: "租金", discountAmount: "折扣", couponAmount: "优惠券", serviceAmount: "服务费",
  fulfillmentAmount: "履约费", depositAmount: "押金", preAuthAmount: "预授权", payableAmount: "应付", receivableAmount: "应收" } as const;
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(value);
function pendingDecision(key: string, taskId: string): AiTaskDecisionQueryDraft | "invalid" | null {
  try {
    const saved = sessionStorage.getItem(key); if (!saved) return null;
    if (saved.length > 1024) return "invalid";
    const value = JSON.parse(saved) as AiTaskDecisionQueryDraft;
    return value?.taskId === taskId && id(value.runId) && id(value.stepId) && id(value.proposal?.proposalId)
      && value.proposal.contractVersion === AI_PROPOSAL_DRAFT_VERSION && Number.isInteger(value.proposal.proposalRevision)
      && value.proposal.proposalRevision > 0 && /^[a-f0-9]{64}$/u.test(value.proposal.reviewedPayloadHash)
      && ["approve", "reject"].includes(value.proposal.decision) ? value : "invalid";
  } catch { return "invalid"; }
}
/** Deterministic domain values, deliberately separate from generated model text. */
export function TaskHumanReviewDetails({ value }: { value: AiTaskHumanReviewDraft }) {
  const { t } = useLocale(), payload = value.review.proposal.payload;
  return <div style={{ overflowWrap: "anywhere" }}>
    <p>{t("提案版本")}: {payload.revision} · {t("有效期")}: {formatTimestamp(payload.expiresAt).value}</p>
    <p>{t("提案引用")}: {safeDisplayText(payload.proposalId, 36)} · {t("原任务修订")}: {value.taskRevision}</p>
    {value.kind === "order" ? <dl>{Object.entries(amountLabels).map(([key, label]) => <div key={key}>
      <dt>{t(label)}</dt><dd>{formatAmount(value.review.deterministic.quoteAmounts[key as keyof typeof amountLabels]).value}
        {" "}{safeDisplayText(value.review.deterministic.currency, 16)}</dd>
    </div>)}<dt>{t("原报价")}</dt><dd>{safeDisplayText(value.review.deterministic.target.resourceId, 191)}</dd>
      <dt>{t("原报价版本")}</dt><dd>{safeDisplayText(value.review.deterministic.target.version, 191)}</dd>
      <dt>{t("报价有效期")}</dt><dd>{formatTimestamp(value.review.deterministic.quoteExpiresAt).value}</dd></dl>
      : <dl>{Object.entries(value.review.change.diff).map(([field, change]) => <div key={field}>
        <dt>{t(field === "notifications.enabledEvents" ? "通知事件" : "通知渠道")}</dt>
        <dd>{t("当前值")}: {change.before.map(item => safeDisplayText(item, 128)).join(", ") || t("空列表")}</dd>
        <dd>{t("候选值")}: {change.after.map(item => safeDisplayText(item, 128)).join(", ") || t("空列表")}</dd>
      </div>)}<dt>{t("配置基准修订")}</dt><dd>{value.review.change.baseRevision}</dd></dl>}
    <p>{t("仅审阅这份不可变提案。批准不是订单创建、支付成功或设置已生效，也不会在这里自动继续执行。")}</p>
  </div>;
}
export function TaskHumanApproval({ taskId, identity, current, onAccessDenied }: {
  taskId: string; identity: string; current: () => boolean; onAccessDenied: () => void;
}) {
  const { t } = useLocale(), labelId = useId();
  const storageKey = `ai-task-decision:${identity}:${taskId}`;
  const [original, setOriginal] = useState(() => pendingDecision(storageKey, taskId));
  const [steps, setSteps] = useState<AiTaskReviewQueryDraft[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [review, setReview] = useState<AiTaskHumanReviewDraft | null>(null);
  const [receipt, setReceipt] = useState<AiTaskHumanDecisionReceiptDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const active = useRef({ current, onAccessDenied }); active.current = { current, onAccessDenied };
  const flight = useRef<AbortController | null>(null);
  useEffect(() => () => { flight.current?.abort(); }, []);
  const run = async (work: (signal: AbortSignal) => Promise<void>, write = false) => {
    if (flight.current || !active.current.current()) throw Error("AI_SCOPE_CHANGED");
    const controller = new AbortController(); flight.current = controller; setBusy(true); setMessage(null);
    const same = () => active.current.current() && !controller.signal.aborted;
    try { await work(controller.signal); if (!same()) throw Error("AI_SCOPE_CHANGED"); }
    catch (error) {
      if (same()) {
        setReview(null); setReceipt(null);
        setMessage(write ? t("决定应答未确认，只能核对原决定收据；不要再次提交。") : t("当前不可读取，请核对权限、原版本或人工业务页。"));
        if ([401, 403].includes((error as { response?: { status?: number } }).response?.status ?? 0)) active.current.onAccessDenied();
      }
      throw error;
    } finally { if (flight.current === controller) { flight.current = null; if (same()) setBusy(false); } }
  };
  const same = (signal: AbortSignal) => active.current.current() && !signal.aborted;
  const readSteps = () => run(async signal => {
    setReview(null); setReceipt(null); setSteps([]); setSelected(null);
    const snapshot = await aiTaskCenterApi.snapshot(taskId, signal);
    if (!same(signal)) return;
    if (snapshot.taskId !== taskId || !Array.isArray(snapshot.steps) || snapshot.steps.length > 1000) throw Error("AI_RESOURCE_UNAVAILABLE");
    const candidates = snapshot.status === "waiting_confirmation" ? snapshot.steps.filter(row => row.kind === "confirmation" && row.status === "running") : [];
    if (candidates.length > 20) throw Error("AI_RESOURCE_UNAVAILABLE");
    setSteps(candidates.map(row => ({ taskId, runId: row.runId, stepId: row.stepId })));
    if (!candidates.length) setMessage(t("本次没有可审阅的等待步骤。历史阶段请用原确认历史读取，不代表业务未执行。"));
  });
  const readReview = () => run(async signal => {
    setReview(null); setReceipt(null);
    const target = steps.find(step => `${step.runId}:${step.stepId}` === selected);
    if (!target) throw Error("AI_INVALID_INPUT");
    const value = await aiTaskCenterApi.review(target, signal);
    if (!same(signal)) return;
    if (value.taskId !== taskId || value.runId !== target.runId || value.stepId !== target.stepId
      || !["order", "settings"].includes(value.kind) || value.businessExecution !== "not_attested"
      || value.review.proposal.payload.taskId !== taskId || value.review.proposal.payload.actions.length !== 1
      || !/^[a-f0-9]{64}$/u.test(value.review.proposal.payloadHash)) throw Error("AI_RESOURCE_UNAVAILABLE");
    setReview(structuredClone(value));
  });
  const observe = (result: AiTaskHumanDecisionReceiptDraft, query: AiTaskDecisionQueryDraft, signal: AbortSignal) => {
    if (!same(signal)) return;
    if (result.taskId !== taskId || result.runId !== query.runId || result.stepId !== query.stepId
      || result.businessExecution !== "not_attested") throw Error("AI_RESOURCE_UNAVAILABLE");
    if (result.receipt.kind === "recorded") {
      const record = result.receipt.record;
      if (record.proposalId !== query.proposal.proposalId || record.proposalRevision !== query.proposal.proposalRevision
        || record.payloadHash !== query.proposal.reviewedPayloadHash || record.decision !== (query.proposal.decision === "approve" ? "approved" : "rejected"))
        throw Error("AI_RESOURCE_UNAVAILABLE");
      sessionStorage.removeItem(storageKey); setOriginal(null); setReview(null);
    }
    setReceipt(result);
  };
  const decide = (decision: "approve" | "reject") => run(async signal => {
    if (!review || original) throw Error("AI_RESOURCE_UNAVAILABLE");
    const payload = review.review.proposal.payload;
    const query: AiTaskDecisionQueryDraft = { taskId, runId: review.runId, stepId: review.stepId, proposal: {
      contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: payload.proposalId, proposalRevision: payload.revision,
      reviewedPayloadHash: review.review.proposal.payloadHash, decision
    } };
    // Failure to retain the original reference stops before any network write.
    sessionStorage.setItem(storageKey, JSON.stringify(query)); setOriginal(query);
    const result = await aiTaskCenterApi.decision(query, signal);
    observe(result, query, signal);
    if (result.receipt.kind !== "recorded") throw Error("AI_RESULT_UNKNOWN");
  }, true);
  const expires = review ? Math.min(Date.parse(review.review.proposal.payload.expiresAt),
    review.kind === "order" ? Date.parse(review.review.deterministic.quoteExpiresAt) : Infinity) : NaN;
  const canDecide = !!review && review.review.proposal.status === "pending_confirmation" && Number.isFinite(expires) && expires > Date.now() && !original && !busy;
  return <section aria-label={t("原提案人工审阅")} aria-busy={busy}>
    <h3>{t("原提案人工审阅")}</h3>
    <p>{t("服务器按原任务定位提案并复验业务权限。只有明确审阅后才能提交决定；这里不继续执行、不建单、不修改设置。")}</p>
    <div className="panel-toolbar">
      <ActionButton label={t("读取待审阅步骤")} disabled={busy || !!original} onAction={readSteps} />
      {!!steps.length && <><label id={labelId}>{t("原等待步骤")}</label><Select aria-labelledby={labelId} value={selected}
        disabled={busy || !!original} options={steps.map(step => ({ value: `${step.runId}:${step.stepId}`, label: safeDisplayText(step.stepId, 36) }))}
        onChange={value => { setSelected(String(value)); setReview(null); setReceipt(null); }} />
        <ActionButton label={t("审阅选中提案")} disabled={!selected || busy || !!original} onAction={readReview} /></>}
    </div>
    {message && <Alert type="warning" title={message} />}
    {original === "invalid" && <Alert type="warning" title={t("原决定引用不可读取。请通过原业务页核对，不再提交新决定。")}/>}
    {original && original !== "invalid" && <ActionButton label={t("核对原决定收据")} disabled={busy} onAction={() => run(async signal => {
      setReceipt(null); observe(await aiTaskCenterApi.decisionReceipt(structuredClone(original), signal), original, signal);
    })} />}
    {review && <><TaskHumanReviewDetails value={review} /><div className="panel-toolbar">
      <ConfirmAction key={`approve:${review.review.proposal.payloadHash}`} label={t("批准这份提案")}
        prompt={t("已核对原对象、金额或差异、版本及有效期？仅记录批准，不执行业务。")}
        doneLabel={t("决定已记录，业务未执行")} disabled={!canDecide} onConfirm={() => decide("approve")} />
      <ConfirmAction key={`reject:${review.review.proposal.payloadHash}`} label={t("拒绝这份提案")}
        prompt={t("确认拒绝这份原提案？不会取消已发生的业务操作。")}
        doneLabel={t("决定已记录")} disabled={!canDecide} onConfirm={() => decide("reject")} />
    </div></>}
    {receipt && <p role="status" aria-live="polite">{t(receipt.receipt.kind === "recorded"
      ? receipt.receipt.record.decision === "approved" ? "原批准已记录，不代表业务已执行。" : "原拒绝已记录，不代表业务已回滚。"
      : "原决定尚未确认，保留原引用，不自动重试或推断未提交。")}</p>}
  </section>;
}
