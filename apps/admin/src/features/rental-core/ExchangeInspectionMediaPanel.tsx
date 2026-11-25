/** 原消费者沿宿主接点复用同源订单组件。 */
import type { ComponentProps } from "react";
import { ExchangeInspectionMediaPanel as CoreExchangeInspectionMediaPanel } from "@rental-os/rental-core/admin/orders";
import { LegacyRentalOrderPageHost } from "./legacy-order-context";

export function ExchangeInspectionMediaPanel(props: ComponentProps<typeof CoreExchangeInspectionMediaPanel>) {
  return <LegacyRentalOrderPageHost orderId={props.orderId}><CoreExchangeInspectionMediaPanel {...props} /></LegacyRentalOrderPageHost>;
}
