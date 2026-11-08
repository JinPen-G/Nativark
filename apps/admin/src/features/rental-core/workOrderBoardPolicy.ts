import type { RentalWorkOrder } from "@rental-os/shared";

export type WorkOrderBoardAction = { kind: "start" | "submit" | "cancel" } | { kind: "review"; decision: "approved" | "rejected" } | { kind: "assign"; assigneeId?: string };
export type WorkOrderBoardMove = WorkOrderBoardAction | { kind: "reorder" } | { kind: "denied"; reason: string };
export const UNASSIGNED_WORK_ORDER = "unassigned";
export const workOrderColumn = (status: RentalWorkOrder["status"]) => ["completed", "cancelled", "rejected"].includes(status) ? "closed" : status;

/** A board gesture requests one existing command. The server still checks current status and authority. */
export function resolveWorkOrderBoardMove(row: RentalWorkOrder, column: string, assignee: string, permissions: { manage: boolean; review: boolean }): WorkOrderBoardMove {
  const assignmentChanged = assignee !== (row.assigneeId ?? UNASSIGNED_WORK_ORDER);
  const columnChanged = column !== workOrderColumn(row.status);
  if (!assignmentChanged && !columnChanged) return { kind: "reorder" };
  if (assignmentChanged && columnChanged) return { kind: "denied", reason: "请分别调整负责人和工单状态" };
  if (assignmentChanged) return permissions.manage && ["pending", "in_progress"].includes(row.status)
    ? { kind: "assign", assigneeId: assignee === UNASSIGNED_WORK_ORDER ? undefined : assignee }
    : { kind: "denied", reason: "当前工单不可派工" };
  if (row.status === "pending" && column === "in_progress" && permissions.manage) return { kind: "start" };
  if (row.status === "in_progress" && column === "pending_review" && permissions.manage) return { kind: "submit" };
  if (row.status === "pending_review" && ["closed", "in_progress"].includes(column) && permissions.review) return { kind: "review", decision: column === "closed" ? "approved" : "rejected" };
  if (["pending", "in_progress"].includes(row.status) && column === "closed" && permissions.manage) return { kind: "cancel" };
  return { kind: "denied", reason: "不能直接跳到该状态，请按工单流程处理" };
}

export function mergeWorkOrderDisplayOrder(previous: string[], visible: string[]) {
  const selected = new Set(visible);
  let index = 0;
  const retained = previous.map(id => selected.has(id) ? visible[index++] : id);
  return [...retained, ...visible.slice(index)];
}
