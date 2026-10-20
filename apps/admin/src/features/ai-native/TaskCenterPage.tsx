/** Owner-only task observation. User-initiated entry has no model/worker/write
 * port; a snapshot cursor is observation, not permission to continue execution. */
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AI_TASK_CENTER_ENTRY_PERMISSIONS, AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT } from "@rental-os/shared";
import { aiTaskCenterApi } from "@/api/aiTaskCenter";
import { currentSessionEpoch } from "@/app/queryClient";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { ActionButton, Alert, Select } from "@/components/ui";
import { useAuthStore } from "@/features/auth/authStore";
import { AiTaskWorkbench, type AiTaskDetailReader } from "./AiTaskWorkbench";
import { safeDisplayText } from "./safe-display";
import { formatTimestamp } from "./formatters";
import { readTaskCenterDetail } from "./task-center-reader";
import { TaskUsageObservation } from "./TaskUsageObservation";

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
    <PageHeader title={t("AI 任务中心")} description={t("读取本人当前空间任务。历史结果不授予新执行权限。")} />
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
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => { const change = () => { setVisible(!document.hidden); setSelected(null); };
    document.addEventListener("visibilitychange", change); return () => document.removeEventListener("visibilitychange", change); }, []);
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
  const readTask: AiTaskDetailReader = useCallback(async (taskId, _context, signal) => {
    const same = () => identityKey() === identity && !signal.aborted && !document.hidden;
    if (!same()) throw Error("AI_SCOPE_CHANGED");
    const { snapshot, result, coverage } = await readTaskCenterDetail(aiTaskCenterApi, taskId, signal, same);
    if (!same() || snapshot.contractVersion !== AI_TASK_DRAFT_VERSION || snapshot.taskId !== taskId
      || !AI_TASK_STATUSES_DRAFT.includes(snapshot.status) || !Array.isArray(snapshot.steps) || snapshot.steps.length > 1000
      || !/^(0|[1-9][0-9]{0,19})$/u.test(snapshot.cursor)) throw Error("AI_RESOURCE_UNAVAILABLE");
    return { task: { id: taskId, status: displayStatus(snapshot.status), scene: snapshot.sceneCode, updatedAt: snapshot.updatedAt },
      confirmationSteps: snapshot.steps.filter(step => step.kind === "confirmation").map(step => ({ runId: step.runId, stepId: step.stepId })),
      ...(result?.status === "available" ? { modelText: result.text!.value } : {}),
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
  }, [identity, t]);
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
  const data = query.error ? undefined : query.data;
  useEffect(() => { if (query.error || data && selected && !data.items.some(row => row.taskId === selected)) setSelected(null); }, [query.error, data, selected]);
  return <section aria-label={t("AI 任务观察")}>
    <Alert type="info" title={t("只读本人任务，不启动、恢复或重新派发。")}
      description={t("首次进入不请求 AI 数据；点击读取后按当前权限查询。切换空间或身份后清空当前视图，人工业务页面始终保留。")}/>
    <div className="panel-toolbar">
      <ActionButton label={t(opened ? "刷新任务" : "读取本人任务")} successLabel={t("读取已结束")} disabled={!visible || query.isFetching}
        onAction={async () => { setSelected(null); if (!opened) setOpened(true); await query.refetch({ throwOnError: true }); }} />
      <Select aria-label={t("任务状态")} value={status} disabled={!opened || query.isFetching}
        options={[{ value: "all", label: t("全部状态") }, ...AI_TASK_STATUSES_DRAFT.map(value => ({ value, label: t(statusLabels[value]) }))]}
        onChange={value => { setSelected(null); setStatus(String(value)); setPage(1); setCursors([null]); }} />
    </div>
    {opened && <AiTaskWorkbench context={{ audience: "operator", tenantId, workspaceId }} visible={visible} enabled
      selectedTaskId={data?.items.some(row => row.taskId === selected) ? selected : null} onSelectTask={setSelected} readTask={readTask} readConfirmation={readConfirmation}
      tasks={(data?.items ?? []).map(row => ({ id: row.taskId, status: displayStatus(row.status), scene: safeDisplayText(row.sceneCode), updatedAt: row.updatedAt }))}
      loading={query.isFetching} paging={query.isFetching} page={page} hasNext={!!data?.nextCursor}
      error={query.error ? t("当前任务不可读取，请重新核对权限或稍后重试。") : null}
      onPageChange={next => { if (query.isFetching || next < 1 || next > page + 1) return;
        if (next > page) { if (!data?.nextCursor) return; setCursors(old => [...old.slice(0, page), data.nextCursor]); }
        setSelected(null); setPage(next); }} />}
    {opened && visible && selected && data?.items.some(row => row.taskId === selected)
      && <TaskUsageObservation key={selected} taskId={selected} current={current}
        onAccessDenied={() => { setSelected(null); setOpened(false); }} />}
  </section>;
}
