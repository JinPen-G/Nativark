/** 原员工词条入口，当前术语沿宿主供给同一 Core 实例。 */
import { createRentalStaffLabels } from "@rental-os/rental-core/clients/staff";
import { terms } from "./context";

const labels = createRentalStaffLabels({ terms });
export const { orderStatusLabel, orderStatusTone, ORDER_TABS, orderTabMatches, assetStatusLabel, assetStatusTone, workOrderTypeLabel, workOrderStatusLabel, workOrderStatusTone, todoTypeLabel, todoTypeIcon, fulfillmentModeLabel, allocationStatusLabel, inventoryModeLabel, stockOperationLabel, stockOperationTone, assetHistorySourceLabel } = labels;
export type { Tone, OrderTabKey } from "@rental-os/rental-core/clients/staff";
