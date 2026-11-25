/** Rental 订单的正式页面贡献，业务正文与原宿主兼容入口共用同一实现。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { RentalOrderCreatePage } from "./RentalOrderCreatePage";
import { RentalOrderDetailPage } from "./RentalOrderDetailPage";
import { RentalOrdersPage } from "./RentalOrdersPage";
import { RentalOrderPageContextProvider, type RentalOrderPageContext } from "./page-context";
import { RENTAL_ORDER_CORE_ID, RENTAL_ORDER_PAGES } from "./pages";

export * from "./client";
export * from "./page-context";
export * from "./pages";
export * from "./RentalOrdersPage";
export * from "./RentalOrderCreatePage";
export * from "./EnterpriseMerchantOrderDelegationPanel";
export * from "./enterprise-merchant-order-delegation";
export * from "./RentalOrderDetailPage";
export * from "./rentalOrderColumns";
export * from "./RentalOrderRowActions";
export * from "./OrderDetailSummary";
export * from "./OrderAllocationPanel";
export * from "./OrderDocumentsPanel";
export * from "./OrderFundingPanel";
export * from "./CarrierShipmentPanel";
export * from "./OrderQuickActionNotice";
export * from "./ExchangeInspectionPreparationPanel";
export * from "./ExchangeInspectionMediaPanel";
export * from "./ApprovedEnterpriseExchangePanel";
export * from "./original-exchange-inspection";
export * from "./original-exchange-inspection-media";
export * from "./original-approved-enterprise-exchange";
export * from "./orderDetailPresentation";
export * from "./orderListPresentation";
export * from "./orderQuickActions";
export * from "./orderFeeReview";
export * from "./orderServiceOccurrence";
export * from "./service-execution-reference";
export * from "./return-operation-reference";

export function createRentalOrdersAdminContribution(implementationVersion: string,
  usePageContext: () => RentalOrderPageContext): CoreAdminContribution<CoreRouteComponent> {
  const List: CoreRouteComponent = () => <RentalOrderPageContextProvider context={usePageContext()}>
    <RentalOrdersPage />
  </RentalOrderPageContextProvider>;
  const Create: CoreRouteComponent = () => <RentalOrderPageContextProvider context={usePageContext()}>
    <RentalOrderCreatePage />
  </RentalOrderPageContextProvider>;
  const Detail: CoreRouteComponent = () => <RentalOrderPageContextProvider context={usePageContext()}>
    <RentalOrderDetailPage />
  </RentalOrderPageContextProvider>;
  return { coreId: RENTAL_ORDER_CORE_ID, implementationVersion, pages: [
    { ...RENTAL_ORDER_PAGES.orders, component: List },
    { ...RENTAL_ORDER_PAGES.orderCreate, component: Create },
    { ...RENTAL_ORDER_PAGES.orderDetail, component: Detail }
  ] };
}
