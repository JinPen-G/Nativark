/** 工作台与经营报表复用原 Rental 路径，JSON 和 CSV 分别由宿主已认证的传输提供。 */
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import type {
  PaymentReconciliationSummary,
  RentalWorkbenchTodos,
  RentalWorkspaceOperationReport,
  RentalWorkspaceReportFilter,
} from "@rental-os/rental-core";
import { createRentalOrderApi } from "../orders/client";

export type RentalOperationsTextRequest = (path: string, params?: unknown) => Promise<string>;

export function createRentalOperationsApi(
  request: AdminRuntime["request"],
  requestText: RentalOperationsTextRequest,
) {
  const orders = createRentalOrderApi(request);
  return {
    profile: orders.profile,
    locations: orders.locations,
    // 经营空间继续由服务端会话解析，筛选沿用原报表合同。
    operationReport: (params?: RentalWorkspaceReportFilter, options: Pick<AdminRequestOptions, "signal"> = {}) =>
      request<RentalWorkspaceOperationReport>("/rental/v1/reports/operations", { params, ...options }),
    workbenchTodos: (options?: Pick<AdminRequestOptions, "signal">) =>
      request<RentalWorkbenchTodos>("/rental/v1/workbench/todos", options),
    reconcilePayments: (limit = 50) =>
      request<PaymentReconciliationSummary>(`/rental/v1/payment-reconciliation?limit=${limit}`, { method: "post" }),
    exportOperationReport: (params?: RentalWorkspaceReportFilter) =>
      requestText("/rental/v1/reports/operations/export", params),
  };
}

export type RentalOperationsApi = ReturnType<typeof createRentalOperationsApi>;
