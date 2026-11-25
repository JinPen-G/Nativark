/** 原运营概览入口绑定当前宿主，页面正文由 Rental 单源提供。 */
import { WorkbenchPage as RentalWorkbenchPage } from "@rental-os/rental-core/admin/operations";
import { LegacyRentalOperationsPageHost } from "./legacy-operations-context";
export function WorkbenchPage() {
  return <LegacyRentalOperationsPageHost page="workbench"><RentalWorkbenchPage /></LegacyRentalOperationsPageHost>;
}
