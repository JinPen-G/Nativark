/** 经营空间能力页面、导航与权限共用此声明。 */
import { rentalLegacyPermission, rentalPagePermissions } from "@rental-os/rental-core/permissions";
import type { CorePageDescriptor } from "@rental-os/core-contracts";

export const RENTAL_CAPABILITY_CORE_ID = "rental";
export const RENTAL_CAPABILITY_LEGACY_PERMISSIONS = {
  view: rentalLegacyPermission("capability", "view"),
  manage: rentalLegacyPermission("capability", "manage")
} as const;

export const RENTAL_CAPABILITY_PAGES = {
  capabilities: {
    id: "capabilities",
    path: "/capabilities",
    purpose: "configuration",
    title: { default: "经营空间能力", translations: { "en-US": "Workspace capabilities" } },
    permissions: rentalPagePermissions("capabilities"),
    menu: {
      group: { default: "经营基础", translations: { "en-US": "Operations foundation" } },
      order: 40
    }
  }
} satisfies Record<string, CorePageDescriptor>;
