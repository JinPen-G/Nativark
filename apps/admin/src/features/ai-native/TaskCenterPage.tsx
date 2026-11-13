import { TaskReadPolicy } from './TaskReadPolicy';
import { OrderHumanHandoff } from './OrderHumanHandoff';
import { TaskCalendarDraft } from './TaskCalendarDraft';
import { AI_TASK_CALENDAR_DRAFT_READ_PERMISSIONS } from '@rental-os/shared';
import { MemberNameFlow } from './MemberNameFlow';
import { NotificationChangeFlow } from './NotificationChangeFlow';
/** Owner task observation and explicit human approval/continuation. A cursor
 * grants no execution; original domain services and server configuration do. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Dayjs } from 'dayjs';
import { AI_TASK_CENTER_ENTRY_PERMISSIONS, AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_SCENE_CODES, type AiTaskSnapshotDraft } from "@rental-os/shared";
import { aiTaskCenterApi } from "@/api/aiTaskCenter";
import { createAiWorkbenchDisplayPort } from '@/api/aiWorkbenchDisplays';
import { currentSessionEpoch } from "@/app/queryClient";
import { useAiManagementLocale as useLocale } from './management-locale';
import { PageHeader } from "@/components/PageHeader";
import { ActionButton, Alert, Select, Accordion, DatePicker, ListFilterBar, ListFilterItem } from "@/components/ui";
import { ListTodo } from 'lucide-react';
import styles from './AiManagement.module.css';
import { useAuthStore } from "@/features/auth/authStore";
import { AiTaskWorkbench, type AiTaskDetailReader } from "./AiTaskWorkbench";
import { safeDisplayText } from "./safe-display";
import { formatTimestamp } from "./formatters";
import { readTaskCenterDetail, validateTaskCenterSnapshot } from "./task-center-reader";
import { TaskUsageObservation } from "./TaskUsageObservation";
import { TaskRuleDraft } from "./TaskRuleDraft";
import { AI_TASK_RULE_DRAFT_READ_PERMISSIONS } from "@rental-os/shared";
import { TaskHumanApproval } from "./TaskHumanApproval";
import { TaskQuoteReprepare } from './TaskQuoteReprepare';
import { TaskCancellation } from "./TaskCancellation";
import { TaskClarification } from "./TaskClarification";
import { VisibleObservationHost } from './VisibleObservationHost';
import { ConversationHistory } from './ConversationHistory';
import { AutomationReviewSection, AUTOMATION_REVIEW_ENTRY_PERMISSIONS } from './AutomationReviewSection';
import { TaskOpeningProposals } from './TaskOpeningProposals';
import { WorkbenchInputReviewSession, type WorkbenchQuoteParameterReview } from './workbench-input-review-session';
import { displaySame } from './workbench-display-host';
import { TaskWorkbenchModelControlProvider } from './TaskWorkbenchModelControls';
import { readWorkbenchControlResult } from './workbench-model-control-session';
import type { AiWorkbenchModelControlObservation, AiApprovalApplicationReferenceDraft, AiTaskReviewQueryDraft } from '@rental-os/shared';

const identityKey = () => {
  const auth = useAuthStore.getState();
  return JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, currentSessionEpoch()]);
};
const statusLabels = { queued: "已登记", running: "运行中", waiting_input: "等待补充信息", waiting_confirmation: "等待人工确认",
  waiting_external: "等待外部核对", cancel_requested: "取消已请求", cancelled: "已取消", succeeded: "已完成",
  partially_succeeded: "部分完成", failed: "失败" } as const;
const displayStatus = (status: string) => status === "queued" ? "registered" : status.startsWith("waiting_") ? "waiting" : status;
const sceneLabels: Record<string, string> = { order_explanation: '订单解释', opening_diagnosis: '开业诊断',
  quote_clarification: '租赁报价', ordinary_profile_change: '普通资料修改', 'ai.capability.text': '模型能力检测' };

export function TaskCenterPage() {
  const { t } = useLocale();
  const auth = useAuthStore();
  const allowed = !!auth.token && !!auth.tenant?.tenantId && !!auth.currentWorkspaceId && !!auth.user && !auth.user.isSaasAdmin
    && AI_TASK_CENTER_ENTRY_PERMISSIONS.some(auth.hasPermission);
  const reviewAllowed = !!auth.token && !!auth.tenant?.tenantId && !!auth.currentWorkspaceId && !!auth.user && !auth.user.isSaasAdmin
    && AUTOMATION_REVIEW_ENTRY_PERMISSIONS.some(auth.hasPermission);
  const identity = identityKey();
  return <>
    <PageHeader title={t("AI 任务中心")} />
    {allowed ? <TaskCenterReader key={identityKey()} identity={identityKey()} tenantId={auth.tenant!.tenantId} workspaceId={auth.currentWorkspaceId!} />
      : <Alert type="warning" title={t("当前没有任务中心读取入口权限。")}/>}
    {reviewAllowed && <AutomationReviewSection key={`review:${identity}`} identity={identity}
      current={() => identityKey() === identity} />}
  </>;
}
function TaskCenterReader({ identity, tenantId, workspaceId }: { identity: string; tenantId: string; workspaceId: string }) {
  const { t, locale } = useLocale();
  const [opened, setOpened] = useState(false);
  const [readAccessEpoch, setReadAccessEpoch] = useState(0);
  const [historyOpen, setHistoryOpen] = useState<string[]>([]);
  const [notificationTask, setNotificationTask] = useState<{ taskId: string; runId: string } | null>(null);
  const [status, setStatus] = useState<string>("all");
  const [sceneCode, setSceneCode] = useState('all');
  const [period, setPeriod] = useState<[Dayjs, Dayjs] | null>(null), [rangeError, setRangeError] = useState(false);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [modelControlResult, setModelControlResult] = useState<AiWorkbenchModelControlObservation | null>(null);
  const [requestedProposal, setRequestedProposal] = useState<(AiTaskReviewQueryDraft & { proposal: AiApprovalApplicationReferenceDraft }) | null>(null);
  const [detailSections, setDetailSections] = useState<string[]>([]);
  const selectedOwner = useRef(selected); selectedOwner.current = selected;
  const readAccessOwner = useRef(readAccessEpoch); readAccessOwner.current = readAccessEpoch;
  const [followTask, setFollowTask] = useState<string | null>(null);
  const [followEpoch, setFollowEpoch] = useState(0);
  const [followError, setFollowError] = useState(false);
  const [liveSnapshot, setLiveSnapshot] = useState<AiTaskSnapshotDraft | null>(null);
  const followOwner = useRef<{ active: boolean; reads: number; deadline: number; request?: AbortController }>(
    { active: false, reads: 0, deadline: 0 });
  const stopFollowing = () => { followOwner.current.active = false; followOwner.current.request?.abort(); setFollowTask(null); };
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => { setModelControlResult(null); setRequestedProposal(null); }, [selected, visible, readAccessEpoch]);
  useEffect(() => { const change = () => { stopFollowing(); setLiveSnapshot(null); setVisible(!document.hidden); setSelected(null); setNotificationTask(null); };
    document.addEventListener("visibilitychange", change); return () => document.removeEventListener("visibilitychange", change); }, []);
  useEffect(() => () => { followOwner.current.active = false; followOwner.current.request?.abort(); }, [identity, selected]);
  const current = () => identityKey() === identity && !!useAuthStore.getState().token && !document.hidden;
  const controlHost = useMemo(() => ({ identity, taskId: selected,
    current: () => selected !== null && selectedOwner.current === selected && identityKey() === identity
      && readAccessOwner.current === readAccessEpoch && !!useAuthStore.getState().token && !document.hidden,
    refresh: async (value: AiWorkbenchModelControlObservation, signal: AbortSignal) => {
      const same = () => selected !== null && value.taskId === selected && selectedOwner.current === selected
        && readAccessOwner.current === readAccessEpoch && current() && !signal.aborted;
      if (!same()) throw Error('AI_SCOPE_CHANGED');
      await readWorkbenchControlResult(aiTaskCenterApi, value, signal, same);
      if (!same()) throw Error('AI_SCOPE_CHANGED');
      stopFollowing(); setLiveSnapshot(null); setFollowError(false); setModelControlResult(structuredClone(value));
    },
  }), [identity, selected, readAccessEpoch]);
  const inputReview = useMemo(() => new WorkbenchInputReviewSession({ readQuestion: aiTaskCenterApi.input },
    () => selected !== null && selectedOwner.current === selected && identityKey() === identity
      && readAccessOwner.current === readAccessEpoch && !!useAuthStore.getState().token && !document.hidden), [identity, selected, readAccessEpoch]);
  const inputReviewState = useSyncExternalStore(inputReview.subscribe, inputReview.snapshot, inputReview.snapshot);
  useEffect(() => { inputReview.activate(); return () => inputReview.dispose(); }, [inputReview]);
  const displayPort = useMemo(() => createAiWorkbenchDisplayPort({ tenantId, workspaceId,
    current: () => identityKey() === identity && !!useAuthStore.getState().token && !document.hidden,
    reviewCandidate: async (candidate, fields, signal) => {
      if (!selected || selectedOwner.current !== selected || candidate.binding.taskId !== selected) throw Error('AI_SCOPE_CHANGED');
      const review = await inputReview.reviewCandidate(candidate, fields, signal);
      if (signal.aborted || selectedOwner.current !== selected || !current()) throw Error('AI_SCOPE_CHANGED');
      const section = 'kind' in review && review.kind === 'quote_parameters' ? 'approval' : 'input';
      setDetailSections(sections => sections.includes(section) ? sections : [...sections, section]);
    },
    openConfirmation: async (binding, proposal, signal) => {
      const same = () => selected !== null && binding.taskId === selected && selectedOwner.current === selected && current() && !signal.aborted;
      if (!same()) throw Error('AI_SCOPE_CHANGED');
      const snapshot = validateTaskCenterSnapshot(await aiTaskCenterApi.snapshot(binding.taskId, signal), binding.taskId);
      if (!same() || snapshot.status !== 'waiting_confirmation') throw Error('AI_REVISION_CONFLICT');
      const candidates = snapshot.steps.filter(step => step.kind === 'confirmation' && step.status === 'running');
      if (candidates.length !== 1) throw Error('AI_RESOURCE_UNAVAILABLE');
      const target = { taskId: binding.taskId, runId: candidates[0].runId, stepId: candidates[0].stepId };
      const review = await aiTaskCenterApi.review(target, signal), original = review.review.proposal;
      if (!same() || review.taskId !== target.taskId || review.runId !== target.runId || review.stepId !== target.stepId
        || review.taskRevision !== snapshot.revision || review.businessExecution !== 'not_attested'
        || original.payload.taskId !== binding.taskId || original.status !== 'pending_confirmation'
        || original.payload.scope.kind !== 'workspace' || original.payload.scope.tenantId !== tenantId
        || original.payload.scope.workspaceId !== workspaceId || !displaySame(proposal, {
          contractVersion: original.payload.contractVersion, proposalId: original.payload.proposalId,
          proposalRevision: original.payload.revision, reviewedPayloadHash: original.payloadHash })) throw Error('AI_REVISION_CONFLICT');
      setRequestedProposal({ ...target, proposal: structuredClone(proposal) });
      setDetailSections(sections => sections.includes('approval') ? sections : [...sections, 'approval']);
    } }), [identity, tenantId, workspaceId, inputReview, selected]);
  useEffect(() => { displayPort.activate(); return () => displayPort.dispose(); }, [displayPort]);
  const revalidateParameters = useCallback(async (review: WorkbenchQuoteParameterReview, signal: AbortSignal) => {
    const same = () => selected !== null && selectedOwner.current === selected && review.candidate.binding.taskId === selected
      && current() && !signal.aborted && displaySame(inputReview.snapshot().parameters, review);
    if (!same()) throw Error('AI_SCOPE_CHANGED');
    if (!displayPort.reviewCandidate) throw Error('AI_RESOURCE_UNAVAILABLE');
    // The original display port revalidates its retained source and field
    // witness before publishing a fresh candidate review to this owner.
    await displayPort.reviewCandidate(structuredClone(review.candidate), signal);
    const updated = inputReview.snapshot().parameters;
    if (!same() || !updated) throw Error('AI_SCOPE_CHANGED');
    return structuredClone(updated.fieldMaterial);
  }, [identity, selected, inputReview, displayPort]);
  const initiator = useAuthStore.getState().user;
  const createdFrom = period?.[0].toISOString(), createdBefore = period?.[1].toISOString();
  const resetPage = () => { stopFollowing(); setLiveSnapshot(null); setSelected(null); setPage(1); setCursors([null]); };
  const query = useQuery({ queryKey: ["ai-task-center", identity, status, sceneCode, initiator?.id, createdFrom, createdBefore, cursors[page - 1]],
    enabled: opened && visible && !rangeError,
    // One explicit refresh. No ambient query polling creates AI activity.
    retry: false, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    meta: { liveRefresh: false }, queryFn: async ({ signal }) => {
      if (!current() || !initiator?.id) throw Error("AI_SCOPE_CHANGED");
      if (rangeError) throw Error('AI_INVALID_INPUT');
      const result = await aiTaskCenterApi.list({ limit: 20, ...(cursors[page - 1] ? { cursor: cursors[page - 1]! } : {}),
        ...(status === "all" ? {} : { status: status as typeof AI_TASK_STATUSES_DRAFT[number] }),
        ...(sceneCode === 'all' ? {} : { sceneCode }), initiatorId: initiator.id,
        ...(createdFrom && createdBefore ? { createdFrom, createdBefore } : {}) }, signal);
      if (!current() || !result || !Array.isArray(result.items) || result.items.length > 20
        || new Set(result.items.map(row => row.taskId)).size !== result.items.length
        || result.items.some(row => !row || typeof row.taskId !== "string" || !AI_TASK_STATUSES_DRAFT.includes(row.status))
        || result.nextCursor !== null && (typeof result.nextCursor !== "string" || result.nextCursor.length > 512)) throw Error("AI_RESOURCE_UNAVAILABLE");
      return result;
    } });
  // A single React Query owner reads the persisted snapshot, never starts or
  // resumes a run. No polling before a separate, explicit human opt-in.
  const follow = useQuery<AiTaskSnapshotDraft>({ queryKey: ['ai-task-center-follow', identity, followTask, followEpoch],
    enabled: opened && visible && selected !== null && followTask === selected,
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, gcTime: 0,
    meta: { liveRefresh: false },
    refetchInterval: query => query.state.status === 'error' || !followOwner.current.active
      || followOwner.current.reads >= 200 || performance.now() >= followOwner.current.deadline
      || query.state.data && ['succeeded', 'partially_succeeded', 'cancelled', 'failed'].includes(query.state.data.status) ? false : 3000,
    queryFn: async ({ signal }) => {
      const taskId = followTask, owner = followOwner.current;
      const same = () => current() && owner.active && owner === followOwner.current && !signal.aborted;
      if (!taskId || !same() || owner.reads >= 200 || performance.now() >= owner.deadline) throw Error('AI_SCOPE_CHANGED');
      const controller = new AbortController(); owner.request = controller; owner.reads++;
      try {
        const value = validateTaskCenterSnapshot(await aiTaskCenterApi.snapshot(taskId,
          AbortSignal.any([signal, controller.signal, AbortSignal.timeout(6000)])), taskId);
        if (!same() || controller.signal.aborted) throw Error('AI_SCOPE_CHANGED');
        setLiveSnapshot(value);
        return value;
      } finally { if (owner.request === controller) owner.request = undefined; }
    } });
  const followFailed = followTask === selected && followOwner.current.active && follow.isError;
  // Preserve the last observation when the user stops. Clearing it would
  // change the detail reader and accidentally trigger another read on stop.
  const observed = !followFailed && liveSnapshot?.taskId === selected ? liveSnapshot : undefined;
  const observationKey = observed ? `${observed.taskId}:${observed.revision}:${observed.cursor}` : '';
  const readTask: AiTaskDetailReader = useCallback(async (taskId, _context, signal) => {
    const same = () => identityKey() === identity && !signal.aborted && !document.hidden;
    if (!same()) throw Error("AI_SCOPE_CHANGED");
    const { snapshot, result, coverage } = modelControlResult?.taskId === taskId
      ? await readWorkbenchControlResult(aiTaskCenterApi, modelControlResult, signal, same)
      : await readTaskCenterDetail(aiTaskCenterApi, taskId, signal, same);
    if (!same() || snapshot.contractVersion !== AI_TASK_DRAFT_VERSION || snapshot.taskId !== taskId
      || !AI_TASK_STATUSES_DRAFT.includes(snapshot.status) || !Array.isArray(snapshot.steps) || snapshot.steps.length > 1000
      || !/^(0|[1-9][0-9]{0,19})$/u.test(snapshot.cursor)) throw Error("AI_RESOURCE_UNAVAILABLE");
    return { task: { id: taskId, status: displayStatus(snapshot.status), scene: snapshot.sceneCode, updatedAt: snapshot.updatedAt },
      confirmationSteps: snapshot.steps.filter(step => step.kind === "confirmation").map(step => ({ runId: step.runId, stepId: step.stepId })),
      ...(result?.status === "available" ? { modelText: result.text!.value, modelObservation: result } : {}),
      steps: snapshot.steps.map(step => ({ id: step.stepId, taskId, status: step.status === "pending" ? "registered" : step.status,
        action: `${step.runId} / ${step.sequence}`, occurredAt: null })),
      factRows: [{ label: t("任务修订"), value: String(snapshot.revision) }, { label: t("持久事件水位"), value: snapshot.cursor },
        { label: t("观察时间依据"), value: formatTimestamp(snapshot.updatedAt).value },
        { label: t("事件范围"), value: t(coverage === 'original_control_reference' ? '按已核对的原模型操作定位读取本次结果。'
          : coverage === "reset_required" ? "历史游标已失效，不补造事件；仅按现存引用独立复验结果。"
          : coverage === "first_page_only" ? "仅前50条保留事件，未加载后续；本页结果不是最新结果保证。" : "当前保留事件，未证明完整业务历史。") },
        { label: t("原结果"), value: t(result?.status === "available" ? "当前事实及来源复验后可读，AI文本不是业务执行证据。"
          : result?.status === "stale" ? "事实已变化，旧正文不显示，请回原业务页核对。"
            : result?.status === "unknown" ? "结果待核对，不自动重试。" : result?.status === "failed" ? "原步骤失败，未产生可展示答案。"
              : "本次没有可读取的结果，不能推断未执行或已成功。") }] };
  }, [identity, t, observationKey, modelControlResult]);
  const readConfirmation = useCallback(async (reference: { taskId: string; runId: string; stepId: string }, signal: AbortSignal) => {
    if (!current() || signal.aborted) throw Error("AI_SCOPE_CHANGED");
    try {
      const result = await aiTaskCenterApi.confirmation(reference, signal);
      if (!current() || signal.aborted) throw Error("AI_SCOPE_CHANGED");
      return result;
    } catch (failure) {
      if ([401, 403].includes((failure as { response?: { status?: number } }).response?.status ?? 0)) { setSelected(null); setOpened(false); }
      throw failure;
    }
  }, [identity]);
  const readSource = useCallback<NonNullable<import('./AiTaskWorkbench').AiTaskWorkbenchProps['readSource']>>(async (reference, signal) => {
    if (!current() || signal.aborted) throw Error('AI_SCOPE_CHANGED');
    try {
      const result = await aiTaskCenterApi.source(reference, signal);
      if (!current() || signal.aborted) throw Error('AI_SCOPE_CHANGED');
      return result;
    } catch (failure) {
      if ([401, 403].includes((failure as { response?: { status?: number } }).response?.status ?? 0)) { setSelected(null); setOpened(false); }
      throw failure;
    }
  }, [identity]);
  const originalPage = query.error || rangeError ? undefined : query.data;
  // Only this currently reauthorized row is refreshed; not a claim that every
  // page/order was observed, nor a model-derived optimistic status update.
  const data = originalPage && { ...originalPage, items: originalPage.items.map(row => observed?.taskId === row.taskId
    ? { ...row, status: observed.status, revision: observed.revision, updatedAt: observed.updatedAt, cancelRequestedAt: observed.cancelRequestedAt } : row)
    .filter(row => status === 'all' || row.status === status) };
  const selectedStatus = data?.items.find(row => row.taskId === selected)?.status;
  // Initialize only for a different task or workflow state; ordinary refreshes
  // and candidate review updates preserve the user's controlled panel choices.
  useEffect(() => { setDetailSections(selectedStatus === 'waiting_input' ? ['input']
    : selectedStatus === 'waiting_confirmation' ? ['approval'] : []); }, [selected, selectedStatus]);
  const selectedVisible = !!data?.items.some(row => row.taskId === selected);
  useEffect(() => { if (query.error || followFailed || originalPage && selected && !selectedVisible) {
    if (followFailed) setFollowError(true);
    stopFollowing(); setLiveSnapshot(null); setSelected(null);
    const code = (follow.error as { response?: { status?: number } })?.response?.status;
    if (code === 401 || code === 403) setOpened(false);
  } }, [query.error, followFailed, originalPage, selected, selectedVisible]);
  return <VisibleObservationHost surface="task_center" taskId={selected} current={current}><section className={styles.stack} aria-label={t("AI 任务观察")}>
    <Accordion value={historyOpen} onValueChange={value => { setHistoryOpen(value);
      if (!value.includes('notification-change')) setNotificationTask(null); }} items={[{ key: 'conversations', title: t('本人对话历史'),
      content: <ConversationHistory current={current} enabled={historyOpen.includes('conversations') && visible}
        identity={JSON.stringify([tenantId, workspaceId, useAuthStore.getState().user?.id])} /> },
      ...(useAuthStore.getState().hasPermission('rental-os:member:view') || useAuthStore.getState().hasPermission('rental-os:member:manage') ? [{
        key: 'member-name', title: t('会员姓名修改'), content: visible && historyOpen.includes('member-name')
          ? <MemberNameFlow identity={identity} current={current} onAccessDenied={() => setHistoryOpen([])} /> : null }] : []),
      ...(useAuthStore.getState().hasPermission('rental-os:price:manage') ? [{
        key: 'notification-change', title: locale === 'en-US' ? 'Notification settings review' : t('通知设置审核'),
        content: visible && historyOpen.includes('notification-change') ? <>
          <NotificationChangeFlow identity={identity} current={current}
            onTaskReady={task => { if (current()) setNotificationTask(task); }}
            onAccessDenied={() => { setNotificationTask(null); setHistoryOpen([]); }} />
          {notificationTask && <TaskHumanApproval key={`${identity}:${notificationTask.taskId}:${notificationTask.runId}`}
            taskId={notificationTask.taskId} runId={notificationTask.runId} identity={identity} current={current}
            onAccessDenied={() => { setNotificationTask(null); setHistoryOpen([]); }} />}
        </> : null }] : [])]} />
    <ListFilterBar>
      <ListFilterItem label={t('任务状态')} active={status !== 'all'}><Select aria-label={t("任务状态")} value={status} disabled={query.isFetching}
        options={[{ value: "all", label: t("全部状态") }, ...AI_TASK_STATUSES_DRAFT.map(value => ({ value, label: t(statusLabels[value]) }))]}
        onChange={value => { resetPage(); setStatus(String(value)); }} /></ListFilterItem>
      <ListFilterItem label={t('任务场景')} active={sceneCode !== 'all'}><Select aria-label={t('任务场景')} value={sceneCode} disabled={query.isFetching}
        options={[{ value: 'all', label: t('全部场景') }, ...Array.from(new Set([...AI_SCENE_CODES, 'ai.capability.text', 'ordinary_profile_change',
          ...(query.data?.items.map(row => row.sceneCode) ?? [])])).map(value => ({ value, label: t(sceneLabels[value] ?? safeDisplayText(value, 191)) }))]}
        onChange={value => { resetPage(); setSceneCode(String(value)); }} /></ListFilterItem>
      <ListFilterItem label={t('发起人')}><Select aria-label={t('发起人')} value={initiator?.id} disabled
        options={initiator ? [{ value: initiator.id, label: `${t('本人')} · ${safeDisplayText(initiator.displayName, 80)}` }] : []} /></ListFilterItem>
      <ListFilterItem label={t('创建时间')} width="dateRange" active={period !== null}><DatePicker.RangePicker showTime allowClear value={period}
        disabled={query.isFetching} placeholder={[t('开始时间（含）'), t('结束时间（不含）')]}
        onChange={value => {
          resetPage();
          if (!value) { setPeriod(null); setRangeError(false); return; }
          if (!value[0]?.isValid() || !value[1]?.isValid() || value[1].valueOf() <= value[0].valueOf()) {
            setPeriod(null); setRangeError(true); return;
          }
          setPeriod([value[0], value[1]]); setRangeError(false);
        }} /></ListFilterItem>
      <ListFilterItem kind="action"><ActionButton variant={opened ? 'secondary' : 'primary'} label={t(opened ? "刷新任务" : "读取本人任务")} successLabel={t("读取已结束")} disabled={!visible || query.isFetching || rangeError}
        onAction={async () => { stopFollowing(); setLiveSnapshot(null); setFollowError(false); setSelected(null); if (!opened) setOpened(true); await query.refetch({ throwOnError: true }); }} />
      </ListFilterItem>
    </ListFilterBar>
    {rangeError && <Alert type="warning" title={t('请选择完整的创建时间范围，结束时间须晚于开始时间。')} />}
    {!opened && <div className={styles.empty}><ListTodo size={28} aria-hidden="true" /><strong>{t('查看我的任务')}</strong><span className={styles.help}>{t('读取任务，查看进度与待办事项。')}</span></div>}
    {opened && visible && selected && <div className={styles.toolbar}>
      <ActionButton variant="secondary" label={t(followTask === selected ? '停止刷新状态' : '自动刷新状态')}
        successLabel={t('只读跟随设置已更新')} onAction={async () => {
          if (followTask === selected) { stopFollowing(); return; }
          stopFollowing(); setFollowError(false); followOwner.current = { active: true, reads: 0, deadline: performance.now() + 600000 };
          setFollowEpoch(value => value + 1); setFollowTask(selected);
        }} />
      <span className={styles.help} role="status">{t(followFailed ? '状态读取失败，已停止；旧详情已清除，请手动重读。'
        : followTask === selected ? '每3秒更新，最长10分钟；任务结束后停止。' : '仅更新所选任务的状态。')}</span>
    </div>}
    {(followFailed || followError) && <Alert type="warning" title={t('任务状态当前不可读取，已停止跟随并清除详情；请核对权限后重新读取。')} />}
    {visible && selected && data?.items.some(row => row.taskId === selected
      && ['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(row.sceneCode)) && <TaskReadPolicy key={`task-read-policy:${identity}:${selected}`}
        query={{ taskId: selected }} identity={identity} current={current}
        onAccessChanged={() => { stopFollowing(); setLiveSnapshot(null); setReadAccessEpoch(value => value + 1); }} />}
    {opened && <TaskWorkbenchModelControlProvider value={controlHost}><AiTaskWorkbench key={`${identity}:${readAccessEpoch}`} translate={t} context={{ audience: "operator", tenantId, workspaceId }} visible={visible} enabled
      display={{ identity, port: displayPort, current }}
      statusLabels={Object.fromEntries((data?.items ?? []).map(row => [row.taskId, t(statusLabels[row.status])]))}
      selectedTaskId={!followFailed && data?.items.some(row => row.taskId === selected) ? selected : null}
      onSelectTask={taskId => { stopFollowing(); setLiveSnapshot(null); setModelControlResult(null); setSelected(taskId); }} readTask={readTask} readConfirmation={readConfirmation} readSource={readSource}
      tasks={(data?.items ?? []).map(row => ({ id: row.taskId, status: displayStatus(row.status), scene: safeDisplayText(row.sceneCode), updatedAt: row.updatedAt }))}
      loading={query.isFetching} paging={query.isFetching} page={page} hasNext={!!data?.nextCursor}
      forbidden={[401, 403].includes((query.error as { response?: { status?: number } } | null)?.response?.status ?? 0)}
      error={query.error ? t("当前任务不可读取，请重新核对权限或稍后重试。") : null}
      detailActions={visible && !followFailed && selected && data?.items.some(row => row.taskId === selected) ? <Accordion key={selected}
        value={detailSections} onValueChange={setDetailSections}
        items={[
          ...(data.items.find(row => row.taskId === selected)?.sceneCode === 'order_explanation'
            && useAuthStore.getState().hasPermission('rental-os:order:view') ? [{ key: 'order-handoff', title: t('订单人工办理'),
            content: <OrderHumanHandoff key={`order-handoff:${identity}:${selected}`} query={{ taskId: selected }} identity={identity} current={current}
              onAccessDenied={() => { stopFollowing(); setSelected(null); setOpened(false); }} /> }] : []),
          { key: 'approval', title: t('人工确认'), content: data.items.find(row => row.taskId === selected)?.sceneCode === 'quote_clarification'
            ? <TaskQuoteReprepare key={`quote-review:${identity}:${selected}`} taskId={selected} identity={identity} current={current}
              requestedProposal={requestedProposal?.taskId === selected ? requestedProposal : undefined}
              parameterReview={inputReviewState.parameters} revalidateParameters={revalidateParameters}
              onParameterReviewed={status => { if (status === 'adopted') inputReview.clear(); }}
              onAccessDenied={() => { setSelected(null); setOpened(false); }} />
            : <TaskHumanApproval key={`review:${selected}`} taskId={selected} identity={identity} current={current}
              requestedProposal={requestedProposal?.taskId === selected ? requestedProposal : undefined}
              onAccessDenied={() => { setSelected(null); setOpened(false); }} /> },
          { key: 'input', title: t('补充信息'), content: <TaskClarification key={`input:${selected}`} taskId={selected} identity={identity} current={current}
            candidateReview={inputReviewState.review} onCandidateReviewed={status => { if (status === 'adopted') inputReview.clear(); }}
            onAccessDenied={() => { stopFollowing(); setSelected(null); setOpened(false); }} /> },
          { key: 'cancel', title: t('取消任务'), content: <TaskCancellation key={`stop:${selected}`} taskId={selected} identity={identity} current={current}
            onAccessDenied={() => { stopFollowing(); setSelected(null); setOpened(false); }} /> },
          { key: 'usage', title: t('用量记录'), content: <TaskUsageObservation key={selected} taskId={selected} current={current}
            onAccessDenied={() => { setSelected(null); setOpened(false); }} /> },
          ...(data.items.find(row => row.taskId === selected)?.sceneCode === 'opening_diagnosis'
            && AI_TASK_RULE_DRAFT_READ_PERMISSIONS.some(permission => useAuthStore.getState().hasPermission(permission)) ? [{
            key: 'rule-draft', title: t('规则业务草稿'), content: <TaskRuleDraft key={`rule:${selected}`} taskId={selected} identity={identity} current={current}
              onAccessDenied={() => { stopFollowing(); setSelected(null); setOpened(false); }} /> }] : []),
          ...(data.items.find(row => row.taskId === selected)?.sceneCode === 'opening_diagnosis'
            && AI_TASK_CALENDAR_DRAFT_READ_PERMISSIONS.some(permission => useAuthStore.getState().hasPermission(permission)) ? [{
            key: 'calendar-draft', title: t('日历业务草稿'), content: <TaskCalendarDraft key={`calendar:${selected}`} taskId={selected} identity={identity} current={current}
              onAccessDenied={() => { stopFollowing(); setSelected(null); setOpened(false); }} /> }] : []),
          ...(data.items.find(row => row.taskId === selected)?.sceneCode === 'opening_diagnosis'
            && useAuthStore.getState().hasPermission('rental-os:price:manage') ? [{
            key: 'opening-proposals', title: locale === 'en-US' ? 'Opening section proposals' : '开业分区提案',
            content: <TaskOpeningProposals key={`opening:${identity}:${selected}`} taskId={selected} identity={identity} current={current} />,
          }] : []),
        ]} /> : null}
      onPageChange={next => { if (query.isFetching || next < 1 || next > page + 1) return;
        if (next > page) { if (!data?.nextCursor) return; setCursors(old => [...old.slice(0, page), data.nextCursor]); }
        stopFollowing(); setLiveSnapshot(null); setSelected(null); setPage(next); }} /></TaskWorkbenchModelControlProvider>}
  </section></VisibleObservationHost>;
}
