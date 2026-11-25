/** 员工养护与处置薄入口，实例沿真实员工运输消费 Rental 客户端。 */
import { createRentalStaffWorkOrdersApi } from "@rental-os/rental-core/clients/staff";
import { request } from "../core/http";

export const {
  listWorkOrders,
  getWorkOrder,
  workOrderHistory,
  assignWorkOrder,
  startWorkOrder,
  submitWorkOrder,
  reviewWorkOrder,
  listStockDispositions,
  restoreStockDisposition,
} = createRentalStaffWorkOrdersApi({ request });
