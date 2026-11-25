/** 旧列表列签名与客户预览保持，列和单元格实现由 Rental Core 单源维护。 */
import { rentalOrderColumns as coreRentalOrderColumns } from "@rental-os/rental-core/admin/orders";
import { orderQuickActionPath } from "@rental-os/rental-core/admin/orders/logic";
import { CustomerPreview } from "@/features/membership/CustomerPreview";
export { orderStatusLabels, orderStatusIcon, orderStatusTone } from "@rental-os/rental-core/admin/orders";

export function rentalOrderColumns({ navigate, ...options }: Omit<Parameters<typeof coreRentalOrderColumns>[0], "openOrder" | "CustomerPreview"> & {
  navigate: (path: string) => void;
}) {
  return coreRentalOrderColumns({ ...options, CustomerPreview, openOrder: (orderId, action) => navigate(action
    ? orderQuickActionPath(orderId, action) : `/rental/orders/${encodeURIComponent(orderId)}`) });
}
