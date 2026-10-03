import { toDisplayStep, type DisplayStep } from "./display-models";
export interface TaskTimelineProps {
  taskId: string;
  steps?: readonly unknown[];
}
const labels: Record<DisplayStep["status"], string> = {
  registered: "已登记，尚未执行",
  running: "运行中",
  waiting_input: "等待补充输入",
  waiting_confirmation: "等待人工确认",
  waiting_external: "等待外部结果",
  succeeded: "已完成",
  partially_succeeded: "部分完成",
  failed: "失败",
  cancelled: "已取消",
  unknown: "待核对",
};
export function TaskTimeline({ taskId, steps }: TaskTimelineProps) {
  if (!steps) return <p role="status">步骤不可用</p>;
  const rows = steps
    .map(toDisplayStep)
    .filter((step) => step.taskId === taskId);
  if (!rows.length) return <p role="status">暂无步骤</p>;
  return (
    <ol aria-label="任务步骤时间线">
      {rows.map((step) => (
        <li key={step.id}>
          <strong>{labels[step.status]}</strong>
          <span>{step.action}</span>
          <time>{step.occurredAt ?? "时间不可用"}</time>
        </li>
      ))}
    </ol>
  );
}
