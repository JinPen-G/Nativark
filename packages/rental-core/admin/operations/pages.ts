/** 运营概览和经营报表共用路由、菜单及标题声明，原工作台 OR 准入由兼容宿主映射。 */
import { rentalPageLegacyPermissions, rentalPagePermissions } from "@rental-os/rental-core/permissions";
import type { CorePageDescriptor, CorePageLocation } from "@rental-os/core-contracts";
import type { RentalOrderSession } from "../orders/page-context";

export const RENTAL_OPERATIONS_CORE_ID = "rental";
const overviewGroup = { default: "概览", translations: { "en-US": "Overview" } };

export const RENTAL_OPERATIONS_PAGES = {
  workbench: {
    id: "workbench",
    path: "/workbench",
    title: { default: "运营概览", translations: { "en-US": "Dashboard" } },
    permissions: rentalPagePermissions("workbench"),
    menu: { group: overviewGroup, order: 10 },
  },
  operationReport: {
    id: "operation-report",
    path: "/reports/operations",
    title: { default: "经营报表", translations: { "en-US": "Reports" } },
    permissions: rentalPagePermissions("operation-report"),
    menu: { group: overviewGroup, order: 20 },
  },
} satisfies Record<string, CorePageDescriptor>;

export const RENTAL_OPERATIONS_LEGACY_PAGE_ACCESS: Readonly<Record<string, readonly string[]>> = {
  "workbench": rentalPageLegacyPermissions("workbench"),
  "operation-report": rentalPageLegacyPermissions("operation-report")
};

export function rentalOperationsLegacyPageAllowed(pageId: string, session: RentalOrderSession): boolean {
  const permissions = RENTAL_OPERATIONS_LEGACY_PAGE_ACCESS[pageId];
  return Boolean(permissions && session.sessionVerified && session.authenticated && !session.user?.isSaasAdmin
    && permissions.some(permission => session.hasPermission(permission)));
}

export function rentalOperationsLocation(
  pageName: keyof typeof RENTAL_OPERATIONS_PAGES = "workbench",
): CorePageLocation {
  return { coreId: RENTAL_OPERATIONS_CORE_ID, pageId: RENTAL_OPERATIONS_PAGES[pageName].id };
}
