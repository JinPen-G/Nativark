/** 履约网络的页面、导航与操作权限共用此声明，标题消费原品类术语。 */
import { rentalLegacyPermission, rentalPagePermissions } from "@rental-os/rental-core/permissions";
import type { CorePageDescriptor } from "@rental-os/core-contracts";
import type { RentalCategoryTerminology } from "@rental-os/rental-core";
import { RENTAL_WORK_ORDER_PAGES } from "../work-orders/pages";

export const RENTAL_LOCATION_CORE_ID = "rental";
export const RENTAL_LOCATION_LEGACY_PERMISSIONS = {
  view: rentalLegacyPermission("station", "view"),
  manage: rentalLegacyPermission("station", "manage"),
} as const;

export const RENTAL_LOCATION_PAGES = {
  locations: {
    id: "locations",
    path: "/locations",
    title: { default: "履约地点", translations: { "en-US": "Locations" } },
    permissions: rentalPagePermissions("locations"),
    menu: {
      group: RENTAL_WORK_ORDER_PAGES.workOrders.menu.group,
      order: RENTAL_WORK_ORDER_PAGES.workOrders.menu.order + 10,
    },
  },
} satisfies Record<string, CorePageDescriptor>;

export function rentalLocationTitle(terminology?: RentalCategoryTerminology): string {
  return terminology?.navigationLabels?.locations ?? terminology?.fulfillmentLabel ?? "履约地点";
}
