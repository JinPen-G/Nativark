/** 原对账路由通过当前会话适配消费 Rental 同源页面。 */
import { PaymentReconciliationPage as RentalPaymentReconciliationPage } from "@rental-os/rental-core/admin/payment-reconciliation";
import { LegacyRentalPaymentReconciliationPageHost } from "./legacy-payment-reconciliation-context";

export function PaymentReconciliationPage() {
  return <LegacyRentalPaymentReconciliationPageHost><RentalPaymentReconciliationPage /></LegacyRentalPaymentReconciliationPageHost>;
}
