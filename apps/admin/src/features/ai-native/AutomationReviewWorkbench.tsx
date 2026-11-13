/** Human automation review surface. Original reviews provide all task status;
 * parent-owned registered entries provide explanation/business navigation.
 * Mount, reads and reopening never create a task, execute or claim resolution. */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AiAutomationReviewCloseReasonDraft, AiAutomationReviewFeedbackCodeDraft,
  AiAutomationReviewQueueFiltersDraft, AiAutomationReviewGrantQueryDraft,
  AiAutomationReviewGrantPreparationDraft, AiAutomationReviewGrantReceiptDraft, AiBusinessEventDraft } from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { ActionButton, Alert, ConfirmAction, Input, ListFilterBar, ListFilterItem, Select } from '@/components/ui';
import { aiAutomationReviewsApi } from '@/api/aiAutomationReviews';
import { automationReviewStore, automationReviewGrantStorageName, createAutomationReviewSession,
  automationReviewBatchStorageName,
  type AutomationReviewOriginalEntry, type AutomationReviewScope } from './automation-review-session';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import styles from './AiManagement.module.css';

const english: Record<string, string> = {
  '异常人工复核': 'Human exception review', '原事件': 'Original event', '原事件标识': 'Original event ID',
  '待处理事件': 'Pending events', '领取待处理事件': 'Prepare pending events',
  '领取当前空间最多10项待处理事件并准备候选？选中后再办理。': 'Prepare candidates for up to 10 pending events in this workspace? Select an event before proceeding.',
  '每次最多10项，候选不会自动创建待办或执行业务。': 'Each request covers up to 10 events. Candidates do not automatically create reviews or execute business actions.',
  '候选来自原事件，选中后核对当前情况。': 'Candidates come from original events. Check the current situation after selecting one.',
  '尚未领取当前空间的待处理事件。': 'Pending events in this workspace have not been prepared.',
  '本次领取窗口没有返回候选，不代表没有其他事件。': 'This preparation window returned no candidates. Other events may still exist.',
  '选择原事件': 'Select original event', '核对原事件': 'Read original event', '读取已知候选': 'Read known candidates',
  '核对原领取': 'Read original batch', '领取未确认': 'Preparation unconfirmed',
  '可选择': 'Ready for selection', '待领取': 'Pending preparation', '领取中': 'Being prepared',
  '等待原重试': 'Original retry scheduled', '需人工处理': 'Manual review required', '已失效': 'Expired', '待核对': 'Awaiting read',
  '该批领取已发起但结果未确认，继续核对已知原事件；暂不能再次领取。': 'This preparation was dispatched and its outcome is unconfirmed. Read known original events; another batch cannot be prepared yet.',
  '批次定位不可读取，新的领取和写入已停止。': 'The batch reference cannot be read. New preparation and writes are blocked.',
  '读取原事件': 'Read original event', '读取待办': 'Read reviews', '待办列表': 'Review queue',
  '待办状态': 'Review status', '异常类型': 'Exception type', '全部类型': 'All types',
  '待复核': 'Open', '已关闭': 'Closed', '读取下一组': 'Read next window',
  '本次读取窗口没有待办。': 'This read window contains no reviews.',
  '尚未读取当前空间的待办。': 'Reviews for the current workspace have not been read.',
  '核对原待办': 'Read original review', '原来源与风险': 'Original source and risk',
  '交付资源不足': 'Delivery resource shortage', '归还异常': 'Return exception',
  '通知明确失败': 'Notification failure', '退款明确失败': 'Refund failure', '开业缺项': 'Opening configuration missing',
  '影子模式': 'Shadow mode', '人工确认模式': 'Human confirmation mode',
  '原交付来源报告资源不足。调整与替代安排须在原业务流程核实。': 'The original delivery source reports a resource shortage. Verify adjustments and alternatives through the original workflow.',
  '原归还检查报告待处理异常。材料和处理结论须在原检查流程核实。': 'The original return inspection reports a pending exception. Verify evidence and outcomes through the original inspection workflow.',
  '原通知操作报告失败。本工作台不再次发送，投递结果以原渠道收据为准。': 'The original notification operation reports failure. This workbench does not resend it; delivery is determined by the original channel receipt.',
  '原退款操作报告失败。请核对原资金流程，本工作台不会重新退款。': 'The original refund operation reports failure. Check the original financial workflow; this workbench does not retry refunds.',
  '原开业检查报告分区缺项。草稿、保存和发布仍沿原权限与审核流程。': 'The original opening check reports a missing configuration section. Drafting, saving and publication retain their original permissions and approvals.',
  '本次原来源未报告该异常；是否已处理仍须在原业务流程核实。': 'This source read does not report the exception. Verify whether it was addressed through the original business workflow.',
  '当前来源不可读取；保留原待办记录，不表示异常已解决。': 'The current source cannot be read. The original review remains available; this does not establish resolution.',
  '不可读取': 'Unavailable',
  '原建议当前不可继续，请核对同一原来源。': 'The original suggestion is no longer current. Check the same original source.',
  '原事件版本': 'Original event revision', '当前来源版本': 'Current source revision',
  '原交付时间': 'Original delivery time', '开业分区': 'Opening section',
  '原办理与解释入口': 'Original business and explanation entries',
  '打开原模型解释': 'Open original model explanation', '打开原办理入口': 'Open original business workflow',
  '原模型解释入口尚未接入。': 'The original model explanation entry is not connected.',
  '原办理入口尚未接入。': 'The original business workflow entry is not connected.',
  '解释与业务操作在原入口独立确认，本工作台不以打开入口判定完成。': 'Confirm explanation and business actions within their original entries. Opening an entry does not establish completion.',
  '原入口已响应；业务结果尚未复查。': 'The original entry responded. Its business outcome has not been rechecked.',
  '复查同一原来源': 'Recheck the same original source', '明确复查原来源': 'Recheck original source',
  '尚未进行明确复查。': 'An explicit recheck has not been performed.',
  '本次原来源仍报告异常。': 'The original source still reports the exception.',
  '本次原来源未报告异常。': 'The original source does not report the exception in this read.',
  '复查不等于模型判断或待办关闭，实际处理以原业务记录为准。': 'A source recheck is separate from model judgement or closing a review. Original business records determine the outcome.',
  '本次读取时间': 'Time of this read', '待办处理记录': 'Human review record',
  '原入口已打开': 'Original entry opened',
  '为原事件准备待办': 'Prepare review for original event',
  '为此原事件准备待办元数据？不调用模型、不发送通知或处理退款。': 'Prepare review metadata for this original event? This starts no model, notification or refund.',
  '原任务仅显示最少状态，模型和业务结果须在原入口核对。': 'Only minimal task status is shown. Check model and business outcomes through their original entries.',
  '原任务状态': 'Original task status', '未观察到任务': 'Task not observed', '原待办': 'Original review',
  '选择原待办': 'Select original review', '读取更多原待办': 'Read more original reviews',
  '关闭理由': 'Closure reason', '选择关闭理由': 'Choose a closure reason',
  '人工标记已处理': 'Marked addressed by a person', '人工撤销待办': 'Dismissed by a person',
  '重复待办': 'Duplicate review', '不适用': 'Not applicable',
  '关闭此待办': 'Close this review',
  '关闭此原待办并记录所选理由？不表示原资源异常已解决。': 'Close this original review with the selected reason? This does not establish that the resource exception is resolved.',
  '待办已关闭；原资源结果仍须独立复查。': 'The review is closed. Recheck the resource outcome independently.',
  '反馈': 'Feedback', '选择反馈': 'Choose feedback', '有帮助': 'Helpful', '无帮助': 'Not helpful', '不正确': 'Incorrect',
  '记录反馈': 'Record feedback', '记录此原待办的反馈？不修改业务事实。': 'Record feedback for this original review? Business facts are unchanged.',
  '核对原操作': 'Read original operation', '原记录已观察到，不代表业务已完成。': 'The original record was observed. This does not establish business completion.',
  '原操作收据': 'Original operation receipt', '记录动作': 'Recorded action', '记录时间': 'Recorded at',
  '未观察到原操作，不证明未提交；继续按原键核对。': 'The original operation is not observed. This does not prove non-commit; keep checking its original key.',
  '原写入结果尚未确认，只核对原事件和原操作，不重复提交。': 'The original write is unconfirmed. Read its original event and operation without resubmitting.',
  '原定位不可读取，新写入已停止。': 'The original reference cannot be read. New writes are blocked.',
  '当前操作不可用，请核对权限、原操作授权与材料。': 'This operation is unavailable. Check current permissions, original action authorization and material.',
  '原版本已变化，请重新读取并核对。': 'The original revision changed. Read and review it again.',
  '原入口当前不可用。': 'The original entry is currently unavailable.',
  '读取未能完成，请核对当前访问权限与原来源。': 'Reading did not complete. Check current access and the original source.',
  '原定位': 'Original references', '待办标识': 'Review ID', '政策修订': 'Policy revision',
  '处理授权': 'Review authorization', '授权动作': 'Authorized action', '选择授权动作': 'Choose an action',
  '准备处理授权': 'Prepare authorization', '读取原处理授权': 'Read original authorization',
  '确认启用当前授权': 'Enable this authorization', '原待办修订': 'Original review revision',
  '授权政策': 'Authorization policy', '所需权限': 'Required permissions', '授权失效时间': 'Authorization expires at',
  '仅用于关闭此待办或记录反馈，业务办理沿原流程。': 'This authorizes only closing this review or recording feedback. Business handling remains in its original workflow.',
  '按上述固定动作、修订、政策和期限启用处理授权？不授予模型或业务执行权限。': 'Enable authorization for the fixed action, revision, policy and expiry shown above? This grants no model or business execution permission.',
  '原授权收据已读取': 'Original authorization receipt read',
  '本次核对允许所选待办操作。': 'This check permits the selected review operation.',
  '当前授权不可用于新写，请明确准备或核对。': 'This authorization cannot permit a new write. Explicitly prepare or check it.',
  '未观察到原授权收据，不证明未启用；继续按原引用核对。': 'The original authorization receipt is not observed. This does not prove it was not enabled; keep checking its original reference.',
  '原授权启用结果尚未确认，只能核对原授权，不重复启用。': 'The original enable result is unconfirmed. Check its original authorization without enabling again.',
  '原授权定位不可读取，新写入已停止。': 'The original authorization reference cannot be read. New writes are blocked.',
  '核对原授权': 'Check original authorization', '处理授权已变化或不可用，请重新读取并核对。': 'Review authorization changed or is unavailable. Read and check it again.',
  '已读取': 'Read', '已记录': 'Recorded', '已关闭待办': 'Review closed',
  '工作空间待办为有界读取，下一组仅继续原读取位置。': 'Workspace reviews are read in bounded windows. The next window continues the original read position.',
  '排队': 'Queued', '运行中': 'Running', '等待补充': 'Waiting for input', '等待确认': 'Waiting for confirmation',
  '等待外部结果': 'Waiting for external result', '任务完成': 'Task succeeded', '任务失败': 'Task failed',
  '任务取消': 'Task cancelled', '部分完成': 'Partially complete',
  '经营空间资料': 'Workspace profile', '账号与角色': 'Accounts and roles', '履约网络': 'Fulfillment network',
  '营业规则': 'Business rules', '营业日历': 'Business calendar', '商品分组': 'Item groups',
  '定价分组与费率': 'Rate groups and rates', '价格版本': 'Price version', '会员基础': 'Membership setup',
};
const eventNames: Record<AiBusinessEventDraft['type'], string> = {
  'fulfillment.resource_shortage': '交付资源不足', 'inspection.return_exception': '归还异常',
  'notification.failed': '通知明确失败', 'refund.failed': '退款明确失败', 'opening.missing_configuration': '开业缺项',
};
const riskCopy: Record<AiBusinessEventDraft['type'], string> = {
  'fulfillment.resource_shortage': '原交付来源报告资源不足。调整与替代安排须在原业务流程核实。',
  'inspection.return_exception': '原归还检查报告待处理异常。材料和处理结论须在原检查流程核实。',
  'notification.failed': '原通知操作报告失败。本工作台不再次发送，投递结果以原渠道收据为准。',
  'refund.failed': '原退款操作报告失败。请核对原资金流程，本工作台不会重新退款。',
  'opening.missing_configuration': '原开业检查报告分区缺项。草稿、保存和发布仍沿原权限与审核流程。',
};
const closeNames: Record<AiAutomationReviewCloseReasonDraft, string> = {
  resolved: '人工标记已处理', dismissed: '人工撤销待办', duplicate: '重复待办', not_applicable: '不适用',
};
const feedbackNames: Record<AiAutomationReviewFeedbackCodeDraft, string> = {
  helpful: '有帮助', not_helpful: '无帮助', incorrect: '不正确', not_applicable: '不适用',
};
const candidateStatusNames: Record<string, string> = { ready: '可选择', pending: '待领取', claimed: '领取中',
  retry_scheduled: '等待原重试', dead_letter: '需人工处理', closed: '已关闭', expired: '已失效' };
const taskNames: Record<string, string> = { queued: '排队', running: '运行中', waiting_input: '等待补充',
  waiting_confirmation: '等待确认', waiting_external: '等待外部结果', succeeded: '任务完成',
  failed: '任务失败', cancelled: '任务取消', partially_completed: '部分完成' };
const sectionNames: Record<string, string> = { workspace_profile: '经营空间资料', accounts_roles: '账号与角色',
  fulfillment_network: '履约网络', business_rule: '营业规则', business_calendar: '营业日历', item_groups: '商品分组',
  pricing_groups_rates: '定价分组与费率', price_version: '价格版本', membership_base: '会员基础' };

function ReviewGrantFacts({ material, t }: {
  material: AiAutomationReviewGrantPreparationDraft | AiAutomationReviewGrantReceiptDraft; t(text: string): string;
}) {
  return <dl className={styles.facts}>
    <div><dt>{t('授权动作')}</dt><dd>{t(material.key.action === 'close' ? '关闭此待办' : '记录反馈')}</dd></div>
    <div><dt>{t('原待办修订')}</dt><dd>{material.key.expectedRevision}</dd></div>
    <div><dt>{t('授权政策')}</dt><dd>{material.policy.policyId} · {material.policy.revision}</dd></div>
    <div><dt>{t('所需权限')}</dt><dd>{material.requiredPermissions.join(', ')}</dd></div>
    <div><dt>{t('授权失效时间')}</dt><dd><time dateTime={material.expiresAt}>{material.expiresAt}</time></dd></div>
  </dl>;
}

export interface AutomationReviewWorkbenchProps {
  identity: string; current(): boolean; eventId?: string;
  onExplainOriginal?: AutomationReviewOriginalEntry; onOpenOriginal?: AutomationReviewOriginalEntry;
  onAccessDenied?(): void;
}

export function AutomationReviewWorkbench(props: AutomationReviewWorkbenchProps) {
  const auth = useAuthStore(), locale = useAiManagementLocale();
  const t = (text: string) => locale.locale === 'en-US' && english[text] ? english[text] : locale.t(text);
  const [, refresh] = useState(0), eventField = useId(), statusField = useId(), typeField = useId();
  const closeField = useId(), feedbackField = useId(), inputField = useId();
  const grantField = useId();
  const [eventDraft, setEventDraft] = useState(props.eventId ?? '');
  const [filters, setFilters] = useState<AiAutomationReviewQueueFiltersDraft>({ reviewStatus: 'open' });
  const [reason, setReason] = useState<AiAutomationReviewCloseReasonDraft | undefined>();
  const [feedback, setFeedback] = useState<AiAutomationReviewFeedbackCodeDraft | undefined>();
  const [grantAction, setGrantAction] = useState<AiAutomationReviewGrantQueryDraft['action'] | undefined>();
  const epoch = currentSessionEpoch();
  const scope: AutomationReviewScope = { tenantId: auth.tenant?.tenantId ?? '', workspaceId: auth.currentWorkspaceId ?? '',
    actorId: auth.user?.id ?? '', audience: 'operator' };
  const binding = JSON.stringify([props.identity, scope, auth.user, epoch]);
  const owner = useRef({ binding, props }); owner.current = { binding, props };
  const storageName = `rental-os-automation-review:${JSON.stringify(scope)}`;
  const grantStorageName = automationReviewGrantStorageName(storageName);
  const batchStorageName = automationReviewBatchStorageName(storageName);
  const controller = useMemo(() => {
    if (!scope.tenantId || !scope.workspaceId || !scope.actorId || !auth.sessionVerified || !auth.token) return null;
    const current = () => {
      const now = useAuthStore.getState();
      return owner.current.binding === binding && currentSessionEpoch() === epoch && !currentSessionSignal().aborted
        && now.sessionVerified && !!now.token && typeof document !== 'undefined' && !document.hidden
        && typeof navigator !== 'undefined' && navigator.onLine && owner.current.props.current();
    };
    let storage: Storage | undefined; try { storage = window.localStorage; } catch { /* Read-only use remains available. */ }
    const entry = (kind: 'explanation' | 'business'): AutomationReviewOriginalEntry => async (target, signal) => {
      const callback = kind === 'explanation' ? owner.current.props.onExplainOriginal : owner.current.props.onOpenOriginal;
      if (!callback || !current()) return { state: 'unavailable' };
      const result = await callback(target, signal);
      if (!current() || callback !== (kind === 'explanation' ? owner.current.props.onExplainOriginal : owner.current.props.onOpenOriginal)) {
        return { state: 'unavailable' };
      }
      return result;
    };
    const create = () => createAutomationReviewSession({ scope, current, api: aiAutomationReviewsApi,
      store: automationReviewStore(storageName, storage), changed: () => refresh(value => value + 1),
      eventId: owner.current.props.eventId, explainOriginal: entry('explanation'), openOriginal: entry('business') });
    let session = create(), disposed = false;
    return { get session() { return session; }, activate() { if (disposed) { session = create(); disposed = false; } },
      dispose() { session.dispose(); disposed = true; } };
  }, [binding, auth.sessionVerified, Boolean(auth.token), storageName]);
  useEffect(() => {
    if (!controller) return;
    controller.activate(); setEventDraft(props.eventId ?? ''); setReason(undefined); setFeedback(undefined); setGrantAction(undefined);
    refresh(value => value + 1);
    const hidden = () => {
      if (document.hidden || !navigator.onLine || currentSessionSignal().aborted) controller.dispose();
      else controller.activate();
      setReason(undefined); setFeedback(undefined); setGrantAction(undefined); refresh(value => value + 1);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key === storageName || event.key === grantStorageName || event.key === batchStorageName) {
        controller.dispose(); controller.activate(); refresh(value => value + 1);
      }
    };
    const signal = currentSessionSignal(); signal.addEventListener('abort', hidden, { once: true });
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('offline', hidden); window.addEventListener('online', hidden); window.addEventListener('storage', storage);
    return () => {
      signal.removeEventListener('abort', hidden); document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('offline', hidden); window.removeEventListener('online', hidden); window.removeEventListener('storage', storage);
      controller.dispose();
    };
  }, [controller]);
  const session = controller?.session, data = session?.view;
  useEffect(() => { setReason(undefined); setFeedback(undefined); setGrantAction(undefined); },
    [data?.eventId, data?.inputRef, data?.review?.resourceHash, data?.review?.review.revision]);
  useEffect(() => {
    const selected = data?.grantPreparation?.key.action ?? data?.grantObservation?.key.action;
    if (selected) setGrantAction(selected);
  }, [data?.grantPreparation?.preparedRef, data?.grantPreparation?.key.action,
    data?.grantObservation?.preparedRef, data?.grantObservation?.key.action]);
  if (!session?.isCurrent() || !data) return null;
  const busy = !!data.busy, pending = !!data.pending, grantPending = !!data.pendingGrant;
  const batchPending = data.batch?.status === 'dispatched';
  const disabled = busy || pending || grantPending || batchPending || data.locatorDamaged || data.grantLocatorDamaged || data.batchLocatorDamaged;
  const event = data.event, review = data.review;
  const grantMaterial = data.grantPreparation ?? (data.grantObservation?.state === 'observed' ? data.grantObservation.receipt : null);
  const grantRef = data.grantObservation?.state === 'observed' ? data.grantObservation.receipt?.preparedRef : undefined;
  const action = (work: () => Promise<unknown>) => async () => {
    try { return await work(); } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if ((status === 401 || status === 403) && session.isCurrent()) owner.current.props.onAccessDenied?.();
      throw error;
    }
  };
  const canCreate = !disabled && !!event && event.inputs.state === 'not_observed' && !event.inputs.hasMore
    && event.nextAction === 'human_business_review' && !!data.candidate && ['pending', 'ready'].includes(data.candidate.status);
  const currentQueue = data.queue && JSON.stringify(data.queueFilters) === JSON.stringify(filters) ? data.queue : null;
  const errorText = data.error === 'AI_CAPABILITY_UNAVAILABLE' ? '原入口当前不可用。'
    : ['AI_REVIEW_GRANT_INACTIVE', 'AI_RECONFIRM_GRANT'].includes(data.error ?? '') ? '处理授权已变化或不可用，请重新读取并核对。'
    : data.error === 'AI_REVISION_CONFLICT' ? '原版本已变化，请重新读取并核对。'
    : ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(data.error ?? '') ? '当前操作不可用，请核对权限、原操作授权与材料。'
    : batchPending ? '该批领取已发起但结果未确认，继续核对已知原事件；暂不能再次领取。'
    : grantPending ? '原授权启用结果尚未确认，只能核对原授权，不重复启用。'
    : pending ? '原写入结果尚未确认，只核对原事件和原操作，不重复提交。' : '读取未能完成，请核对当前访问权限与原来源。';

  return <section className={styles.stack} aria-label={t('异常人工复核')} aria-busy={busy}>
    {data.locatorDamaged && <Alert type="warning" title={t('原定位不可读取，新写入已停止。')} />}
    {data.grantLocatorDamaged && <Alert type="warning" title={t('原授权定位不可读取，新写入已停止。')} />}
    {data.batchLocatorDamaged && <Alert type="warning" title={t('批次定位不可读取，新的领取和写入已停止。')} />}
    {batchPending && <Alert type="warning" title={t('该批领取已发起但结果未确认，继续核对已知原事件；暂不能再次领取。')} />}
    {data.batch?.operationKey && <ActionButton intent="review" label={t('核对原领取')} successLabel={t('已读取')}
      disabled={busy || data.batchLocatorDamaged} onAction={action(() => session.readPendingCandidates())} />}
    {pending && <Alert type="warning" title={t('原写入结果尚未确认，只核对原事件和原操作，不重复提交。')} />}
    {grantPending && <Alert type="warning" title={t('原授权启用结果尚未确认，只能核对原授权，不重复启用。')} />}
    {!!data.error && <Alert type="error" title={t(errorText)} />}
    {(pending || data.lastOperation) && <ActionButton intent="review" label={t('核对原操作')} successLabel={t('已读取')}
      disabled={busy || data.locatorDamaged} onAction={action(() => session.recover())} />}
    {data.operation && <section className={styles.section} aria-label={t('原操作收据')}>
      <h3>{t('原操作收据')}</h3>
      <Alert type={data.operation.state === 'observed' ? 'info' : 'warning'}
        title={t(data.operation.state === 'observed' ? '原记录已观察到，不代表业务已完成。' : '未观察到原操作，不证明未提交；继续按原键核对。')} />
      {data.operation.state === 'observed' && <dl className={styles.facts}>
        <div><dt>{t('原事件标识')}</dt><dd>{data.operation.eventId}</dd></div>
        <div><dt>{t('待办标识')}</dt><dd>{data.operation.inputRef}</dd></div>
        <div><dt>{t('记录动作')}</dt><dd>{t(data.operation.action === 'close' ? '关闭此待办' : '记录反馈')}</dd></div>
        <div><dt>{t('记录时间')}</dt><dd>{formatTimestamp(data.operation.recordedAt).value}</dd></div>
      </dl>}
    </section>}
    {grantPending && <ActionButton intent="review" label={t('核对原授权')} successLabel={t('原授权收据已读取')}
      disabled={busy || data.grantLocatorDamaged} onAction={action(() => session.recoverGrant())} />}
    <section className={styles.section} aria-label={t('待处理事件')}>
      <h3>{t('待处理事件')}</h3>
      <ConfirmAction label={t('领取待处理事件')} prompt={t('领取当前空间最多10项待处理事件并准备候选？选中后再办理。')}
        doneLabel={t('已读取')} disabled={disabled || !session.canPreparePending()} onConfirm={action(() => session.preparePending(10))} />
      <p className={styles.help}>{t('每次最多10项，候选不会自动创建待办或执行业务。')}</p>
      <p className={styles.help}>{t('候选来自原事件，选中后核对当前情况。')}</p>
      {data.batch && (data.batch.status === 'observed' || data.batch.eventIds.length > 0) ? <>
        {data.batch.status === 'observed' && !data.batch.eventIds.length && <p className={styles.help}>{t('本次领取窗口没有返回候选，不代表没有其他事件。')}</p>}
        <ul className={styles.taskList}>{data.batch.eventIds.map(eventId => {
          const candidate = data.candidateBatch?.items.find(item => item.eventId === eventId);
          const unconfirmed = data.batchObservation?.state === 'observed'
            && data.batchObservation.events.find(item => item.eventId === eventId)?.preparationState === 'unconfirmed';
          return <li key={eventId}>
            <div className={styles.taskIdentity}><span>{t(candidate?.material ? eventNames[candidate.material.event.type] : '原事件')}</span>
              <span className={styles.help} title={eventId}>{eventId}</span></div>
            <span className={styles.status}>{t(unconfirmed ? '领取未确认' : candidate ? candidateStatusNames[candidate.status] : '待核对')}</span>
            <ActionButton intent="review" label={t(candidate?.status === 'ready' && !unconfirmed ? '选择原事件' : '核对原事件')} successLabel={t('已读取')}
              disabled={busy} onAction={action(() => session.selectPendingCandidate(eventId))} />
          </li>;
        })}</ul>
      </> : !batchPending && <p className={styles.help}>{t('尚未领取当前空间的待处理事件。')}</p>}
    </section>
    <section className={styles.section} aria-label={t('待办列表')}>
      <h3>{t('待办列表')}</h3>
      <ListFilterBar>
        <ListFilterItem label={t('待办状态')} active={filters.reviewStatus === 'closed'}>
        <Select id={statusField} aria-label={t('待办状态')} value={filters.reviewStatus ?? 'open'} disabled={busy}
          options={[{ value: 'open', label: t('待复核') }, { value: 'closed', label: t('已关闭') }]}
          onChange={value => setFilters(previous => ({ ...previous, reviewStatus: value ?? 'open' }))} />
        </ListFilterItem>
        <ListFilterItem label={t('异常类型')} active={!!filters.eventType}>
        <Select id={typeField} aria-label={t('异常类型')} value={filters.eventType} disabled={busy} allowClear placeholder={t('全部类型')}
          options={Object.entries(eventNames).map(([value, label]) => ({ value, label: t(label) }))}
          onChange={value => setFilters(previous => ({ reviewStatus: previous.reviewStatus, ...(value ? { eventType: value } : {}) }))} />
        </ListFilterItem>
        <ListFilterItem kind="action" label={t('读取待办')}>
        <ActionButton intent="refresh" label={t('读取待办')} successLabel={t('已读取')} disabled={busy}
          onAction={action(() => session.queue(filters))} />
        </ListFilterItem>
      </ListFilterBar>
      {currentQueue ? <>
        {!currentQueue.items.length && <p className={styles.help}>{t('本次读取窗口没有待办。')}</p>}
        <ul className={styles.taskList}>{currentQueue.items.map(item => <li key={item.inputRef}>
          <div className={styles.taskIdentity}><span>{t(eventNames[item.event.type])}</span>
            <span className={styles.help}>{t(item.mode === 'shadow' ? '影子模式' : '人工确认模式')}</span></div>
          <span className={styles.status}>{t(item.review.status === 'closed' ? '已关闭' : '待复核')}</span>
          <ActionButton intent="review" label={t('核对原待办')} successLabel={t('已读取')} disabled={busy}
            onAction={action(() => session.select(item.event.eventId, item.inputRef))} />
        </li>)}</ul>
        <p className={styles.help}>{t('工作空间待办为有界读取，下一组仅继续原读取位置。')}</p>
        {currentQueue.nextAfter && <ActionButton intent="next" label={t('读取下一组')} successLabel={t('已读取')} disabled={busy}
          onAction={action(() => session.queue(filters, currentQueue.nextAfter!))} />}
      </> : <p className={styles.help}>{t('尚未读取当前空间的待办。')}</p>}
    </section>
    <div className={styles.requestRow}>
      <div className={styles.field}><label htmlFor={eventField}>{t('原事件标识')}</label>
        <Input id={eventField} value={eventDraft} maxLength={36} disabled={busy} onChange={change => setEventDraft(change.target.value)} /></div>
      <ActionButton intent="review" label={t('读取原事件')} successLabel={t('已读取')} disabled={busy || !eventDraft.trim()}
        onAction={action(() => session.select(eventDraft.trim()))} />
    </div>
    {event && <>
      <section className={styles.section} aria-label={t('原来源与风险')}>
        <h3>{t('原来源与风险')}</h3><p>{t(eventNames[event.event.type])}</p>
        <p>{t(event.currentSource.failed === null ? '当前来源不可读取；保留原待办记录，不表示异常已解决。'
          : event.currentSource.failed ? riskCopy[event.event.type] : '本次原来源未报告该异常；是否已处理仍须在原业务流程核实。')}</p>
        {event.nextAction === 'read_original_resource' && <Alert type="warning" title={t('原建议当前不可继续，请核对同一原来源。')} />}
        <dl className={styles.facts}>
          <div><dt>{t('原事件版本')}</dt><dd>{event.event.resourceRevision}</dd></div>
          <div><dt>{t('当前来源版本')}</dt><dd>{event.currentSource.revision ?? t('不可读取')}</dd></div>
          {data.candidate?.material?.event.type === 'fulfillment.resource_shortage' && <div><dt>{t('原交付时间')}</dt>
            <dd>{formatTimestamp(data.candidate.material.event.payload.dueAt).value}</dd></div>}
          {event.originalResource.kind === 'configuration' && <div><dt>{t('开业分区')}</dt><dd>{t(sectionNames[event.originalResource.sectionCode] ?? event.originalResource.sectionCode)}</dd></div>}
        </dl>
      </section>
      <section className={styles.section} aria-label={t('原办理与解释入口')}>
        <h3>{t('原办理与解释入口')}</h3>
        <div className={styles.toolbar}>
          <ActionButton intent="forward" label={t('打开原模型解释')} successLabel={t('原入口已打开')} disabled={busy || !props.onExplainOriginal}
            onAction={action(() => session.openEntry('explanation'))} />
          <ActionButton intent="forward" label={t('打开原办理入口')} successLabel={t('原入口已打开')} disabled={busy || !props.onOpenOriginal}
            onAction={action(() => session.openEntry('business'))} />
        </div>
        {!props.onExplainOriginal && <p className={styles.help}>{t('原模型解释入口尚未接入。')}</p>}
        {!props.onOpenOriginal && <p className={styles.help}>{t('原办理入口尚未接入。')}</p>}
        <p className={styles.help}>{t(data.openedEntry ? '原入口已响应；业务结果尚未复查。' : '解释与业务操作在原入口独立确认，本工作台不以打开入口判定完成。')}</p>
      </section>
      <section className={styles.section} aria-label={t('复查同一原来源')}>
        <h3>{t('复查同一原来源')}</h3>
        <ActionButton intent="review" label={t('明确复查原来源')} successLabel={t('已读取')} disabled={busy}
          onAction={action(() => session.recheck())} />
        {data.recheck ? <><p>{t(data.recheck.source.failed === null ? '当前来源不可读取；保留原待办记录，不表示异常已解决。'
          : data.recheck.source.failed ? '本次原来源仍报告异常。' : '本次原来源未报告异常。')}</p>
          <p className={styles.help}>{t('本次读取时间')} {formatTimestamp(data.recheck.readAt).value}</p></>
          : <p className={styles.help}>{t('尚未进行明确复查。')}</p>}
        <p className={styles.help}>{t('复查不等于模型判断或待办关闭，实际处理以原业务记录为准。')}</p>
      </section>
      <section className={styles.section} aria-label={t('待办处理记录')}>
        <h3>{t('待办处理记录')}</h3>
        {canCreate && <ConfirmAction label={t('为原事件准备待办')}
          prompt={t('为此原事件准备待办元数据？不调用模型、不发送通知或处理退款。')}
          doneLabel={t('已记录')} disabled={disabled} onConfirm={action(() => session.fromEvent())} />}
        {!!event.inputs.items.length && <div className={styles.field}><label htmlFor={inputField}>{t('选择原待办')}</label>
          <Select id={inputField} value={data.inputRef} disabled={busy}
            options={event.inputs.items.map(item => ({ value: item.inputRef, label: `${t(item.inputMode === 'shadow' ? '影子模式' : '人工确认模式')} · ${item.inputRef}` }))}
            onChange={value => { void session.selectInput(value).catch(() => undefined); }} /></div>}
        {event.inputs.nextAfter && <ActionButton intent="next" label={t('读取更多原待办')} successLabel={t('已读取')} disabled={busy}
          onAction={action(() => session.nextInputs())} />}
        {review && <>
          <dl className={styles.facts}><div><dt>{t('待办状态')}</dt><dd>{t(review.review.status === 'closed' ? '已关闭' : '待复核')}</dd></div>
            <div><dt>{t('原任务状态')}</dt><dd>{t(review.task.state === 'observed' ? taskNames[review.task.status] ?? review.task.status : '未观察到任务')}</dd></div></dl>
          <p className={styles.help}>{t('原任务仅显示最少状态，模型和业务结果须在原入口核对。')}</p>
          {review.review.status === 'closed' && <Alert type="info" title={t('待办已关闭；原资源结果仍须独立复查。')}
            description={review.review.closeReason ? t(closeNames[review.review.closeReason]) : undefined} />}
          <section className={styles.section} aria-label={t('处理授权')}>
            <h3>{t('处理授权')}</h3>
            <p className={styles.help}>{t('仅用于关闭此待办或记录反馈，业务办理沿原流程。')}</p>
            <div className={styles.field}><label htmlFor={grantField}>{t('授权动作')}</label>
              <Select id={grantField} value={grantAction} disabled={disabled} placeholder={t('选择授权动作')}
                options={[{ value: 'close', label: t('关闭此待办') }, { value: 'feedback', label: t('记录反馈') }]}
                onChange={value => { if (session.isCurrent() && value !== grantAction) { session.clearGrantPreview(); setGrantAction(value); } }} /></div>
            <div className={styles.toolbar}>
              <ActionButton intent="review" label={t('准备处理授权')} successLabel={t('已读取')} disabled={disabled || !grantAction}
                onAction={action(() => session.prepareGrant(grantAction!))} />
              <ActionButton intent="review" label={t('读取原处理授权')} successLabel={t('已读取')} disabled={disabled || !grantAction}
                onAction={action(() => session.readGrant(grantAction!))} />
            </div>
            {grantMaterial && <ReviewGrantFacts material={grantMaterial} t={t} />}
            {data.grantPreparation && <ConfirmAction label={t('确认启用当前授权')}
              prompt={t('按上述固定动作、修订、政策和期限启用处理授权？不授予模型或业务执行权限。')}
              doneLabel={t('原授权收据已读取')} disabled={disabled || !session.canEnableGrant()}
              onConfirm={action(() => session.enableGrant(data.grantPreparation!.preparedRef))} />}
            {data.grantObservation && <p className={styles.help}>{t(data.grantObservation.state !== 'observed' || !data.grantObservation.receipt
              ? '未观察到原授权收据，不证明未启用；继续按原引用核对。'
              : session.canMutate(data.grantObservation.key.action) ? '本次核对允许所选待办操作。'
                : '当前授权不可用于新写，请明确准备或核对。')}</p>}
          </section>
          {review.review.status === 'open' && <div className={styles.field}><label htmlFor={closeField}>{t('关闭理由')}</label>
            <Select id={closeField} value={reason} disabled={disabled} placeholder={t('选择关闭理由')}
              options={Object.entries(closeNames).map(([value, label]) => ({ value, label: t(label) }))} onChange={setReason} />
            <ConfirmAction label={t('关闭此待办')} prompt={t('关闭此原待办并记录所选理由？不表示原资源异常已解决。')}
              doneLabel={t('已关闭待办')} disabled={disabled || !reason || !session.canMutate('close')}
              onConfirm={action(() => session.close(reason!, grantRef!))} /></div>}
          <div className={styles.field}><label htmlFor={feedbackField}>{t('反馈')}</label>
            <Select id={feedbackField} value={feedback} disabled={disabled} placeholder={t('选择反馈')}
              options={Object.entries(feedbackNames).map(([value, label]) => ({ value, label: t(label) }))} onChange={setFeedback} />
            <ConfirmAction label={t('记录反馈')} prompt={t('记录此原待办的反馈？不修改业务事实。')}
              doneLabel={t('已记录')} disabled={disabled || !feedback || !session.canMutate('feedback')}
              onConfirm={action(() => session.feedback(feedback!, grantRef!))} /></div>
        </>}
      </section>
      <details><summary>{t('原定位')}</summary><dl className={styles.facts}>
        <div><dt>{t('原事件标识')}</dt><dd>{event.event.eventId}</dd></div>
        {review && <><div><dt>{t('待办标识')}</dt><dd>{review.inputRef}</dd></div>
          <div><dt>{t('政策修订')}</dt><dd>{review.policyReference.revision}</dd></div></>}
      </dl></details>
    </>}
    {!event && data.grantObservation?.state === 'observed' && data.grantObservation.receipt && <section className={styles.section} aria-label={t('处理授权')}>
      <h3>{t('处理授权')}</h3><ReviewGrantFacts material={data.grantObservation.receipt} t={t} />
      <p className={styles.help}>{t(session.canMutate(data.grantObservation.key.action)
        ? '本次核对允许所选待办操作。' : '当前授权不可用于新写，请明确准备或核对。')}</p>
    </section>}
  </section>;
}
