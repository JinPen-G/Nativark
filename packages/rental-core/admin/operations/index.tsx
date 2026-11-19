/** 工作台和经营报表以同一 Rental 贡献登记，正文沿当前宿主接点读取原业务事实。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { WorkbenchPage } from "./WorkbenchPage";
import { WorkspaceOperationReportPage } from "./WorkspaceOperationReportPage";
import { RentalOperationsPageProvider, type RentalOperationsPageContext } from "./page-context";
import { RENTAL_OPERATIONS_CORE_ID, RENTAL_OPERATIONS_PAGES } from "./pages";

export const rentalOperationsPageComponents: Readonly<Record<string, CoreRouteComponent>> = {
  [RENTAL_OPERATIONS_PAGES.workbench.id]: WorkbenchPage,
  [RENTAL_OPERATIONS_PAGES.operationReport.id]: WorkspaceOperationReportPage,
};

export function createRentalOperationsAdminContribution(
  implementationVersion: string,
  usePageContext: () => RentalOperationsPageContext,
): CoreAdminContribution<CoreRouteComponent> {
  return {
    coreId: RENTAL_OPERATIONS_CORE_ID,
    implementationVersion,
    pages: Object.values(RENTAL_OPERATIONS_PAGES).map(definition => {
      const Content = rentalOperationsPageComponents[definition.id];
      const Page: CoreRouteComponent = () => (
        <RentalOperationsPageProvider context={usePageContext()}>
          <Content />
        </RentalOperationsPageProvider>
      );
      return { ...definition, component: Page };
    }),
  };
}

export { WorkbenchPage, WorkspaceOperationReportPage };
export * from "./page-context";
export * from "./client";
export * from "./pages";
export { rentalOperationsMessages } from "./messages";
