import { toDisplayTask, type DisplayTask } from "./display-models";
import { Alert, Button, EmptyScene } from "@/components/ui";
import styles from './AiManagement.module.css';
export interface TaskListProps {
  tasks?: readonly unknown[];
  loading?: boolean;
  paging?: boolean;
  error?: string | null;
  forbidden?: boolean;
  page: number;
  hasNext?: boolean;
  onPageChange?: (page: number) => void;
  onRetry?: () => void;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  translate?: (text: string) => string;
  statusLabels?: Readonly<Record<string, string>>;
}
const labels: Record<DisplayTask["status"], string> = {
  registered: "已登记",
  running: "运行中",
  waiting: "等待中",
  partially_succeeded: "部分完成",
  succeeded: "已完成",
  failed: "失败",
  cancel_requested: "取消已请求",
  cancelled: "已取消",
  unknown: "待核对",
};
const scenes: Record<string, string> = { order_explanation: '订单解读', opening_diagnosis: '开业诊断', quote_clarification: '报价说明' };
export function TaskList({
  tasks,
  loading = false,
  paging = false,
  error,
  forbidden = false,
  page,
  hasNext = false,
  onPageChange,
  onRetry,
  selectedTaskId = null,
  onSelectTask,
  translate: t = text => text,
  statusLabels,
}: TaskListProps) {
  const currentPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  if (loading && !tasks)
    return (
      <p role="status" aria-live="polite">
        首次加载中…
      </p>
    );
  if (forbidden) return <Alert type="warning" showIcon title={t("无权限查看 AI 任务")} />;
  if (error && (!tasks || tasks.length === 0)) {
    return (
      <Alert type="error" showIcon title={t("任务列表加载失败")} description={error}
        action={onRetry && <Button onClick={onRetry}>{t("重试")}</Button>} />
    );
  }
  const rows: DisplayTask[] = (tasks ?? []).map(toDisplayTask);
  if (!rows.length) return <EmptyScene compact scene="empty" title={t("暂无 AI 任务")} />;
  return (
    <section aria-label={t("AI 任务列表")} aria-busy={paging}>
      {loading && <p role="status" aria-live="polite">{t("正在刷新任务…")}</p>}
      {error && <Alert type="error" showIcon title={t("任务列表刷新失败")} description={error}
        action={onRetry && <Button onClick={onRetry}>{t("重试")}</Button>} />}
      <ul className={styles.taskList}>
        {rows.map((task) => (
          <li key={task.id} data-selected={selectedTaskId === task.id || undefined}>
            <div className={styles.taskIdentity}>
            {onSelectTask ? (
              <Button
                type="text"
                title={task.id}
                aria-label={`${t(scenes[task.scene] ?? task.scene)} · ${task.id}`}
                disabled={task.availability !== "available"}
                onClick={() => onSelectTask(task.id)}
                aria-pressed={selectedTaskId === task.id}
              >
                {t(scenes[task.scene] ?? task.scene)}
              </Button>
            ) : <strong>{t(scenes[task.scene] ?? task.scene)}</strong>}
            <span className={styles.help} title={task.id}>{task.id}</span></div>
            <span className={styles.status} data-tone={task.status === 'succeeded' ? 'success' : task.status === 'failed' ? 'danger' : ['waiting','unknown','partially_succeeded'].includes(task.status) ? 'warning' : task.status === 'running' ? 'info' : undefined}>{statusLabels?.[task.id] ?? t(labels[task.status])}</span>
            <time dateTime={task.updatedAt ?? undefined} title={task.updatedAt ?? undefined}>{task.updatedAt ? new Date(task.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : t("更新时间不可用")}</time>
          </li>
        ))}
      </ul>
      <nav className={styles.taskPager} aria-label={t("任务分页")}>
        <Button
          disabled={!onPageChange || currentPage <= 1 || paging}
          onClick={() => onPageChange?.(currentPage - 1)}
        >
          {t("上一页")}
        </Button>
        <span>{t("第")} {currentPage} {t("页")}</span>
        <Button
          disabled={!onPageChange || !hasNext || paging}
          onClick={() => onPageChange?.(currentPage + 1)}
        >
          {t("下一页")}
        </Button>
        {paging && <span role="status">分页加载中…</span>}
      </nav>
    </section>
  );
}
