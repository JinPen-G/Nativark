/** 员工养护工单与归还处置。领取、执行、验收和恢复使用原员工运输与服务端权限。 */
import type {
  AssignRentalWorkOrderRequest,
  RentalStockDisposition,
  RentalWorkOrder,
  RentalWorkOrderHistoryEntry,
  RentalWorkOrderStatus,
  ReviewRentalWorkOrderRequest,
  SubmitRentalWorkOrderRequest,
} from "../../src/contracts";
import type { RentalStaffClientPorts } from "./ports";

export function createRentalStaffWorkOrdersApi({ request }: RentalStaffClientPorts) {
  function listWorkOrders(status?: RentalWorkOrderStatus): Promise<RentalWorkOrder[]> {
    return request<RentalWorkOrder[]>("/rental/v1/work-orders", { query: { status } });
  }

  async function getWorkOrder(workOrderId: string): Promise<RentalWorkOrder | undefined> {
    const rows = await listWorkOrders();
    return rows.find((row) => row.id === workOrderId);
  }

  function workOrderHistory(workOrderId: string): Promise<RentalWorkOrderHistoryEntry[]> {
    return request<RentalWorkOrderHistoryEntry[]>(`/rental/v1/work-orders/${encodeURIComponent(workOrderId)}/history`);
  }

  function assignWorkOrder(workOrderId: string, input: AssignRentalWorkOrderRequest): Promise<RentalWorkOrder> {
    return request<RentalWorkOrder>(`/rental/v1/work-orders/${encodeURIComponent(workOrderId)}/assign`, { method: "PUT", data: input });
  }

  function startWorkOrder(workOrderId: string): Promise<RentalWorkOrder> {
    return request<RentalWorkOrder>(`/rental/v1/work-orders/${encodeURIComponent(workOrderId)}/start`, { method: "POST" });
  }

  function submitWorkOrder(workOrderId: string, input: SubmitRentalWorkOrderRequest): Promise<RentalWorkOrder> {
    return request<RentalWorkOrder>(`/rental/v1/work-orders/${encodeURIComponent(workOrderId)}/submit`, { method: "POST", data: input });
  }

  function reviewWorkOrder(workOrderId: string, input: ReviewRentalWorkOrderRequest): Promise<RentalWorkOrder> {
    return request<RentalWorkOrder>(`/rental/v1/work-orders/${encodeURIComponent(workOrderId)}/review`, { method: "POST", data: input });
  }

  function listStockDispositions(orderId?: string): Promise<RentalStockDisposition[]> {
    return request<RentalStockDisposition[]>("/rental/v1/stock-dispositions", { query: { orderId } });
  }

  function restoreStockDisposition(dispositionId: string): Promise<unknown> {
    return request<unknown>(`/rental/v1/stock-dispositions/${encodeURIComponent(dispositionId)}/restore`, { method: "POST" });
  }

  return {
    listWorkOrders,
    getWorkOrder,
    workOrderHistory,
    assignWorkOrder,
    startWorkOrder,
    submitWorkOrder,
    reviewWorkOrder,
    listStockDispositions,
    restoreStockDisposition,
  };
}
