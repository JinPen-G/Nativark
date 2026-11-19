/** 治理入口聚合原读取权限，页签和实际动作继续使用各自的经营权限。 */
import type { CorePageDescriptor } from "@rental-os/core-contracts";

export const RENTAL_GOVERNANCE_CORE_ID = "rental";
export const RENTAL_GOVERNANCE_ACCESS = [{ resource: "governance", action: "view" }];
export const RENTAL_GOVERNANCE_LEGACY_PERMISSIONS = [
  "rental-os:price:manage",
  "rental-os:calendar:edit",
  "rental-os:calendar:publish",
  "rental-os:calendar:view-history",
  "rental-os:rules:manage",
  "rental-os:rules:publish",
  "system:integration:manage",
];

export const RENTAL_GOVERNANCE_PAGES = {
  settings: {
    id: "governance",
    path: "/settings",
    title: {
      default: "品类与业务规则",
      translations: { "en-US": "Category & rules" },
    },
    purpose: "configuration",
    permissions: RENTAL_GOVERNANCE_ACCESS,
    menu: {
      group: {
        default: "经营基础",
        translations: { "en-US": "Operating setup" },
      },
      order: 10,
    },
  },
} satisfies Record<string, CorePageDescriptor>;
