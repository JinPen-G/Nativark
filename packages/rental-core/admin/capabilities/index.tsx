/** 经营空间能力页面贡献复用同一业务正文，宿主提供当前范围与原会话刷新。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { CapabilityGovernancePage } from "./CapabilityGovernancePage";
import type { RentalCapabilityPageContext } from "./page-context";
import { RENTAL_CAPABILITY_CORE_ID, RENTAL_CAPABILITY_PAGES } from "./pages";

export * from "./client";
export * from "./page-context";
export * from "./pages";
export { CapabilityGovernancePage } from "./CapabilityGovernancePage";

export function createRentalCapabilitiesAdminContribution(
  implementationVersion: string,
  usePageContext: () => RentalCapabilityPageContext
): CoreAdminContribution<CoreRouteComponent> {
  const Page: CoreRouteComponent = () => <CapabilityGovernancePage {...usePageContext()} />;
  return { coreId: RENTAL_CAPABILITY_CORE_ID, implementationVersion,
    pages: [{ ...RENTAL_CAPABILITY_PAGES.capabilities, component: Page }] };
}
