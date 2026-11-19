/** 同一Rental Core只登记一份页面贡献；商品、资产、订单、养护、能力、地点、商业、治理、会员与经营页面复用单源上下文。
 * 此入口不创建认证客户端或授予权限，宿主仍须经过标准注册和服务端授权。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
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
}

export function createRentalAdminContribution(implementationVersion: string,
  contexts: RentalAdminContexts): CoreAdminContribution<CoreRouteComponent> {
  const orders = createRentalOrdersAdminContribution(implementationVersion, contexts.useOrderContext);
  const workOrders = createRentalWorkOrdersAdminContribution(implementationVersion, contexts.useWorkOrderContext);
  const capabilities = createRentalCapabilitiesAdminContribution(implementationVersion, contexts.useCapabilityContext);
  const locations = createRentalLocationsAdminContribution(implementationVersion, contexts.useLocationContext);
  const catalog = createRentalCatalogAdminContribution(implementationVersion, contexts.useCatalogContext);
  const commercial = createRentalCommercialAdminContribution(implementationVersion, contexts.useCommercialContext);
  const governance = createRentalGovernanceAdminContribution(implementationVersion, contexts.useGovernanceContext);
  const membership = createRentalMembershipAdminContribution(implementationVersion, contexts.useMembershipContext);
  const operations = createRentalOperationsAdminContribution(implementationVersion, contexts.useOperationsContext);
  return { coreId: orders.coreId, implementationVersion,
    pages: [...catalog.pages, ...orders.pages, ...workOrders.pages, ...capabilities.pages, ...locations.pages, ...commercial.pages, ...governance.pages, ...membership.pages, ...operations.pages] };
}
