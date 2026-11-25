/** 原订单路由绑定当前宿主，同源业务正文由 Rental Core 提供。 */
import { RentalOrderDetailPage as CoreRentalOrderDetailPage } from "@rental-os/rental-core/admin/orders";
import { LegacyRentalOrderPageHost } from "./legacy-order-context";

export function RentalOrderDetailPage() {
  return <LegacyRentalOrderPageHost><CoreRentalOrderDetailPage /></LegacyRentalOrderPageHost>;
}
