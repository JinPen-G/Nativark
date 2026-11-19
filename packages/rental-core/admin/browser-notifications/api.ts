/** 待办和工单沿既有客户端读取，工单指派使用原客户端的单次提交运输。 */
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import type { RentalBrowserAdminSession } from "../browser";
import { createRentalOperationsApi } from "../operations/client";
import { createRentalWorkOrderApi } from "../work-orders/client";
import type { RentalNotificationApi } from "./types";

export function createRentalNotificationApi(session: RentalBrowserAdminSession): RentalNotificationApi {
  const operations = createRentalOperationsApi(session.runtime.request, session.requestText);
  const workOrders = createRentalWorkOrderApi(session.runtime.request);
  const requestOnce: AdminRuntime["request"] = <Output,>(path: string, options?: AdminRequestOptions) =>
    session.runtime.request<Output>(path, { ...options, retryAuthentication: false });
  const commands = createRentalWorkOrderApi(requestOnce);
  return {
    workbenchTodos: operations.workbenchTodos,
    workOrders: workOrders.workOrders,
    workOrderAssignees: workOrders.workOrderAssignees,
    assignWorkOrder: commands.assignWorkOrder,
  };
}
