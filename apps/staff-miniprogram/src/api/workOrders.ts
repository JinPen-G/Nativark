import type { AssignRentalWorkOrderRequest, RentalStockDisposition, RentalWorkOrder, RentalWorkOrderHistoryEntry, RentalWorkOrderStatus, ReviewRentalWorkOrderRequest, SubmitRentalWorkOrderRequest } from "@rental-os/shared";
import { request } from "../core/http";

/**
 * 养护工单（清洁 / 整备 / 校准 / 维修）与归还处置。
 * 执行档：领取、开始、提交；验收与处置恢复需要 maintenance:review。
 */
export function listWorkOrders(status?: RentalWorkOrderStatus): Promise<RentalWorkOrder[]> {
  return request<RentalWorkOrder[]>("/rental/v1/work-orders", { query: { status } });
}

export async function getWorkOrder(workOrderId: string): Promise<RentalWorkOrder | undefined> {
  const rows = await listWorkOrders();
  return rows.find((row) => row.id === workOrderId);
}

export function workOrderHistory(workOrderId: string): Promise<RentalWorkOrderHistoryEntry[]> {
  return request<RentalWorkOrderHistoryEntry[]>(`/rental/v1/work-orders/${encodeURIComponent(workOrderId)}/history`);
}

export function assignWorkOrder(workOrderId: string, input: AssignRentalWorkOrderRequest): Promise<RentalWorkOrder> {
  return request<RentalWorkOrder>(`/rental/v1/work-orders/${encodeURIComponent(workOrderId)}/assign`, { method: "PUT", data: input });
}

export function startWorkOrder(workOrderId: string): Promise<RentalWorkOrder> {
  return request<RentalWorkOrder>(`/rental/v1/work-orders/${encodeURIComponent(workOrderId)}/start`, { method: "POST" });
}

export function submitWorkOrder(workOrderId: string, input: SubmitRentalWorkOrderRequest): Promise<RentalWorkOrder> {
  return request<RentalWorkOrder>(`/rental/v1/work-orders/${encodeURIComponent(workOrderId)}/submit`, { method: "POST", data: input });
}

export function reviewWorkOrder(workOrderId: string, input: ReviewRentalWorkOrderRequest): Promise<RentalWorkOrder> {
  return request<RentalWorkOrder>(`/rental/v1/work-orders/${encodeURIComponent(workOrderId)}/review`, { method: "POST", data: input });
}

export function listStockDispositions(orderId?: string): Promise<RentalStockDisposition[]> {
  return request<RentalStockDisposition[]>("/rental/v1/stock-dispositions", { query: { orderId } });
}

export function restoreStockDisposition(dispositionId: string): Promise<unknown> {
  return request<unknown>(`/rental/v1/stock-dispositions/${encodeURIComponent(dispositionId)}/restore`, { method: "POST" });
}
