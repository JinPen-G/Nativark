/** 旧行操作签名保留，目标沿原已登记订单路径转接。 */
import type { ComponentProps } from "react";
import { RentalOrderRowActions as CoreRentalOrderRowActions } from "@rental-os/rental-core/admin/orders";
import { orderQuickActionPath } from "@rental-os/rental-core/admin/orders/logic";

export function RentalOrderRowActions({ navigate, ...props }: Omit<ComponentProps<typeof CoreRentalOrderRowActions>, "openOrder"> & {
  navigate: (path: string) => void;
}) {
  return <CoreRentalOrderRowActions {...props} openOrder={(orderId, action) => navigate(action
    ? orderQuickActionPath(orderId, action) : `/rental/orders/${encodeURIComponent(orderId)}`)} />;
}
