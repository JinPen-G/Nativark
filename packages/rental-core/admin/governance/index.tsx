/** 治理路由消费同一页签正文与宿主接点，经营设置、版本和采用仍由 Rental 服务决定。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { RentalGovernancePage } from "./RentalGovernancePage";
import type { RentalGovernancePageContext } from "./page-context";
import { RENTAL_GOVERNANCE_CORE_ID, RENTAL_GOVERNANCE_PAGES } from "./pages";

export { RentalGovernancePage } from "./RentalGovernancePage";
export {
  createRentalGovernancePageContext,
  type RentalGovernancePageContext,
  type RentalGovernanceComponents,
} from "./page-context";
export { rentalGovernanceMessages } from "./messages";

export function createRentalGovernanceAdminContribution(
  implementationVersion: string,
  usePageContext: () => RentalGovernancePageContext,
): CoreAdminContribution<CoreRouteComponent> {
  const Page: CoreRouteComponent = () => <RentalGovernancePage {...usePageContext()} />;
  return {
    coreId: RENTAL_GOVERNANCE_CORE_ID,
    implementationVersion,
    pages: [{ ...RENTAL_GOVERNANCE_PAGES.settings, component: Page }],
  };
}

export * from "./client";
export * from "./category-preparation-client";
export * from "./pages";
