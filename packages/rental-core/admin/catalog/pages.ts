/** 商品目录和资产工作区共用原导航身份、品类术语与权限声明。 */
import type { CorePageDescriptor } from "@rental-os/core-contracts";
import { RENTAL_WORK_ORDER_PAGES } from "../work-orders/pages";
export { resolveTenantNavigationLabels, applyTenantNavigationLabels } from "./navigation-terminology";
export const RENTAL_CATALOG_CORE_ID = "rental";
export const RENTAL_CATALOG_LEGACY_PERMISSIONS = {
  catalog: { view: "rental-core:catalog:view", manage: "rental-core:catalog:manage" },
  asset: { view: "rental-core:asset:view", manage: "rental-core:asset:manage" },
} as const;
export const RENTAL_CATALOG_PAGES = {
  catalog: {
    id: "item-groups",
    path: "/item-groups",
    title: { default: "商品目录", translations: { "en-US": "Item catalog" } },
    permissions: [{ resource: "catalog", action: "view" }],
    menu: {
      group: RENTAL_WORK_ORDER_PAGES.workOrders.menu.group,
      order: RENTAL_WORK_ORDER_PAGES.workOrders.menu.order - 30,
    },
  },
  assets: {
    id: "assets",
    path: "/assets",
    title: { default: "资产与库存", translations: { "en-US": "Assets & stock" } },
    permissions: [{ resource: "asset", action: "view" }],
    menu: {
      group: RENTAL_WORK_ORDER_PAGES.workOrders.menu.group,
      order: RENTAL_WORK_ORDER_PAGES.workOrders.menu.order - 10,
    },
  },
} satisfies Record<string, CorePageDescriptor>;
