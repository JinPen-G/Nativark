/** 商品目录和资产工作区共用原导航身份、品类术语与权限声明。 */
import { rentalLegacyPermission, rentalPagePermissions } from "@rental-os/rental-core/permissions";
import type { CorePageDescriptor } from "@rental-os/core-contracts";
import { RENTAL_WORK_ORDER_PAGES } from "../work-orders/pages";
export { resolveTenantNavigationLabels, applyTenantNavigationLabels } from "./navigation-terminology";
export const RENTAL_CATALOG_CORE_ID = "rental";
export const RENTAL_CATALOG_LEGACY_PERMISSIONS = {
  catalog: { view: rentalLegacyPermission("catalog", "view"), manage: rentalLegacyPermission("catalog", "manage") },
  asset: { view: rentalLegacyPermission("asset", "view"), manage: rentalLegacyPermission("asset", "manage") },
} as const;
export const RENTAL_CATALOG_PAGES = {
  catalog: {
    id: "item-groups",
    path: "/item-groups",
    title: { default: "商品目录", translations: { "en-US": "Catalog" } },
    permissions: rentalPagePermissions("item-groups"),
    menu: {
      group: RENTAL_WORK_ORDER_PAGES.workOrders.menu.group,
      order: RENTAL_WORK_ORDER_PAGES.workOrders.menu.order - 30,
    },
  },
  assets: {
    id: "assets",
    path: "/assets",
    title: { default: "资产与库存", translations: { "en-US": "Assets & stock" } },
    permissions: rentalPagePermissions("assets"),
    menu: {
      group: RENTAL_WORK_ORDER_PAGES.workOrders.menu.group,
      order: RENTAL_WORK_ORDER_PAGES.workOrders.menu.order - 10,
    },
  },
} satisfies Record<string, CorePageDescriptor>;
