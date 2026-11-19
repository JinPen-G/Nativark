/** 治理入口聚合原读取权限，页签和实际动作继续使用各自的经营权限。 */
import { rentalPageLegacyPermissions, rentalPagePermissions } from "@rental-os/rental-core/permissions";
import type { CorePageDescriptor } from "@rental-os/core-contracts";

export const RENTAL_GOVERNANCE_CORE_ID = "rental";
export const RENTAL_GOVERNANCE_ACCESS = rentalPagePermissions("governance");
export const RENTAL_GOVERNANCE_LEGACY_PERMISSIONS = rentalPageLegacyPermissions("governance");

export const RENTAL_GOVERNANCE_PAGES = {
  settings: {
    id: "governance",
    path: "/settings",
    title: {
      default: "品类与业务规则",
      translations: { "en-US": "Category & rules" },
    },
    purpose: "configuration",
    permissions: rentalPagePermissions("governance"),
    menu: {
      group: {
        default: "经营基础",
        translations: { "en-US": "Operating setup" },
      },
      order: 10,
    },
  },
} satisfies Record<string, CorePageDescriptor>;
