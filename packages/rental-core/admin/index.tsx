/** 同一Rental Core只登记一份页面贡献；订单与养护复用各自单源页面和宿主当前上下文。
 * 此入口不创建认证客户端或授予权限，宿主仍须经过标准注册和服务端授权。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { createRentalOrdersAdminContribution, type RentalOrderPageContext } from "./orders";
import { createRentalWorkOrdersAdminContribution, type RentalWorkOrderPageContext } from "./work-orders";

export interface RentalAdminContexts {
  useOrderContext: () => RentalOrderPageContext;
  useWorkOrderContext: () => RentalWorkOrderPageContext;
}

export function createRentalAdminContribution(implementationVersion: string,
  contexts: RentalAdminContexts): CoreAdminContribution<CoreRouteComponent> {
  const orders = createRentalOrdersAdminContribution(implementationVersion, contexts.useOrderContext);
  const workOrders = createRentalWorkOrdersAdminContribution(implementationVersion, contexts.useWorkOrderContext);
  return { coreId: orders.coreId, implementationVersion, pages: [...orders.pages, ...workOrders.pages] };
}
