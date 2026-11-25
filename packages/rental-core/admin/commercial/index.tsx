/** Rental 商业页面复用原表单、价格对比和卡片，宿主供给当前上下文。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { PricingGroupPage } from "./PricingGroupPage";
import { RentalCommercialPage } from "./RentalCommercialPage";
import { CouponPage } from "./CouponPage";
import type { RentalCommercialPageContext } from "./page-context";
import { RENTAL_COMMERCIAL_CORE_ID, RENTAL_COMMERCIAL_PAGES } from "./pages";

export * from "./client";
export * from "./page-context";
export * from "./pages";
export { rentalCommercialMessages } from "./messages";
export { PricingGroupPage } from "./PricingGroupPage";
export { RentalCommercialPage, type RentalCommercialSection } from "./RentalCommercialPage";
export { CouponPage } from "./CouponPage";
export { usePriceVersions, PRICE_VERSIONS_QUERY_KEY, priceVersionQueryKey } from "./usePriceVersions";
export { toPricingGroupRequest, type PricingGroupFormValues } from "./pricing-group-initial-rate";

export function createRentalCommercialAdminContribution(
  implementationVersion: string,
  usePageContext: () => RentalCommercialPageContext,
): CoreAdminContribution<CoreRouteComponent> {
  const Groups: CoreRouteComponent = () => <PricingGroupPage {...usePageContext()} />;
  const Pricing: CoreRouteComponent = () => <RentalCommercialPage {...usePageContext()} section="pricing" />;
  const Discounts: CoreRouteComponent = () => (
    <RentalCommercialPage {...usePageContext()} section="discounts" />
  );
  const Coupons: CoreRouteComponent = () => <CouponPage {...usePageContext()} />;
  const Services: CoreRouteComponent = () => (
    <RentalCommercialPage {...usePageContext()} section="services" />
  );
  return {
    coreId: RENTAL_COMMERCIAL_CORE_ID,
    implementationVersion,
    pages: [
      { ...RENTAL_COMMERCIAL_PAGES.pricingGroups, component: Groups },
      { ...RENTAL_COMMERCIAL_PAGES.pricing, component: Pricing },
      { ...RENTAL_COMMERCIAL_PAGES.pricingVersions, component: Pricing },
      { ...RENTAL_COMMERCIAL_PAGES.pricingVersionDetail, component: Pricing },
      { ...RENTAL_COMMERCIAL_PAGES.discounts, component: Discounts },
      { ...RENTAL_COMMERCIAL_PAGES.coupons, component: Coupons },
      { ...RENTAL_COMMERCIAL_PAGES.services, component: Services },
    ],
  };
}
