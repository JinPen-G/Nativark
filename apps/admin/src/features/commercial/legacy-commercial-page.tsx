/** 旧路由绑定同一商业声明，当前身份继续复验原价格管理权限。 */
import { useNavigate, useParams } from "react-router-dom";
import { corePageKey, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import {
  PricingGroupPage,
  RentalCommercialPage,
  CouponPage,
  type RentalCommercialPageContext,
} from "@rental-os/rental-core/admin/commercial";
import {
  RENTAL_COMMERCIAL_CORE_ID,
  RENTAL_COMMERCIAL_LEGACY_PERMISSION,
  RENTAL_COMMERCIAL_PAGES,
} from "@rental-os/rental-core/admin/commercial/pages";
import { resolveAdminBrandName } from "@/app/branding";
import { useAuthStore } from "@/features/auth/authStore";
import { rentalCommercialScopeKey, useLegacyRentalCommercialContext } from "./legacy-commercial-context";

const Pricing = (context: RentalCommercialPageContext) => (
  <RentalCommercialPage {...context} section="pricing" />
);
const Discounts = (context: RentalCommercialPageContext) => (
  <RentalCommercialPage {...context} section="discounts" />
);
const Services = (context: RentalCommercialPageContext) => (
  <RentalCommercialPage {...context} section="services" />
);
const components = {
  pricingGroups: PricingGroupPage,
  pricing: Pricing,
  pricingVersions: Pricing,
  pricingVersionDetail: Pricing,
  discounts: Discounts,
  coupons: CouponPage,
  services: Services,
};
const pages = new Map(
  Object.entries(RENTAL_COMMERCIAL_PAGES).map(([name, descriptor]) => {
    const definition = { ...descriptor, component: components[name as keyof typeof components] };
    const key = corePageKey(RENTAL_COMMERCIAL_CORE_ID, definition.id);
    const page: CoreRegisteredPage<unknown> = {
      key,
      coreId: RENTAL_COMMERCIAL_CORE_ID,
      path: "/rental" + definition.path,
      definition,
    };
    return [key, page];
  }),
);

export function LegacyRentalCommercialPage({
  pageId,
  scope,
}: {
  pageId: keyof typeof components;
  scope: string;
}) {
  const auth = useAuthStore();
  const navigate = useNavigate();
  const matched = useParams();
  const context = useLegacyRentalCommercialContext();
  const descriptor = RENTAL_COMMERCIAL_PAGES[pageId];
  const page = pages.get(corePageKey(RENTAL_COMMERCIAL_CORE_ID, descriptor.id))!;
  const Page = components[pageId];
  const params =
    pageId === "pricingVersionDetail" && matched.sequence !== undefined
      ? { sequence: matched.sequence }
      : undefined;
  return (
    <CorePageHostProvider
      host={{
        page,
        pages,
        navigate,
        params,
        brandName: resolveAdminBrandName(auth.tenant, auth.user),
        lifetimeKey: JSON.stringify([scope, context.scopeKey, params]),
        canAccess: (coreId, permissions) => {
          const current = useAuthStore.getState();
          if (
            !context.scopeKey ||
            rentalCommercialScopeKey(current) !== context.scopeKey ||
            coreId !== RENTAL_COMMERCIAL_CORE_ID
          )
            return false;
          return permissions.every(
            (permission) =>
              permission.resource === "price" &&
              permission.action === "manage" &&
              current.hasPermission(RENTAL_COMMERCIAL_LEGACY_PERMISSION),
          );
        },
      }}
    >
      <Page {...context} />
    </CorePageHostProvider>
  );
}
