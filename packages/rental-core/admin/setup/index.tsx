/** 开业配置以标准 Rental 页面贡献接入，当前业务事实和受权导航由宿主绑定。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { TenantReadinessPage } from "./TenantReadinessPage";
import { RentalSetupPageProvider, type RentalSetupPageContext } from "./page-context";
import { RENTAL_SETUP_CORE_ID, RENTAL_SETUP_PAGES } from "./pages";

export const rentalSetupPageComponents: Readonly<Record<string, CoreRouteComponent>> = {
  [RENTAL_SETUP_PAGES.tenantReadiness.id]: TenantReadinessPage,
};

export function createRentalSetupAdminContribution(
  implementationVersion: string,
  usePageContext: () => RentalSetupPageContext,
): CoreAdminContribution<CoreRouteComponent> {
  const Page: CoreRouteComponent = () => (
    <RentalSetupPageProvider context={usePageContext()}>
      <TenantReadinessPage />
    </RentalSetupPageProvider>
  );
  return {
    coreId: RENTAL_SETUP_CORE_ID,
    implementationVersion,
    pages: [{ ...RENTAL_SETUP_PAGES.tenantReadiness, component: Page }],
  };
}

export { TenantReadinessPage, TenantReadinessBody } from "./TenantReadinessPage";
export * from "./client";
export * from "./page-context";
export * from "./pages";
export * from "./navigation";
export { rentalSetupMessages } from "./messages";
