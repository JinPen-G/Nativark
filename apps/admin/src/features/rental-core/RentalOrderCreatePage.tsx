/** 原新建订单入口绑定当前宿主并消费同源 Core 页面，旧 URL 与权限沿原路由保持。 */
import { RentalOrderCreatePage as CoreRentalOrderCreatePage } from "@rental-os/rental-core/admin/orders";
import { LegacyRentalOrderPageHost } from "./legacy-order-context";

export function RentalOrderCreatePage() {
  return <LegacyRentalOrderPageHost page="orderCreate"><CoreRentalOrderCreatePage /></LegacyRentalOrderPageHost>;
}
