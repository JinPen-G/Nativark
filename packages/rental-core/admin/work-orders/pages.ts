/** 工单列表、菜单及详情面包屑的单源声明，注册本身不授予业务访问权。 */
import { rentalLegacyPermission, rentalPagePermissions } from "@rental-os/rental-core/permissions";
import type { CorePageDescriptor, CorePageLocation } from "@rental-os/core-contracts";

export const RENTAL_WORK_ORDER_CORE_ID = "rental";

/** 原营运宿主的兼容权限码；标准Core仍按resource/action和当前授权核验。 */
export const RENTAL_WORK_ORDER_LEGACY_PERMISSIONS: Readonly<Record<string, string>> = {
  view: rentalLegacyPermission("maintenance", "view"),
  manage: rentalLegacyPermission("maintenance", "manage"),
  review: rentalLegacyPermission("maintenance", "review")
};

export const RENTAL_WORK_ORDER_PAGES = {
  workOrders: {
    id: "work-orders",
    path: "/work-orders",
    title: { default: "养护工单", translations: { "en-US": "Work orders" } },
    permissions: rentalPagePermissions("work-orders"),
    menu: {
      group: { default: "商品与资产", translations: { "en-US": "Items & assets" } },
      order: 30
    }
  },
  workOrderDetail: {
    id: "work-order-detail",
    path: "/work-orders/:workOrderId",
    title: { default: "养护工单详情", translations: { "en-US": "Work order details" } },
    parent: "work-orders",
    permissions: rentalPagePermissions("work-order-detail")
  }
} satisfies Record<string, CorePageDescriptor>;

export function rentalWorkOrderLocation(workOrderId?: string): CorePageLocation {
  return workOrderId
    ? { coreId: RENTAL_WORK_ORDER_CORE_ID, pageId: RENTAL_WORK_ORDER_PAGES.workOrderDetail.id, params: { workOrderId } }
    : { coreId: RENTAL_WORK_ORDER_CORE_ID, pageId: RENTAL_WORK_ORDER_PAGES.workOrders.id };
}
