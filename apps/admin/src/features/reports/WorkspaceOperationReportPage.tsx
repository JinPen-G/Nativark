/** 原经营报表入口复用同一 Rental 页面与已认证的文本传输。 */
import { WorkspaceOperationReportPage as RentalWorkspaceOperationReportPage } from "@rental-os/rental-core/admin/operations";
import { LegacyRentalOperationsPageHost } from "../workbench/legacy-operations-context";
export function WorkspaceOperationReportPage() {
  return <LegacyRentalOperationsPageHost page="operationReport"><RentalWorkspaceOperationReportPage /></LegacyRentalOperationsPageHost>;
}
