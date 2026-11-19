/** Rental 订单列表、新建和详情共用这一份菜单、路由、标题与父级声明。 */
import { rentalLegacyPermission, rentalPagePermissions } from "@rental-os/rental-core/permissions";
import type { CorePageDescriptor, CorePageLocation } from "@rental-os/core-contracts";

export const RENTAL_ORDER_CORE_ID = "rental";

export const RENTAL_ORDER_PAGES = {
  orders: {
    id: "orders",
    path: "/orders",
    title: { default: "订单管理", translations: { "en-US": "Orders" } },
    permissions: rentalPagePermissions("orders"),
    menu: { group: { default: "租赁交易", translations: { "en-US": "Rentals" } }, order: 10 }
  },
  orderCreate: {
    id: "order-create",
    path: "/orders/new",
    title: { default: "新建订单", translations: { "en-US": "New order" } },
    parent: "orders",
    permissions: rentalPagePermissions("order-create")
  },
  orderDetail: {
    id: "order-detail",
    path: "/orders/:id",
    title: { default: "订单详情", translations: { "en-US": "Order details" } },
    parent: "orders",
    permissions: rentalPagePermissions("order-detail")
  }
} satisfies Record<string, CorePageDescriptor>;

/** 原营运权限仅用于兼容宿主的明确映射，实际准入仍读取当前已验证会话。 */
export const RENTAL_ORDER_LEGACY_PERMISSIONS: Readonly<Record<string, string>> = {
  view: rentalLegacyPermission("order", "view"),
  create: rentalLegacyPermission("order", "create"),
  operate: rentalLegacyPermission("order", "operate"),
  pickup: rentalLegacyPermission("order", "pickup"),
  return: rentalLegacyPermission("order", "return"),
  extend: rentalLegacyPermission("order", "extend"),
  cancel: rentalLegacyPermission("order", "cancel"),
  settle: rentalLegacyPermission("order", "settle"),
  "fee-review": rentalLegacyPermission("order", "fee-review"),
  reassign: rentalLegacyPermission("order", "reassign")
};

export function rentalOrderLocation(orderId?: string): CorePageLocation {
  return orderId
    ? { coreId: RENTAL_ORDER_CORE_ID, pageId: RENTAL_ORDER_PAGES.orderDetail.id, params: { id: orderId } }
    : { coreId: RENTAL_ORDER_CORE_ID, pageId: RENTAL_ORDER_PAGES.orders.id };
}

export function rentalOrderCreateLocation(): CorePageLocation {
  return { coreId: RENTAL_ORDER_CORE_ID, pageId: RENTAL_ORDER_PAGES.orderCreate.id };
}
