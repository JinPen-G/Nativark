import { useId } from "react";
import { ActionButton } from "@/components/ui";
export type ActionLifecycle =
  | "idle"
  | "cancel_requested"
  | "cancelled"
  | "recovery_candidate"
  | "unknown";
export interface CancelRecoveryStatusProps {
  status: ActionLifecycle;
  canCancel?: boolean;
  canRecover?: boolean;
  onCancel?: () => Promise<unknown>;
  onRecover?: () => Promise<unknown>;
}
const labels: Record<ActionLifecycle, string> = {
  idle: "运行中",
  cancel_requested: "取消已请求，动作可能已发生",
  cancelled: "已取消（不代表业务已回滚）",
  recovery_candidate: "待核对（恢复不代表重新执行）",
  unknown: "结果未知，请先核对",
};
export function CancelRecoveryStatus({
  status,
  canCancel = false,
  canRecover = false,
  onCancel,
  onRecover,
}: CancelRecoveryStatusProps) {
  const id = useId();
  const statusId = `action-status-${id}`;
  return (
    <section aria-label="任务动作状态">
      <p id={statusId} role="status" aria-live="polite">{labels[status]}</p>
      <ActionButton
        label="请求取消"
        aria-describedby={statusId}
        disabled={!canCancel || !onCancel}
        onAction={() => onCancel!()}
      />
      <ActionButton
        label="读取恢复候选"
        aria-describedby={statusId}
        disabled={!canRecover || !onRecover}
        onAction={() => onRecover!()}
      />
    </section>
  );
}
