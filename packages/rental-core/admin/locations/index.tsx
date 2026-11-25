/** 履约网络贡献复用同一地点正文和列表能力，宿主供给当前范围与原组织权限。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { LocationPage } from "./LocationPage";
import type { RentalLocationPageContext } from "./page-context";
import { RENTAL_LOCATION_CORE_ID, RENTAL_LOCATION_PAGES } from "./pages";

export * from "./client";
export * from "./page-context";
export * from "./pages";
export * from "./listCapabilities";
export { LocationPage } from "./LocationPage";
export { locationCards } from "./locationCards";

export function createRentalLocationsAdminContribution(
  implementationVersion: string,
  usePageContext: () => RentalLocationPageContext,
): CoreAdminContribution<CoreRouteComponent> {
  const Page: CoreRouteComponent = () => <LocationPage {...usePageContext()} />;
  return {
    coreId: RENTAL_LOCATION_CORE_ID,
    implementationVersion,
    pages: [{ ...RENTAL_LOCATION_PAGES.locations, component: Page }],
  };
}
