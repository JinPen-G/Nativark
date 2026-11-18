/** 原消费者沿宿主接点复用同源订单组件。 */
import type { ComponentProps } from "react";
import { OrderDocumentsPanel as CoreOrderDocumentsPanel } from "@rental-os/rental-core/admin/orders";
import { LegacyRentalOrderPageHost } from "./legacy-order-context";
export { safeVoucherHtml } from "@rental-os/rental-core/admin/orders";

export function OrderDocumentsPanel(props: ComponentProps<typeof CoreOrderDocumentsPanel>) {
  return <LegacyRentalOrderPageHost orderId={props.order.id}><CoreOrderDocumentsPanel {...props} /></LegacyRentalOrderPageHost>;
}
