/** 同一Rental Core只登记一份页面贡献；业务、渠道与开业页面复用各自单源上下文。
 * 此入口不创建认证客户端或授予权限，宿主仍须经过标准注册和服务端授权。 */
import type { CoreAdminContribution, CoreAdminPage } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { createRentalOrdersAdminContribution, type RentalOrderPageContext } from "./orders";
import { createRentalWorkOrdersAdminContribution, type RentalWorkOrderPageContext } from "./work-orders";
import { createRentalCapabilitiesAdminContribution, type RentalCapabilityPageContext } from "./capabilities";
import { createRentalLocationsAdminContribution, type RentalLocationPageContext } from "./locations";
import { createRentalCatalogAdminContribution, type RentalCatalogPageContext } from "./catalog";
import { createRentalCommercialAdminContribution, type RentalCommercialPageContext } from "./commercial";
import { createRentalGovernanceAdminContribution, type RentalGovernancePageContext } from "./governance";
import { createRentalMembershipAdminContribution, type RentalMembershipPageContext } from "./membership";
import { createRentalOperationsAdminContribution, type RentalOperationsPageContext } from "./operations";
import { createRentalChannelsAdminContribution, type RentalChannelsPageContext } from "./channels";
import { createRentalSetupAdminContribution, type RentalSetupPageContext } from "./setup";
import { createRentalPaymentReconciliationAdminContribution, type RentalPaymentReconciliationPageContext } from "./payment-reconciliation";

export { createRentalAdminHost } from "./host-context";
export type { RentalAdminHost, RentalAdminHostOptions, RentalAdminHostState } from "./host-context";
export { createRentalBrowserAdminHost } from "./browser-host";
export type { RentalBrowserAdminHostOptions } from "./browser-host";
export { createRentalNavigation } from "./browser-navigation";
export { createRentalNavigationPresentation } from "./browser-navigation-presentation";
export { createRentalShell } from "./browser-shell";
export type { RentalShellOptions } from "./browser-shell";

export interface RentalAdminContexts {
  useOrderContext: () => RentalOrderPageContext;
  useWorkOrderContext: () => RentalWorkOrderPageContext;
  useCapabilityContext: () => RentalCapabilityPageContext;
  useLocationContext: () => RentalLocationPageContext;
  useCatalogContext: () => RentalCatalogPageContext;
  useCommercialContext: () => RentalCommercialPageContext;
  useGovernanceContext: () => RentalGovernancePageContext;
  useMembershipContext: () => RentalMembershipPageContext;
  useOperationsContext: () => RentalOperationsPageContext;
  useChannelsContext: () => RentalChannelsPageContext;
  useSetupContext: () => RentalSetupPageContext;
  usePaymentReconciliationContext: () => RentalPaymentReconciliationPageContext;
}

export function createRentalAdminContribution(implementationVersion: string,
  contexts: RentalAdminContexts, additionalPages: readonly CoreAdminPage<CoreRouteComponent>[] = []): CoreAdminContribution<CoreRouteComponent> {
  const orders = createRentalOrdersAdminContribution(implementationVersion, contexts.useOrderContext);
  const workOrders = createRentalWorkOrdersAdminContribution(implementationVersion, contexts.useWorkOrderContext);
  const capabilities = createRentalCapabilitiesAdminContribution(implementationVersion, contexts.useCapabilityContext);
  const locations = createRentalLocationsAdminContribution(implementationVersion, contexts.useLocationContext);
  const catalog = createRentalCatalogAdminContribution(implementationVersion, contexts.useCatalogContext);
  const commercial = createRentalCommercialAdminContribution(implementationVersion, contexts.useCommercialContext);
  const governance = createRentalGovernanceAdminContribution(implementationVersion, contexts.useGovernanceContext);
  const membership = createRentalMembershipAdminContribution(implementationVersion, contexts.useMembershipContext);
  const operations = createRentalOperationsAdminContribution(implementationVersion, contexts.useOperationsContext);
  const channels = createRentalChannelsAdminContribution(implementationVersion, contexts.useChannelsContext);
  const setup = createRentalSetupAdminContribution(implementationVersion, contexts.useSetupContext);
  const paymentReconciliation = createRentalPaymentReconciliationAdminContribution(implementationVersion, contexts.usePaymentReconciliationContext);
  return { coreId: orders.coreId, implementationVersion,
    pages: [...catalog.pages, ...orders.pages, ...workOrders.pages, ...capabilities.pages, ...locations.pages, ...commercial.pages, ...governance.pages, ...membership.pages, ...operations.pages, ...channels.pages, ...setup.pages, ...paymentReconciliation.pages, ...additionalPages] };
}

export { rentalPublicManagement, RentalOperationsAccountPage, OriginalRentalOperationsAccountPage, RentalTenantManagementPage, RentalOperatorInvitations } from "./access";
export { rentalPublicPageContent } from "./public-page-content";
