/** 原检查消费者复用同源保存与影像校验，宿主提供原会话和单次传输。 */
import type { ComponentProps } from "react";
import { ExchangeInspectionPreparationPanel as CorePreparationPanel, InspectionPreparationEditor as CorePreparationEditor }
  from "@rental-os/rental-core/admin/orders";
import { LegacyRentalOrderPageHost } from "./legacy-order-context";

export function ExchangeInspectionPreparationPanel(props: ComponentProps<typeof CorePreparationPanel>) {
  return <LegacyRentalOrderPageHost orderId={props.order.id}><CorePreparationPanel {...props} /></LegacyRentalOrderPageHost>;
}
export function InspectionPreparationEditor(props: ComponentProps<typeof CorePreparationEditor>) {
  return <LegacyRentalOrderPageHost orderId={props.requirements.orderId}><CorePreparationEditor {...props} /></LegacyRentalOrderPageHost>;
}
