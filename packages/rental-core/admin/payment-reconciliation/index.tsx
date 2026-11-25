/** 同一 Rental 贡献登记对账列表和批次详情，两个入口消费相同页面与当前上下文。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { PaymentReconciliationPage } from "./PaymentReconciliationPage";
import {
  RentalPaymentReconciliationPageProvider,
  type RentalPaymentReconciliationPageContext,
} from "./page-context";
import { RENTAL_PAYMENT_RECONCILIATION_CORE_ID, RENTAL_PAYMENT_RECONCILIATION_PAGES } from "./pages";

export const rentalPaymentReconciliationPageComponents: Readonly<Record<string, CoreRouteComponent>> = {
  [RENTAL_PAYMENT_RECONCILIATION_PAGES.batches.id]: PaymentReconciliationPage,
  [RENTAL_PAYMENT_RECONCILIATION_PAGES.detail.id]: PaymentReconciliationPage,
};

export function createRentalPaymentReconciliationAdminContribution(
  implementationVersion: string,
  usePageContext: () => RentalPaymentReconciliationPageContext,
): CoreAdminContribution<CoreRouteComponent> {
  const Page: CoreRouteComponent = () => (
    <RentalPaymentReconciliationPageProvider context={usePageContext()}>
      <PaymentReconciliationPage />
    </RentalPaymentReconciliationPageProvider>
  );
  return {
    coreId: RENTAL_PAYMENT_RECONCILIATION_CORE_ID,
    implementationVersion,
    pages: Object.values(RENTAL_PAYMENT_RECONCILIATION_PAGES).map(page => ({ ...page, component: Page })),
  };
}

export { PaymentReconciliationPage };
export * from "./client";
export * from "./page-context";
export * from "./pages";
export { rentalPaymentReconciliationMessages } from "./messages";
