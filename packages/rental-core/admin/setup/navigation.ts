/** 服务端开业项对应受控登记目标，公开账号入口由宿主按当前权限供给。 */
import type { CorePageLocation } from "@rental-os/core-contracts";
import type { TenantReadinessItem } from "@rental-os/rental-core";
import { RENTAL_CATALOG_PAGES } from "../catalog/pages";
import { RENTAL_COMMERCIAL_PAGES } from "../commercial/pages";
import { RENTAL_GOVERNANCE_PAGES } from "../governance/pages";
import { RENTAL_LOCATION_PAGES } from "../locations/pages";
import { RENTAL_MEMBERSHIP_PAGES } from "../membership/pages";
import { RENTAL_OPERATIONS_PAGES } from "../operations/pages";

export type RentalSetupItemTarget =
  | { kind: "core"; nextHref: string; to: CorePageLocation }
  | { kind: "accounts"; nextHref: string };

const itemTargets: Readonly<Record<string, RentalSetupItemTarget>> = {
  workspace_profile: {
    kind: "core", nextHref: "/workbench",
    to: { coreId: "rental", pageId: RENTAL_OPERATIONS_PAGES.workbench.id },
  },
  accounts_roles: { kind: "accounts", nextHref: "/tenant/accounts" },
  fulfillment_network: {
    kind: "core", nextHref: "/rental/locations",
    to: { coreId: "rental", pageId: RENTAL_LOCATION_PAGES.locations.id },
  },
  business_rule: {
    kind: "core", nextHref: "/rental/settings",
    to: { coreId: "rental", pageId: RENTAL_GOVERNANCE_PAGES.settings.id },
  },
  business_calendar: {
    kind: "core", nextHref: "/rental/settings",
    to: { coreId: "rental", pageId: RENTAL_GOVERNANCE_PAGES.settings.id },
  },
  item_groups: {
    kind: "core", nextHref: "/rental/item-groups",
    to: { coreId: "rental", pageId: RENTAL_CATALOG_PAGES.catalog.id },
  },
  pricing_groups_rates: {
    kind: "core", nextHref: "/rental/pricing-groups",
    to: { coreId: "rental", pageId: RENTAL_COMMERCIAL_PAGES.pricingGroups.id },
  },
  price_version: {
    kind: "core", nextHref: "/rental/pricing",
    to: { coreId: "rental", pageId: RENTAL_COMMERCIAL_PAGES.pricing.id },
  },
  membership_base: {
    kind: "core", nextHref: "/membership/plans",
    to: { coreId: "rental", pageId: RENTAL_MEMBERSHIP_PAGES.plans.id },
  },
};

export function rentalSetupItemTarget(item: Pick<TenantReadinessItem, "key" | "nextHref">) {
  const target = Object.hasOwn(itemTargets, item.key) ? itemTargets[item.key] : undefined;
  return target?.nextHref === item.nextHref ? target : undefined;
}
