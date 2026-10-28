/** Owner task observation and explicit human approval/continuation. A cursor
 * grants no execution; original domain services and server configuration do. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AI_TASK_CENTER_ENTRY_PERMISSIONS, AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, type AiTaskSnapshotDraft } from "@rental-os/shared";
import { aiTaskCenterApi } from "@/api/aiTaskCenter";
import { currentSessionEpoch } from "@/app/queryClient";
import { useAiManagementLocale as useLocale } from './management-locale';
import { PageHeader } from "@/components/PageHeader";
import { ActionButton, Alert, Select, Accordion } from "@/components/ui";
import { ListTodo } from 'lucide-react';
import styles from './AiManagement.module.css';
import { useAuthStore } from "@/features/auth/authStore";
import { AiTaskWorkbench, type AiTaskDetailReader } from "./AiTaskWorkbench";
import { safeDisplayText } from "./safe-display";
import { formatTimestamp } from "./formatters";
import { readTaskCenterDetail, validateTaskCenterSnapshot } from "./task-center-reader";
import { TaskUsageObservation } from "./TaskUsageObservation";
import { TaskHumanApproval } from "./TaskHumanApproval";
import { TaskCancellation } from "./TaskCancellation";
import { TaskClarification } from "./TaskClarification";

const identityKey = () => {
  const auth = useAuthStore.getState();
  return JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, currentSessionEpoch()]);
};
const statusLabels = { queued: "已登记", running: "运行中", waiting_input: "等待补充信息", waiting_confirmation: "等待人工确认",
  waiting_external: "等待外部核对", cancel_requested: "取消已请求", cancelled: "已取消", succeeded: "已完成",
  partially_succeeded: "部分完成", failed: "失败" } as const;
const displayStatus = (status: string) => status === "queued" ? "registered" : status.startsWith("waiting_") ? "waiting" : status;

export function TaskCenterPage() {
  const { t } = useLocale();
  const auth = useAuthStore();
  const allowed = !!auth.token && !!auth.tenant?.tenantId && !!auth.currentWorkspaceId && !!auth.user && !auth.user.isSaasAdmin
    && AI_TASK_CENTER_ENTRY_PERMISSIONS.some(auth.hasPermission);
  return <>
    <PageHeader title={t("AI 任务中心")} />
    {allowed ? <TaskCenterReader key={identityKey()} identity={identityKey()} tenantId={auth.tenant!.tenantId} workspaceId={auth.currentWorkspaceId!} />
      : <Alert type="warning" title={t("当前没有任务中心读取入口权限。")}/>}
  </>;
}
function TaskCenterReader({ identity, tenantId, workspaceId }: { identity: string; tenantId: string; workspaceId: string }) {
  const { t } = useLocale();
  const [opened, setOpened] = useState(false);
  const [status, setStatus] = useState<string>("all");
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [followTask, setFollowTask] = useState<string | null>(null);
  const [followEpoch, setFollowEpoch] = useState(0);
  const [followError, setFollowError] = useState(false);
  const [liveSnapshot, setLiveSnapshot] = useState<AiTaskSnapshotDraft | null>(null);
  const followOwner = useRef<{ active: boolean; reads: number; deadline: number; request?: AbortController }>(
    { active: false, reads: 0, deadline: 0 });
  const stopFollowing = () => { followOwner.current.active = false; followOwner.current.request?.abort(); setFollowTask(null); };
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => { const change = () => { stopFollowing(); setLiveSnapshot(null); setVisible(!document.hidden); setSelected(null); };
    document.addEventListener("visibilitychange", change); return () => document.removeEventListener("visibilitychange", change); }, []);
  useEffect(() => () => { followOwner.current.active = false; followOwner.current.request?.abort(); }, [identity, selected]);
  const current = () => identityKey() === identity && !!useAuthStore.getState().token && !document.hidden;
  const query = useQuery({ queryKey: ["ai-task-center", identity, status, cursors[page - 1]], enabled: opened && visible,
    // One explicit refresh. No ambient query polling creates AI activity.
    retry: false, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    meta: { liveRefresh: false }, queryFn: async ({ signal }) => {
      if (!current()) throw Error("AI_SCOPE_CHANGED");
      const result = await aiTaskCenterApi.list({ limit: 20, ...(cursors[page - 1] ? { cursor: cursors[page - 1]! } : {}),
        ...(status === "all" ? {} : { status: status as typeof AI_TASK_STATUSES_DRAFT[number] }) }, signal);
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
    const { snapshot, result, coverage } = await readTaskCenterDetail(aiTaskCenterApi, taskId, signal, same);
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
        { label: t("事件范围"), value: t(coverage === "reset_required" ? "历史游标已失效，不补造事件；仅按现存引用独立复验结果。"
          : coverage === "first_page_only" ? "仅前50条保留事件，未加载后续；本页结果不是最新结果保证。" : "当前保留事件，未证明完整业务历史。") },
        { label: t("原结果"), value: t(result?.status === "available" ? "当前事实及来源复验后可读，AI文本不是业务执行证据。"
          : result?.status === "stale" ? "事实已变化，旧正文不显示，请回原业务页核对。"
            : result?.status === "unknown" ? "结果待核对，不自动重试。" : result?.status === "failed" ? "原步骤失败，未产生可展示答案。"
              : "本次没有可读取的结果，不能推断未执行或已成功。") }] };
  }, [identity, t, observationKey]);
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
  const originalPage = query.error ? undefined : query.data;
  // Only this currently reauthorized row is refreshed; not a claim that every
  // page/order was observed, nor a model-derived optimistic status update.
  const data = originalPage && { ...originalPage, items: originalPage.items.map(row => observed?.taskId === row.taskId
    ? { ...row, status: observed.status, revision: observed.revision, updatedAt: observed.updatedAt, cancelRequestedAt: observed.cancelRequestedAt } : row)
    .filter(row => status === 'all' || row.status === status) };
  const selectedVisible = !!data?.items.some(row => row.taskId === selected);
  useEffect(() => { if (query.error || followFailed || originalPage && selected && !selectedVisible) {
    if (followFailed) setFollowError(true);
    stopFollowing(); setLiveSnapshot(null); setSelected(null);
    const code = (follow.error as { response?: { status?: number } })?.response?.status;
    if (code === 401 || code === 403) setOpened(false);
  } }, [query.error, followFailed, originalPage, selected, selectedVisible]);
  return <section className={styles.stack} aria-label={t("AI 任务观察")}>
    <div className={styles.toolbar}>
      <Select aria-label={t("任务状态")} value={status} disabled={!opened || query.isFetching}
        options={[{ value: "all", label: t("全部状态") }, ...AI_TASK_STATUSES_DRAFT.map(value => ({ value, label: t(statusLabels[value]) }))]}
        onChange={value => { stopFollowing(); setLiveSnapshot(null); setSelected(null); setStatus(String(value)); setPage(1); setCursors([null]); }} />
      <ActionButton className={styles.toolbarEnd} variant={opened ? 'secondary' : 'primary'} label={t(opened ? "刷新任务" : "读取本人任务")} successLabel={t("读取已结束")} disabled={!visible || query.isFetching}
        onAction={async () => { stopFollowing(); setLiveSnapshot(null); setFollowError(false); setSelected(null); if (!opened) setOpened(true); await query.refetch({ throwOnError: true }); }} />
    </div>
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
    {opened && <AiTaskWorkbench translate={t} context={{ audience: "operator", tenantId, workspaceId }} visible={visible} enabled
      statusLabels={Object.fromEntries((data?.items ?? []).map(row => [row.taskId, t(statusLabels[row.status])]))}
      selectedTaskId={!followFailed && data?.items.some(row => row.taskId === selected) ? selected : null}
      onSelectTask={taskId => { stopFollowing(); setLiveSnapshot(null); setSelected(taskId); }} readTask={readTask} readConfirmation={readConfirmation} readSource={readSource}
      tasks={(data?.items ?? []).map(row => ({ id: row.taskId, status: displayStatus(row.status), scene: safeDisplayText(row.sceneCode), updatedAt: row.updatedAt }))}
      loading={query.isFetching} paging={query.isFetching} page={page} hasNext={!!data?.nextCursor}
      forbidden={[401, 403].includes((query.error as { response?: { status?: number } } | null)?.response?.status ?? 0)}
      error={query.error ? t("当前任务不可读取，请重新核对权限或稍后重试。") : null}
      detailActions={visible && !followFailed && selected && data?.items.some(row => row.taskId === selected) ? <Accordion key={selected}
        defaultOpen={data.items.find(row => row.taskId === selected)?.status === 'waiting_confirmation' ? 0 : data.items.find(row => row.taskId === selected)?.status === 'waiting_input' ? 1 : -1}
        items={[
          { key: 'approval', title: t('人工确认'), content: <TaskHumanApproval key={`review:${selected}`} taskId={selected} identity={identity} current={current}
            onAccessDenied={() => { setSelected(null); setOpened(false); }} /> },
          { key: 'input', title: t('补充信息'), content: <TaskClarification key={`input:${selected}`} taskId={selected} identity={identity} current={current}
            onAccessDenied={() => { stopFollowing(); setSelected(null); setOpened(false); }} /> },
          { key: 'cancel', title: t('取消任务'), content: <TaskCancellation key={`stop:${selected}`} taskId={selected} identity={identity} current={current}
            onAccessDenied={() => { stopFollowing(); setSelected(null); setOpened(false); }} /> },
          { key: 'usage', title: t('用量记录'), content: <TaskUsageObservation key={selected} taskId={selected} current={current}
            onAccessDenied={() => { setSelected(null); setOpened(false); }} /> }
        ]} /> : null}
      onPageChange={next => { if (query.isFetching || next < 1 || next > page + 1) return;
        if (next > page) { if (!data?.nextCursor) return; setCursors(old => [...old.slice(0, page), data.nextCursor]); }
        stopFollowing(); setLiveSnapshot(null); setSelected(null); setPage(next); }} />}
  </section>;
}
