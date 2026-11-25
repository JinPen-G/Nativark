/** 原消费者沿宿主接点复用同源订单组件。 */
import type { ComponentProps } from "react";
import { OrderAllocationPanel as CoreOrderAllocationPanel } from "@rental-os/rental-core/admin/orders";
import { LegacyRentalOrderPageHost } from "./legacy-order-context";

export function OrderAllocationPanel(props: ComponentProps<typeof CoreOrderAllocationPanel>) {
  return <LegacyRentalOrderPageHost orderId={props.order.id}><CoreOrderAllocationPanel {...props} /></LegacyRentalOrderPageHost>;
}
