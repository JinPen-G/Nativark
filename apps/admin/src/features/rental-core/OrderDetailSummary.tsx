/** 原详情沿同源摘要呈现，客户预览继续使用宿主原组件。 */
import type { ComponentProps } from "react";
import { OrderDetailSummary as CoreOrderDetailSummary } from "@rental-os/rental-core/admin/orders";
import { CustomerPreview } from "@/features/membership/CustomerPreview";
export { OrderMoney } from "@rental-os/rental-core/admin/orders";

export function OrderDetailSummary(props: Omit<ComponentProps<typeof CoreOrderDetailSummary>, "CustomerPreview">) {
  return <CoreOrderDetailSummary {...props} CustomerPreview={CustomerPreview} />;
}
