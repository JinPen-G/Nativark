/** 开业配置的路由和原 OR 准入单源登记，所有状态来自当前经营空间。 */
import { rentalPageLegacyPermissions, rentalPagePermissions } from "@rental-os/rental-core/permissions";
import type { CorePageDescriptor } from "@rental-os/core-contracts";
import type { RentalOrderSession } from "../orders/page-context";

export const RENTAL_SETUP_CORE_ID = "rental";
export const RENTAL_SETUP_LEGACY_PERMISSIONS = rentalPageLegacyPermissions("tenant-readiness");

export const RENTAL_SETUP_PAGES = {
  tenantReadiness: {
    id: "tenant-readiness",
    path: "/readiness",
    title: { default: "开业配置", translations: { "en-US": "Opening setup" } },
    purpose: "configuration",
    permissions: rentalPagePermissions("tenant-readiness"),
    menu: {
      group: { default: "经营基础", translations: { "en-US": "Operating setup" } },
      order: 0,
    },
  },
} satisfies Record<string, CorePageDescriptor>;

export function rentalSetupLegacyPageAllowed(session: RentalOrderSession): boolean {
  return Boolean(session.sessionVerified && session.authenticated && !session.user?.isSaasAdmin
    && RENTAL_SETUP_LEGACY_PERMISSIONS.some(permission => session.hasPermission(permission)));
}
