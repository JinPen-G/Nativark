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
}: TaskListProps) {
  if (loading && !tasks)
    return (
      <p role="status" aria-live="polite">
        首次加载中…
      </p>
    );
  if (forbidden) return <p role="status">无权限查看 AI 任务</p>;
  if (error) return <p role="alert">任务列表加载失败：{error}</p>;
  const rows: DisplayTask[] = (tasks ?? []).map(toDisplayTask);
  if (!rows.length) return <p role="status">暂无 AI 任务</p>;
  return (
    <section aria-label="AI 任务列表" aria-busy={paging}>
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
          disabled={page <= 1 || paging}
          onClick={() => onPageChange?.(page - 1)}
        >
          上一页
        </Button>
        <span>第 {page} 页</span>
        <Button
          disabled={!hasNext || paging}
          onClick={() => onPageChange?.(page + 1)}
        >
          下一页
        </Button>
        {paging && <span role="status">分页加载中…</span>}
      </nav>
    </section>
  );
}
