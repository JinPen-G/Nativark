/**
 * Rental 养护工单与关联库存处置的原 HTTP 方法，复用宿主唯一认证请求。
 * 地点、数据范围、库存恢复和工单流转由原服务端裁定，业务写入沿原提交与结果核对。
 */
import type {
  AssignRentalWorkOrderRequest,
  CancelRentalWorkOrderRequest,
  CreateRentalWorkOrderRequest,
  RentalStockDisposition,
  RentalWorkOrder,
  RentalWorkOrderAssignee,
  RentalWorkOrderHistoryEntry,
  ReviewRentalWorkOrderRequest,
  SubmitRentalWorkOrderRequest
} from "@rental-os/rental-core";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";

type ReadOptions = Pick<AdminRequestOptions, "signal">;

export function createRentalWorkOrderApi(request: AdminRuntime["request"]) {
  return {
    stockDispositions: (orderId?: string, options: ReadOptions = {}) => request<RentalStockDisposition[]>("/rental/v1/stock-dispositions", { ...options, params: { orderId } }),
    restoreStockDisposition: (id: string) => request<RentalStockDisposition>(`/rental/v1/stock-dispositions/${id}/restore`, { method: "post" }),
    writeOffStockDisposition: (id: string, reason: string) => request<RentalStockDisposition>("/rental/v1/stock-dispositions/" + id + "/write-off", { method: "post", data: { reason } }),
    workOrders: (status?: string, options: ReadOptions = {}) => request<RentalWorkOrder[]>("/rental/v1/work-orders", { ...options, params: { status } }),
    workOrderAssignees: (locationId?: string, options: ReadOptions = {}) => request<RentalWorkOrderAssignee[]>("/rental/v1/work-order-assignees", { ...options, params: { locationId } }),
    workOrderHistory: (id: string, options?: ReadOptions) => request<RentalWorkOrderHistoryEntry[]>(`/rental/v1/work-orders/${id}/history`, options),
    createWorkOrder: (data: CreateRentalWorkOrderRequest) => request<RentalWorkOrder>("/rental/v1/work-orders", { method: "post", data }),
    assignWorkOrder: (id: string, data: AssignRentalWorkOrderRequest) => request<RentalWorkOrder>(`/rental/v1/work-orders/${id}/assign`, { method: "put", data }),
    startWorkOrder: (id: string) => request<RentalWorkOrder>(`/rental/v1/work-orders/${id}/start`, { method: "post" }),
    submitWorkOrder: (id: string, data: SubmitRentalWorkOrderRequest) => request<RentalWorkOrder>(`/rental/v1/work-orders/${id}/submit`, { method: "post", data }),
    reviewWorkOrder: (id: string, data: ReviewRentalWorkOrderRequest) => request<RentalWorkOrder>(`/rental/v1/work-orders/${id}/review`, { method: "post", data }),
    cancelWorkOrder: (id: string, data: CancelRentalWorkOrderRequest) => request<RentalWorkOrder>(`/rental/v1/work-orders/${id}/cancel`, { method: "post", data })
  };
}

export type RentalWorkOrderApi = ReturnType<typeof createRentalWorkOrderApi>;
