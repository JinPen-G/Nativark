/** Explicit human review/decision and original approved-host continuation.
 * Displays frozen proposal boundaries and independently read step receipts;
 * registration/state is not a complete plan, rollback or execution grant.
 * No arbitrary action/Core callback; persist references only, never contents. */
import { useEffect, useId, useRef, useState } from "react";
import { AI_PROPOSAL_DRAFT_VERSION, AI_TASK_DRAFT_VERSION, AI_STEP_STATUSES_DRAFT, AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION, RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES,
  type AiTaskSnapshotDraft, type AiTaskDecisionQueryDraft, type AiTaskHumanReviewDraft,
  type AiTaskHumanDecisionReceiptDraft, type AiTaskReviewQueryDraft, type AiTaskBusinessObservationDraft,
  type AiTaskHumanContinueDraft, type AiApprovalOrderMaterialDraft, type AiApprovalApplicationReferenceDraft,
  type AiApprovalApplicationReviewDraft, type AiQuoteSelectionProofDraft, validateAiQuoteSelectionHttpValue } from "@rental-os/shared";
import { aiTaskCenterApi } from "@/api/aiTaskCenter";
import { useAiManagementLocale as useLocale } from './management-locale';
import { ActionButton, Alert, ConfirmAction, Select } from "@/components/ui";
import { safeDisplayText } from "./safe-display";
import { VisibleObservationBoundary } from './VisibleObservationBoundary';
import { formatAmount, formatTimestamp } from "./formatters";

const amountLabels = { rentalAmount: "租金", discountAmount: "折扣", couponAmount: "优惠券", serviceAmount: "服务费",
  fulfillmentAmount: "履约费", depositAmount: "押金", preAuthAmount: "预授权", payableAmount: "应付", receivableAmount: "应收" } as const;
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(value);
function pendingDecision(key: string, taskId: string, runId?: string): AiTaskDecisionQueryDraft | "invalid" | null {
  try {
    const saved = sessionStorage.getItem(key); if (!saved) return null;
    if (saved.length > 1024) return "invalid";
    const value = JSON.parse(saved) as AiTaskDecisionQueryDraft;
    return value?.taskId === taskId && id(value.runId) && (runId === undefined || value.runId === runId) && id(value.stepId) && id(value.proposal?.proposalId)
      && value.proposal.contractVersion === AI_PROPOSAL_DRAFT_VERSION && Number.isInteger(value.proposal.proposalRevision)
      && value.proposal.proposalRevision > 0 && /^[a-f0-9]{64}$/u.test(value.proposal.reviewedPayloadHash)
      && ["approve", "reject"].includes(value.proposal.decision) ? value : "invalid";
  } catch { return "invalid"; }
}
function pendingContinuation(key: string, taskId: string, runId?: string): AiTaskHumanContinueDraft | "invalid" | null {
  try {
    const saved = sessionStorage.getItem(key); if (!saved) return null;
    if (saved.length > 1024) return "invalid";
    const value = JSON.parse(saved) as AiTaskHumanContinueDraft;
    return value?.taskId === taskId && id(value.runId) && (runId === undefined || value.runId === runId) && id(value.stepId) && id(value.checkpointRef)
      && Number.isInteger(value.expectedTaskRevision) && value.expectedTaskRevision > 0
      && id(value.proposal?.proposalId) && value.proposal.contractVersion === AI_PROPOSAL_DRAFT_VERSION
      && Number.isInteger(value.proposal.proposalRevision) && value.proposal.proposalRevision > 0
      && /^[a-f0-9]{64}$/u.test(value.proposal.reviewedPayloadHash) ? value : "invalid";
  } catch { return "invalid"; }
}
const materialId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const materialText = (value: unknown, max = 191) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const validPeriod = (value: { startAt: string; endAt: string }) => formatTimestamp(value.startAt).available
  && formatTimestamp(value.endAt).available && Date.parse(value.startAt) < Date.parse(value.endAt);
/** Only the server's closed proposal contract supplies an execution boundary. */
export function hasProposalExecutionBoundary(value: AiTaskHumanReviewDraft): boolean {
  try {
    const payload = value.review.proposal.payload;
    return payload.contractVersion === AI_PROPOSAL_DRAFT_VERSION && payload.failurePolicy === 'stop_and_reconcile'
      && Array.isArray(payload.actions) && payload.actions.length > 0
      && (payload.atomicity === 'single_action' ? payload.actions.length === 1
        : payload.atomicity === 'ordered_partial' && payload.actions.length <= 20);
  } catch { return false; }
}
export type TaskHumanStep = AiTaskReviewQueryDraft & Pick<AiTaskSnapshotDraft['steps'][number], 'sequence' | 'revision' | 'status'>;
export const taskHumanStepKey = (step: { runId: string; stepId: string }) => `${step.runId}:${step.stepId}`;
/** Registered steps are a bounded observation, not the complete unstarted plan. */
export function taskHumanSteps(snapshot: AiTaskSnapshotDraft, taskId: string): TaskHumanStep[] {
  if (snapshot.contractVersion !== AI_TASK_DRAFT_VERSION || snapshot.taskId !== taskId
    || !Array.isArray(snapshot.steps) || snapshot.steps.length > 1000) throw Error('AI_RESOURCE_UNAVAILABLE');
  const rows = snapshot.steps.filter(row => row.kind === 'confirmation');
  if (rows.length > 20 || rows.some(row => !id(row.stepId) || !id(row.runId)
    || !Number.isSafeInteger(row.sequence) || row.sequence < 1 || !Number.isSafeInteger(row.revision) || row.revision < 1
    || !AI_STEP_STATUSES_DRAFT.includes(row.status)) || new Set(rows.map(taskHumanStepKey)).size !== rows.length)
    throw Error('AI_RESOURCE_UNAVAILABLE');
  return rows.map(row => ({ taskId, runId: row.runId, stepId: row.stepId,
    sequence: row.sequence, revision: row.revision, status: row.status }));
}
/** The read DTO deliberately excludes registration metadata and cached content. */
export const taskHumanStepQuery = (taskId: string, step: { runId: string; stepId: string }): AiTaskReviewQueryDraft =>
  ({ taskId, runId: step.runId, stepId: step.stepId });
const stepStatusLabels = { pending: '尚未开始', running: '步骤进行中', succeeded: '步骤已成功，业务仍须原收据',
  failed: '步骤失败', unknown: '原动作结果待核对', cancelled: '步骤已取消，不推断业务回滚' } as const;
export function originalBusinessObservation(value: AiTaskBusinessObservationDraft, query: AiTaskReviewQueryDraft): boolean {
  if (value.taskId !== query.taskId || value.runId !== query.runId || value.stepId !== query.stepId
    || value.execution !== 'read_only_no_start_no_reconnect_side_effect' || value.payment !== 'not_inferred'
    || value.fulfillment !== 'not_inferred' || !['committed', 'unknown', 'not_observed'].includes(value.status)
    || !['order', 'settings'].includes(value.kind) || !formatTimestamp(value.observedAt).available) return false;
  if (value.status !== 'committed') return true;
  return value.kind === 'order' ? !!value.order && [value.order.id, value.order.status, value.order.quoteId]
    .every(item => typeof item === 'string' && item.length > 0 && item.length <= 191)
    : !!value.receipt && Number.isSafeInteger(value.receipt.resultRevision) && value.receipt.resultRevision > 0
      && formatTimestamp(value.receipt.committedAt).available;
}
/** Old/missing materials may not enable approval or continuation on this host. */
export function hasOrderReviewMaterial(value: AiTaskHumanReviewDraft): boolean {
  try {
    if (!hasProposalExecutionBoundary(value)) return false;
    if (value.kind !== 'order') return true;
    const review = value.review, order = review.deterministic.order;
    const optionalName = (name: unknown) => name === undefined || materialText(name);
    if (review.draftVersion !== AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION || !order || !materialId(order.customer.id)
      || !['personal', 'corporate'].includes(order.customer.type) || !optionalName(order.customer.name)
      || !['personal', 'enterprise_employee'].includes(order.booking.identity) || typeof order.booking.enterpriseContractAndPayer !== 'boolean'
      || order.booking.corporateCustomerId !== undefined && !materialId(order.booking.corporateCustomerId)
      || !optionalName(order.booking.corporateCustomerName)
      || order.booking.identity === 'enterprise_employee' && !order.booking.corporateCustomerId
      || !validPeriod(order.period) || order.period.timeZone !== undefined && !materialText(order.period.timeZone, 128)
      || !RENTAL_FULFILLMENT_MODES.includes(order.fulfillment.mode) || !materialId(order.fulfillment.pickupLocationId)
      || !materialId(order.fulfillment.returnLocationId) || !Array.isArray(order.lines) || !order.lines.length || order.lines.length > 100
      || order.lines.some(line => !materialId(line.itemGroupId) || line.pricingGroupId !== undefined && !materialId(line.pricingGroupId)
        || !optionalName(line.name) || !formatAmount(line.quantity).available || line.quantity < 1
        || line.pricingUnit !== undefined && !RENTAL_PRICING_UNIT_CODES.includes(line.pricingUnit))
      || !Array.isArray(order.services) || order.services.length > 100 || order.services.some(row => !materialId(row.serviceId)
        || !materialText(row.name) || !formatAmount(row.quantity).available || row.quantity < 1 || !validPeriod(row)
        || !materialId(row.locationId) || typeof row.requiredByRule !== 'boolean')) return false;
    const address = order.fulfillment.deliveryAddress;
    return !address || materialText(address.recipient, 128) && materialText(address.countryCode, 16)
      && materialText(address.province, 128) && materialText(address.city, 128) && materialText(address.detail, 500)
      && (address.district === undefined || materialText(address.district, 128))
      && (address.postalCode === undefined || materialText(address.postalCode, 32));
  } catch { return false; }
}
const fulfillmentLabels = { store_pickup_return: '门店自取还', partner_pickup_return: '合作点取还',
  warehouse_pickup_return: '仓库取还', locker_pickup_return: '自助柜取还', delivery: '配送',
  onsite_delivery: '上门交付', carrier_shipping: '承运寄送' } as const;
/** Policy labels describe the frozen proposal, never a model's rollback claim. */
export function TaskProposalExecutionBoundary({ value }: { value: AiTaskHumanReviewDraft }) {
  const { t } = useLocale();
  if (!hasProposalExecutionBoundary(value)) return <Alert type="warning" title={t('原执行边界缺失或不兼容，不能批准或继续。')} />;
  const payload = value.review.proposal.payload;
  return <section aria-label={t('原计划执行边界')}>
    <h4>{t('原计划执行边界')}</h4>
    <dl><dt>{t('当前提案原子边界')}</dt><dd>{t(payload.atomicity === 'single_action'
      ? '只覆盖当前一个动作，不代表整个任务原子提交。'
      : '顺序动作分别提交，允许部分完成，不存在整个计划的原子回滚。')}</dd>
      <dt>{t('当前审批动作数量')}</dt><dd>{payload.actions.length}</dd>
      <dt>{t('失败处理')}</dt><dd>{t('停止后续动作并核对原操作结果；unknown不能换键重发。')}</dd>
      <dt>{t('补偿与外部副作用')}</dt><dd>{t('已完成动作不会自动撤销或退款；补偿须走原业务入口与审批，外部副作用不承诺回滚。')}</dd>
      <dt>{t('确认范围')}</dt><dd>{t('只批准这份冻结提案；后继动作另行确认，原高风险审核链不变。')}</dd></dl>
  </section>;
}
/** Per-step receipt observations survive choosing a successor, not scope refresh. */
export function TaskActionResults({ steps, observations }: { steps: readonly TaskHumanStep[];
  observations: Readonly<Record<string, AiTaskBusinessObservationDraft>> }) {
  const { t } = useLocale();
  if (!steps.length) return null;
  return <section aria-label={t('已登记动作与原结果')} style={{ overflowWrap: 'anywhere' }}>
    <h4>{t('已登记动作与原结果')}</h4>
    <p className="muted">{t('仅列已登记原步骤，不代表完整未执行计划；步骤状态不代替Core业务收据。')}</p>
    <ol>{steps.map(step => {
      const value = observations[taskHumanStepKey(step)];
      const observed = value && originalBusinessObservation(value, taskHumanStepQuery(step.taskId, step)) ? value : null;
      return <li key={taskHumanStepKey(step)}>
        <p>{t('原运行')}: {safeDisplayText(step.runId, 36)} · {t('动作顺序')}: {step.sequence}
          {' · '}{t('原步骤')}: {safeDisplayText(step.stepId, 36)} · {t('步骤修订')}: {step.revision}</p>
        <p>{t(stepStatusLabels[step.status])}</p>
        {observed ? <>
          <p>{t('业务观察时间')}: {formatTimestamp(observed.observedAt).value}</p>
          <p>{observed.status === 'committed' ? observed.kind === 'order'
            ? <>{t('原Core订单已确认提交')}: {safeDisplayText(observed.order.id, 191)}</>
            : <>{t('原设置修改已确认提交')}: {t('结果修订')} {observed.receipt.resultRevision}</>
            : t(observed.status === 'unknown' ? '原业务结果待核对，不能自动重试。' : '尚未观察到原业务收据，不证明未提交。')}</p>
        </> : <p>{t('尚未读取该动作的原业务收据，不推断未执行或已回滚。')}</p>}
      </li>;
    })}</ol>
    <p>{t('后继失败或待核对不会自动回滚此前已提交动作；需要补偿时另走原业务入口与审批。')}</p>
  </section>;
}
/** Original Core material shared by selection and final human approval. */
export function TaskOrderMaterialDetails({ order }: { order: AiApprovalOrderMaterialDraft }) {
  const { t } = useLocale();
  return <div style={{ overflowWrap: 'anywhere' }}>
      <dl><dt>{t('客户')}</dt><dd>{order.customer.name && <>{safeDisplayText(order.customer.name, 191)} · </>}{safeDisplayText(order.customer.id, 191)} ({t(order.customer.type === 'personal' ? '个人' : '企业')})</dd>
        <dt>{t('预约身份')}</dt><dd>{t(order.booking.identity === 'personal' ? '个人' : '企业员工')}
          {order.booking.corporateCustomerId && <> · {safeDisplayText(order.booking.corporateCustomerName ?? order.booking.corporateCustomerId, 191)}</>}
          {order.booking.enterpriseContractAndPayer && <> · {t('企业签约与付款')}</>}</dd>
        <dt>{t('租期开始')}</dt><dd>{formatTimestamp(order.period.startAt).value}</dd>
        <dt>{t('租期结束')}</dt><dd>{formatTimestamp(order.period.endAt).value}</dd>
        {order.period.timeZone && <><dt>{t('营业时区')}</dt><dd>{safeDisplayText(order.period.timeZone, 128)}</dd></>}
        <dt>{t('履约方式')}</dt><dd>{t(fulfillmentLabels[order.fulfillment.mode])}</dd>
        <dt>{t('领取地点')}</dt><dd>{safeDisplayText(order.fulfillment.pickupLocationId, 191)}</dd>
        <dt>{t('归还地点')}</dt><dd>{safeDisplayText(order.fulfillment.returnLocationId, 191)}</dd>
        {order.fulfillment.deliveryAddress && <><dt>{t('配送目的地')}</dt><dd>{safeDisplayText(order.fulfillment.deliveryAddress.recipient, 128)} · {[order.fulfillment.deliveryAddress.countryCode,
          order.fulfillment.deliveryAddress.province, order.fulfillment.deliveryAddress.city, order.fulfillment.deliveryAddress.district,
          order.fulfillment.deliveryAddress.detail, order.fulfillment.deliveryAddress.postalCode].filter(Boolean).map(part => safeDisplayText(part, 500)).join(' ')}</dd></>}
      </dl>
      <h4>{t('租赁对象与数量')}</h4><ol>{order.lines.map((line, index) => <li key={index}>{line.name && <>{safeDisplayText(line.name, 191)} · </>}
        {safeDisplayText(line.itemGroupId, 191)}{line.pricingGroupId && <> · {t('定价分组')}: {safeDisplayText(line.pricingGroupId, 191)}</>}
        {' · '}{t('数量')}: {formatAmount(line.quantity).value}{line.pricingUnit && <> · {t('计价单位')}: {safeDisplayText(line.pricingUnit, 32)}</>}</li>)}</ol>
      {!!order.services.length && <><h4>{t('增值服务')}</h4><ul>{order.services.map((row, index) => <li key={index}>{safeDisplayText(row.name, 191)} · {safeDisplayText(row.serviceId, 191)}
        {' · '}{t('数量')}: {formatAmount(row.quantity).value} · {formatTimestamp(row.startAt).value} — {formatTimestamp(row.endAt).value}
        {' · '}{t('服务地点')}: {safeDisplayText(row.locationId, 191)}{row.requiredByRule && <> · {t('业务规则要求')}</>}</li>)}</ul></>}
    
  </div>;
}
/** The same frozen amounts are used in approval and old/new quotation review. */
export function TaskOrderQuoteAmounts({ review }: { review: AiApprovalApplicationReviewDraft }) {
  const { t } = useLocale();
  return <dl>{Object.entries(amountLabels).map(([key, label]) => <div key={key}>
    <dt>{t(label)}</dt><dd>{formatAmount(review.deterministic.quoteAmounts[key as keyof typeof amountLabels]).value}
      {" "}{safeDisplayText(review.deterministic.currency, 16)}</dd>
  </div>)}<dt>{t("原报价")}</dt><dd>{safeDisplayText(review.deterministic.target.resourceId, 191)}</dd>
    <dt>{t("原报价版本")}</dt><dd>{safeDisplayText(review.deterministic.target.version, 191)}</dd>
    <dt>{t("报价有效期")}</dt><dd>{formatTimestamp(review.deterministic.quoteExpiresAt).value}</dd></dl>;
}
/** Deterministic domain values, deliberately separate from generated model text. */
export function TaskHumanReviewDetails({ value }: { value: AiTaskHumanReviewDraft }) {
  const { t } = useLocale(), payload = value.review.proposal.payload;
  if (!hasOrderReviewMaterial(value)) return <Alert type="warning" title={t('原审批材料缺失或版本不兼容，不能批准或继续，请回原业务页核对。')} />;
  const order = value.kind === 'order' ? value.review.deterministic.order : null;
  return <div style={{ overflowWrap: "anywhere" }}>
    <p>{t("提案版本")}: {payload.revision} · {t("有效期")}: {formatTimestamp(payload.expiresAt).value}</p>
    <p>{t("提案引用")}: {safeDisplayText(payload.proposalId, 36)} · {t("原任务修订")}: {value.taskRevision}</p>
    <TaskProposalExecutionBoundary value={value} />
    {order && <TaskOrderMaterialDetails order={order} />}
    {value.kind === "order" ? <TaskOrderQuoteAmounts review={value.review} />
      : <dl><dt>{t("来源")}</dt><dd>{t("原通知设置")}</dd>
        <dt>{t("受影响经营空间")}</dt><dd>{value.review.proposal.payload.scope.kind === 'workspace'
          ? safeDisplayText(value.review.proposal.payload.scope.workspaceId, 36) : t("不可用")}</dd>
        {Object.entries(value.review.change.diff).map(([field, change]) => <div key={field}>
        <dt>{t(field === "notifications.enabledEvents" ? "通知事件" : "通知渠道")}</dt>
        <dd>{t("当前值")}: {change.before.map(item => safeDisplayText(item, 128)).join(", ") || t("空列表")}</dd>
        <dd>{t("候选值")}: {change.after.map(item => safeDisplayText(item, 128)).join(", ") || t("空列表")}</dd>
      </div>)}<dt>{t("配置基准修订")}</dt><dd>{value.review.change.baseRevision}</dd></dl>}
    <p>{t("仅审阅这份不可变提案。批准不是订单创建、支付成功或设置已生效；继续执行需要另行明确确认。")}</p>
  </div>;
}
export type TaskOrderReviewReference = AiTaskReviewQueryDraft & {
  original: AiApprovalApplicationReferenceDraft; selection?: AiQuoteSelectionProofDraft;
};
export function TaskHumanApproval({ taskId, identity, current, onAccessDenied, runId, onOrderReviewed, requestedProposal }: {
  taskId: string; identity: string; current: () => boolean; onAccessDenied: () => void; runId?: string;
  onOrderReviewed?: (value: TaskOrderReviewReference | null) => void;
  requestedProposal?: AiTaskReviewQueryDraft & { proposal: AiApprovalApplicationReferenceDraft };
}) {
  const { t } = useLocale(), labelId = useId();
  const storageKey = `ai-task-decision:${identity}:${taskId}${runId ? `:${runId}` : ''}`;
  const [original, setOriginal] = useState(() => pendingDecision(storageKey, taskId, runId));
  const continueKey = `${storageKey}:continue`;
  const [continuation, setContinuation] = useState(() => pendingContinuation(continueKey, taskId, runId));
  const [steps, setSteps] = useState<TaskHumanStep[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [stepObservations, setStepObservations] = useState<Record<string, AiTaskBusinessObservationDraft>>({});
  const [review, setReview] = useState<AiTaskHumanReviewDraft | null>(null);
  const [receipt, setReceipt] = useState<AiTaskHumanDecisionReceiptDraft | null>(null);
  const [business, setBusiness] = useState<AiTaskBusinessObservationDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const requestedKey = JSON.stringify(requestedProposal ?? null), requestedOwner = useRef(requestedKey);
  requestedOwner.current = requestedKey;
  const active = useRef({ current, onAccessDenied, onOrderReviewed }); active.current = { current, onAccessDenied, onOrderReviewed };
  const reviewedOrder = useRef<TaskOrderReviewReference | null>(null);
  const reportOrderReview = (value: TaskOrderReviewReference | null) => {
    reviewedOrder.current = value;
    active.current.onOrderReviewed?.(value);
  };
  const flight = useRef<AbortController | null>(null);
  useEffect(() => () => { flight.current?.abort(); }, []);
  useEffect(() => {
    if (!requestedProposal || requestedProposal.taskId !== taskId || runId !== undefined && requestedProposal.runId !== runId) return;
    // A model request is only a locator for the original fixed review. Pending
    // user decisions/continuations keep their own journal and are never replaced.
    if (original || continuation || !active.current.current()) return;
    flight.current?.abort();
    const source = reviewedOrder.current;
    if (source && (source.runId !== requestedProposal.runId || source.stepId !== requestedProposal.stepId
      || source.original.proposalId !== requestedProposal.proposal.proposalId
      || source.original.proposalRevision !== requestedProposal.proposal.proposalRevision
      || source.original.reviewedPayloadHash !== requestedProposal.proposal.reviewedPayloadHash)) reportOrderReview(null);
    setReview(null); setReceipt(null); setBusiness(null); setSteps([]); setSelected(null);
  }, [requestedKey, taskId, runId]);
  const run = async (work: (signal: AbortSignal) => Promise<void>, write = false) => {
    if (flight.current || !active.current.current() || requestedOwner.current !== requestedKey) throw Error("AI_SCOPE_CHANGED");
    const controller = new AbortController(); flight.current = controller; setBusy(true); setMessage(null);
    const same = () => active.current.current() && !controller.signal.aborted;
    try { await work(controller.signal); if (!same()) throw Error("AI_SCOPE_CHANGED"); }
    catch (error) {
      if (same()) {
        setReview(null); setReceipt(null); setBusiness(null); setStepObservations({});
        setMessage(write ? t("本次写入应答未确认。保留原引用，只核对原决定或业务收据，不再次提交。") : t("当前不可读取，请核对权限、原版本或人工业务页。"));
        if ([401, 403].includes((error as { response?: { status?: number } }).response?.status ?? 0)) {
          reportOrderReview(null); active.current.onAccessDenied();
        }
      }
      throw error;
    } finally { if (flight.current === controller) { flight.current = null; if (same()) setBusy(false); } }
  };
  const same = (signal: AbortSignal) => active.current.current() && !signal.aborted && requestedOwner.current === requestedKey;
  const readSteps = () => run(async signal => {
    setReview(null); setReceipt(null); setBusiness(null); setStepObservations({}); setSteps([]);
    const snapshot = await aiTaskCenterApi.snapshot(taskId, signal);
    if (!same(signal)) return;
    if (runId !== undefined && !id(runId)) throw Error('AI_INVALID_INPUT');
    const candidates = taskHumanSteps(snapshot, taskId).filter(step => runId === undefined || step.runId === runId);
    setSteps(candidates);
    setSelected(previous => requestedProposal && candidates.some(step => step.runId === requestedProposal.runId && step.stepId === requestedProposal.stepId)
      ? taskHumanStepKey(requestedProposal) : candidates.some(step => `${step.runId}:${step.stepId}` === previous) ? previous : null);
    const source = reviewedOrder.current;
    // Refreshing the same original step preserves its editor. Removing that
    // step retracts the old proposal locator before another task can use it.
    if (source && !candidates.some(step => step.runId === source.runId && step.stepId === source.stepId)) reportOrderReview(null);
    if (!candidates.length) setMessage(t("本次没有可观察的原业务步骤。没有记录不代表业务未执行。"));
  });
  const readReview = () => run(async signal => {
    setReview(null); setReceipt(null); setBusiness(null);
    const target = steps.find(step => `${step.runId}:${step.stepId}` === selected);
    if (!target) throw Error("AI_INVALID_INPUT");
    const value = await aiTaskCenterApi.review(taskHumanStepQuery(taskId, target), signal);
    if (!same(signal)) return;
    if (value.taskId !== taskId || value.runId !== target.runId || value.stepId !== target.stepId
      || !["order", "settings"].includes(value.kind) || value.businessExecution !== "not_attested"
      || value.review.proposal.payload.taskId !== taskId || value.review.proposal.payload.actions.length !== 1
      || !/^[a-f0-9]{64}$/u.test(value.review.proposal.payloadHash)
      || value.review.proposal.payload.actions[0].toolCode !== (value.kind === "order" ? "rental.order.commit" : "tenant.notifications.commit")
      || !formatTimestamp(value.review.proposal.payload.expiresAt).available) throw Error("AI_RESOURCE_UNAVAILABLE");
    if (requestedProposal) {
      const proposal = value.review.proposal;
      if (requestedProposal.taskId !== taskId || requestedProposal.runId !== value.runId || requestedProposal.stepId !== value.stepId
        || requestedProposal.proposal.contractVersion !== proposal.payload.contractVersion
        || requestedProposal.proposal.proposalId !== proposal.payload.proposalId
        || requestedProposal.proposal.proposalRevision !== proposal.payload.revision
        || requestedProposal.proposal.reviewedPayloadHash !== proposal.payloadHash) throw Error('AI_REVISION_CONFLICT');
    }
    if (value.kind === "order") {
      if (!hasOrderReviewMaterial(value) || typeof value.review.deterministic.currency !== "string" || value.review.deterministic.currency.length > 16
        || !formatTimestamp(value.review.deterministic.quoteExpiresAt).available
        || Object.keys(amountLabels).some(key => !formatAmount(value.review.deterministic.quoteAmounts[key as keyof typeof amountLabels]).available))
        throw Error("AI_RESOURCE_UNAVAILABLE");
    } else {
      const diff = value.review.change.diff;
      if (Object.keys(diff).length !== 2 || ["notifications.enabledEvents", "notifications.editableChannels"].some(field => {
        const change = diff[field as keyof typeof diff];
        return !change || [change.before, change.after].some(list => !Array.isArray(list) || list.length > 64
          || list.some(item => typeof item !== "string" || item.length > 191));
      })) throw Error("AI_RESOURCE_UNAVAILABLE");
    }
    if (value.kind === 'order') {
      const proposal = value.review.proposal;
      if (value.selection && (!validateAiQuoteSelectionHttpValue('AiQuoteSelectionProofRequest', value.selection)
        || value.selection.taskId !== taskId || value.selection.runId !== value.runId)) throw Error('AI_RESOURCE_UNAVAILABLE');
      reportOrderReview({ taskId, runId: value.runId, stepId: value.stepId,
        ...(value.selection ? { selection: value.selection } : {}), original: {
        contractVersion: proposal.payload.contractVersion, proposalId: proposal.payload.proposalId,
        proposalRevision: proposal.payload.revision, reviewedPayloadHash: proposal.payloadHash
      } });
    } else reportOrderReview(null);
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
    if (!review || !hasOrderReviewMaterial(review) || original || continuation) throw Error("AI_RESOURCE_UNAVAILABLE");
    const payload = review.review.proposal.payload;
    const query: AiTaskDecisionQueryDraft = { taskId, runId: review.runId, stepId: review.stepId, proposal: {
      contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: payload.proposalId, proposalRevision: payload.revision,
      reviewedPayloadHash: review.review.proposal.payloadHash, decision,
      ...(review.kind === 'order' ? { reviewVersion: AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION } : {})
    } };
    // Failure to retain the original reference stops before any network write.
    sessionStorage.setItem(storageKey, JSON.stringify(query)); setOriginal(query);
    const result = await aiTaskCenterApi.decision(query, signal);
    observe(result, query, signal);
    if (result.receipt.kind !== "recorded") throw Error("AI_RESULT_UNKNOWN");
  }, true);
  const expires = review ? Math.min(Date.parse(review.review.proposal.payload.expiresAt),
    review.kind === "order" ? Date.parse(review.review.deterministic.quoteExpiresAt) : Infinity) : NaN;
  const canDecide = !!review && hasOrderReviewMaterial(review) && review.review.proposal.status === "pending_confirmation" && Number.isFinite(expires) && expires > Date.now() && !original && !continuation && !busy;
  const rejectionContinuation = review?.review.proposal.status === "cancelled";
  const canContinue = !!review && hasOrderReviewMaterial(review) && (review.review.proposal.status === "confirmed" || rejectionContinuation) && Number.isFinite(expires) && expires > Date.now() && !original && !continuation && !busy;
  const continueOriginal = () => run(async signal => {
    if (!review || !canContinue) throw Error("AI_RESOURCE_UNAVAILABLE");
    const p = review.review.proposal;
    const command: AiTaskHumanContinueDraft = { taskId, runId: review.runId, stepId: review.stepId,
      checkpointRef: review.checkpointRef, expectedTaskRevision: review.taskRevision, proposal: {
        contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: p.payload.proposalId,
        proposalRevision: p.payload.revision, reviewedPayloadHash: p.payloadHash
      } };
    sessionStorage.setItem(continueKey, JSON.stringify(command)); setContinuation(command);
    const result = await aiTaskCenterApi.continue(command, signal);
    if (!same(signal)) return;
    if (result.taskId !== taskId || result.runId !== command.runId || result.stepId !== command.stepId
      || result.businessExecution !== "read_original_receipt" || result.automaticRetry !== false) throw Error("AI_RESULT_UNKNOWN");
    setReview(null); setReceipt(null);
    if (result.kind === "not_started") {
      sessionStorage.removeItem(continueKey); setContinuation(null);
      setMessage(t("原宿主明确未启动本次继续。重新读取当前提案后再决定，不能推断其他执行者未提交。"));
    } else if (result.kind === "run_outcome" && ["succeeded", "partially_succeeded", "paused", "cancel_requested", "cancelled", "unavailable", "failed"].includes(result.status)) {
      setMessage(t(rejectionContinuation
        ? "原拒绝已交运行器收尾。请核对原任务及业务收据，拒绝不代表已发生业务已回滚。"
        : "原运行器应答已返回。请读取原业务结果，不能仅凭运行状态认定订单或设置已提交。"));
    } else throw Error("AI_RESULT_UNKNOWN");
  }, true);
  return <section aria-label={t("原提案人工审阅")} aria-busy={busy}>
    <p className="muted">{t("批准与继续执行分开确认。")}</p>
    {requestedProposal && <p>{t('已定位原提案。读取原业务步骤并审阅后，再明确决定。')}</p>}
    <div className="panel-toolbar">
      <ActionButton label={t("读取原业务步骤")} disabled={busy || !!original || !!continuation} onAction={readSteps} />
      {!!steps.length && <><label id={labelId}>{t("原业务步骤")}</label><Select aria-labelledby={labelId} value={selected}
        disabled={busy || !!original || !!continuation} options={steps.map(step => ({ value: `${step.runId}:${step.stepId}`, label: safeDisplayText(step.stepId, 36) }))}
        onChange={(value: unknown) => {
          const next = typeof value === 'string' ? value : null;
          const source = reviewedOrder.current;
          if (source && next !== `${source.runId}:${source.stepId}`) reportOrderReview(null);
          setSelected(next); setReview(null); setReceipt(null); setBusiness(null);
        }} />
        <ActionButton label={t("审阅当前等待提案")} disabled={!selected || busy || !!original || !!continuation} onAction={readReview} /></>}
      <ActionButton label={t("读取原业务结果")} disabled={busy || !selected && (!original || original === "invalid") && (!continuation || continuation === "invalid")}
        onAction={() => run(async signal => {
          setBusiness(null);
          const target = steps.find(step => `${step.runId}:${step.stepId}` === selected)
            ?? (original && original !== "invalid" ? { taskId, runId: original.runId, stepId: original.stepId }
              : continuation && continuation !== "invalid" ? { taskId, runId: continuation.runId, stepId: continuation.stepId } : null);
          if (!target) throw Error("AI_RESOURCE_UNAVAILABLE");
          const query = taskHumanStepQuery(taskId, target);
          const result = await aiTaskCenterApi.business(query, signal);
          if (!same(signal)) return;
          if (!originalBusinessObservation(result, query)) throw Error("AI_RESOURCE_UNAVAILABLE");
          setBusiness(result);
          // Preserve each independently authorized original observation while
          // selecting its successor. Refresh/access failure clears the group;
          // neither step success nor absence is promoted to a business fact.
          setStepObservations(previous => ({ ...previous, [taskHumanStepKey(query)]: structuredClone(result) }));
          if (result.status === "committed") { sessionStorage.removeItem(continueKey); setContinuation(null); }
        })} />
    </div>
    <TaskActionResults steps={steps} observations={stepObservations} />
    {message && <Alert type="warning" title={message} />}
    {original === "invalid" && <Alert type="warning" title={t("原决定引用不可读取。请通过原业务页核对，不再提交新决定。")}/>}
    {continuation && <Alert type="warning" title={t(continuation === "invalid" ? "原继续引用不可读取，请通过原业务页核对。"
      : "原继续尚待业务收据核对。不得再次继续、换任务重做或推断业务未执行。")}/>}
    {original && original !== "invalid" && <ActionButton label={t("核对原决定收据")} disabled={busy} onAction={() => run(async signal => {
      setReceipt(null); observe(await aiTaskCenterApi.decisionReceipt(structuredClone(original), signal), original, signal);
    })} />}
    {review && <><VisibleObservationBoundary kind="card" ready={hasOrderReviewMaterial(review) && active.current.current() && Number.isFinite(expires) && expires > Date.now()}
      reference={{ taskId, runId: review.runId, source: { kind: 'approval_card', stepId: review.stepId,
        proposalId: review.review.proposal.payload.proposalId, proposalRevision: review.review.proposal.payload.revision } }}>
      <TaskHumanReviewDetails value={review} /></VisibleObservationBoundary><div className="panel-toolbar">
      <ConfirmAction key={`approve:${review.review.proposal.payloadHash}`} label={t("批准这份提案")}
        prompt={t("已核对原对象、金额或差异、版本及有效期？仅记录批准，不执行业务。")}
        doneLabel={t("决定已记录，业务未执行")} disabled={!canDecide} onConfirm={() => decide("approve")} />
      <ConfirmAction key={`reject:${review.review.proposal.payloadHash}`} label={t("拒绝这份提案")}
        prompt={t("确认拒绝这份原提案？不会取消已发生的业务操作。")}
        doneLabel={t("决定已记录")} disabled={!canDecide} onConfirm={() => decide("reject")} />
      <ConfirmAction key={`continue:${review.checkpointRef}:${review.taskRevision}`} label={t(rejectionContinuation ? "交原运行器处理拒绝" : "核对原批准并继续")}
        prompt={t(rejectionContinuation
          ? "确认交原运行器处理这份已记录的拒绝？这不会批准提案或回滚已发生业务，完成后仍须核对原任务和业务收据。"
          : "确认交由原运行器执行这份已批准提案？服务器将再次核对权限、原计划、资源和Core条件，执行后需读取原业务收据。")}
        doneLabel={t("运行应答已返回，请核对业务收据")} disabled={!canContinue} onConfirm={continueOriginal} />
    </div></>}
    {receipt && <p role="status" aria-live="polite">{t(receipt.receipt.kind === "recorded"
      ? receipt.receipt.record.decision === "approved" ? "原批准已记录，不代表业务已执行。" : "原拒绝已记录，不代表业务已回滚。"
      : "原决定尚未确认，保留原引用，不自动重试或推断未提交。")}</p>}
    {business && <div role="status" aria-live="polite" style={{ overflowWrap: "anywhere" }}>
      <p>{t("业务观察时间")}: {formatTimestamp(business.observedAt).value}</p>
      {business.status === "committed" ? business.kind === "order"
        ? <p>{t("原Core订单已确认提交")}: {safeDisplayText(business.order.id, 191)} · {t("当前状态")}: {safeDisplayText(business.order.status, 128)}</p>
        : <p>{t("原设置修改已确认提交")}: {t("结果修订")} {business.receipt.resultRevision} · {formatTimestamp(business.receipt.committedAt).value}</p>
        : <p>{t(business.status === "unknown" ? "原业务结果待核对，不能自动重试。" : "尚未观察到原业务收据，不证明未提交。")}</p>}
      <p>{t("订单创建不等于付款或履约完成；设置历史收据不等于之后没有其他修改。")}</p>
    </div>}
  </section>;
}
