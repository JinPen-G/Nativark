/** 员工原检查运输与正式注册校验供给 Rental 工厂。 */
import { createRentalStaffInspectionTaskApi } from "@rental-os/rental-core/clients/staff";
import { request } from "../core/http";
import { taskContracts, taskHttp } from "../components/ai-native/inspection-wire-schemas";
import { validateInspectionWire, validateInspectionTaskWire } from "../components/ai-native/inspection-wire";
export function createStaffInspectionTaskApi(context: { current(): boolean }) {
  return createRentalStaffInspectionTaskApi(
    { request, taskContracts, taskHttp, validateInspectionWire, validateInspectionTaskWire },
    context,
  );
}
export type { StaffInspectionTaskApi } from "@rental-os/rental-core/clients/staff";
