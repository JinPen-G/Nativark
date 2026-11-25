/** 原消费者沿宿主接点复用同源订单组件。 */
import type { ComponentProps } from "react";
import { CarrierShipmentPanel as CoreCarrierShipmentPanel } from "@rental-os/rental-core/admin/orders";
import { LegacyRentalOrderPageHost } from "./legacy-order-context";

export function CarrierShipmentPanel(props: ComponentProps<typeof CoreCarrierShipmentPanel>) {
  return <LegacyRentalOrderPageHost orderId={props.order.id}><CoreCarrierShipmentPanel {...props} /></LegacyRentalOrderPageHost>;
}
