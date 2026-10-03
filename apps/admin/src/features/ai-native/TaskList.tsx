import { toDisplayTask, type DisplayTask } from "./display-models";
import { Button } from "@/components/ui";
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
}: TaskListProps) {
  const currentPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  if (loading && !tasks)
    return (
      <p role="status" aria-live="polite">
        首次加载中…
      </p>
    );
  if (forbidden) return <p role="status">无权限查看 AI 任务</p>;
  if (error && !tasks) {
    return (
      <div>
        <p role="alert">任务列表加载失败：{error}</p>
        {onRetry && <Button onClick={onRetry}>重试</Button>}
      </div>
    );
  }
  const rows: DisplayTask[] = (tasks ?? []).map(toDisplayTask);
  if (!rows.length) return <p role="status">暂无 AI 任务</p>;
  return (
    <section aria-label="AI 任务列表" aria-busy={paging}>
      {loading && <p role="status" aria-live="polite">正在刷新任务…</p>}
      {error && <p role="alert">任务列表刷新失败：{error}{onRetry && <Button onClick={onRetry}>重试</Button>}</p>}
      <ul>
        {rows.map((task) => (
          <li key={task.id}>
            <span>{task.id}</span>
            <span>{task.scene}</span>
            <span>{labels[task.status]}</span>
            <time>{task.updatedAt ?? "更新时间不可用"}</time>
          </li>
        ))}
      </ul>
      <nav aria-label="任务分页">
        <Button
          disabled={!onPageChange || currentPage <= 1 || paging}
          onClick={() => onPageChange?.(currentPage - 1)}
        >
          上一页
        </Button>
        <span>第 {currentPage} 页</span>
        <Button
          disabled={!onPageChange || !hasNext || paging}
          onClick={() => onPageChange?.(currentPage + 1)}
        >
          下一页
        </Button>
        {paging && <span role="status">分页加载中…</span>}
      </nav>
    </section>
  );
}
