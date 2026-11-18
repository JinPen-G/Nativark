/** 同一Rental Core只登记一份页面贡献；商品、资产、订单、养护、能力与地点复用单源页面和当前上下文。
 * 此入口不创建认证客户端或授予权限，宿主仍须经过标准注册和服务端授权。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { createRentalOrdersAdminContribution, type RentalOrderPageContext } from "./orders";
import { createRentalWorkOrdersAdminContribution, type RentalWorkOrderPageContext } from "./work-orders";
import { createRentalCapabilitiesAdminContribution, type RentalCapabilityPageContext } from "./capabilities";
import { createRentalLocationsAdminContribution, type RentalLocationPageContext } from "./locations";
import { createRentalCatalogAdminContribution, type RentalCatalogPageContext } from "./catalog";

export interface RentalAdminContexts {
  useOrderContext: () => RentalOrderPageContext;
  useWorkOrderContext: () => RentalWorkOrderPageContext;
  useCapabilityContext: () => RentalCapabilityPageContext;
  useLocationContext: () => RentalLocationPageContext;
  useCatalogContext: () => RentalCatalogPageContext;
}

export function createRentalAdminContribution(implementationVersion: string,
  contexts: RentalAdminContexts): CoreAdminContribution<CoreRouteComponent> {
  const orders = createRentalOrdersAdminContribution(implementationVersion, contexts.useOrderContext);
  const workOrders = createRentalWorkOrdersAdminContribution(implementationVersion, contexts.useWorkOrderContext);
  const capabilities = createRentalCapabilitiesAdminContribution(implementationVersion, contexts.useCapabilityContext);
  const locations = createRentalLocationsAdminContribution(implementationVersion, contexts.useLocationContext);
  const catalog = createRentalCatalogAdminContribution(implementationVersion, contexts.useCatalogContext);
  return { coreId: orders.coreId, implementationVersion,
    pages: [...catalog.pages, ...orders.pages, ...workOrders.pages, ...capabilities.pages, ...locations.pages] };
}
