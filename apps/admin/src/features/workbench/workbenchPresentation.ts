/** Read-only overview projections. Server facts and registered detail routes stay authoritative. */
import type { RentalWorkbenchTodo, RentalWorkbenchTodoType, RentalWorkspaceOperationReport } from "@rental-os/shared";

export const overviewOrderLabels: Record<string, string> = {
  draft: "草稿", reserved: "已预订", pickup_overdue: "待确认爽约", ready_for_pickup: "待领取",
  renting: "租赁中", return_inspection: "待归还检查", settling: "待结算", completed: "已关闭",
  cancelled: "已取消", no_show: "已爽约",
};

export const overviewTodoLabels: Record<RentalWorkbenchTodoType, string> = {
  pending_payment: "待支付超时", no_show_notice: "待通知爽约", no_show_confirmation: "待确认爽约",
  return_overdue: "逾时未归还", fee_review: "待裁定费用", refund: "待办理退款", work_order: "养护工单",
  notification_failure: "通知失败", cancelled_refund_due: "取消/爽约待退款", offline_payment_pending: "待线下收款确认",
};

export type OverviewPeriod = "today" | "week" | "month";
export const overviewPeriodLabels: Record<OverviewPeriod, string> = { today: "今日", week: "近 7 天", month: "本月" };

/** Keep the existing start-date filter; the rolling week is explicitly named as seven days. */
export function overviewPeriodStart(period: OverviewPeriod, at = new Date()) {
  const start = new Date(at);
  if (period === "week") start.setDate(start.getDate() - 6);
  if (period === "month") start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

export function overviewOrderFacts(data: RentalWorkspaceOperationReport) {
  const active = new Set(["reserved", "pickup_overdue", "ready_for_pickup", "renting", "return_inspection", "settling"]);
  return {
    active: data.statusBreakdown.filter(row => active.has(row.status)).reduce((sum, row) => sum + row.count, 0),
    completed: data.statusBreakdown.find(row => row.status === "completed")?.count ?? 0,
    availableAssets: data.utilization.serializedAssets.statusBreakdown.find(row => row.status === "available")?.count ?? 0,
  };
}

/** A todo's arbitrary href cannot grant navigation or substitute order permission for maintenance permission. */
export function overviewTodoTarget(item: RentalWorkbenchTodo, access: { orders: boolean; workOrders: boolean }) {
  if (item.type === "work_order") return access.workOrders && item.workOrderId
    ? { route: "workOrderDetail" as const, id: item.workOrderId } : undefined;
  return access.orders && item.orderId ? { route: "orderDetail" as const, id: item.orderId } : undefined;
}

/** Resolve only against the currently visible authorized result, including after a refresh removes a pinned task. */
export function overviewActiveTodo(items: RentalWorkbenchTodo[], pinnedId?: string, previewId?: string) {
  return items.find(item => item.id === pinnedId) ?? items.find(item => item.id === previewId) ?? items[0];
}
