/** 原开业入口绑定同一状态正文，配置跳转复用原路由的角色、能力、品类与会员范围。 */
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { corePageKey, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import {
  createRentalSetupPageContext,
  RentalSetupPageProvider,
  RENTAL_SETUP_CORE_ID,
  RENTAL_SETUP_PAGES,
  TenantReadinessPage,
} from "@rental-os/rental-core/admin/setup";
import { rentalOrderSessionIdentity, type RentalOrderSession } from "@rental-os/rental-core/admin/orders";
import { WorkbenchPage, RENTAL_OPERATIONS_PAGES } from "@rental-os/rental-core/admin/operations";
import { LocationPage, RENTAL_LOCATION_PAGES } from "@rental-os/rental-core/admin/locations";
import { RentalGovernancePage, RENTAL_GOVERNANCE_PAGES } from "@rental-os/rental-core/admin/governance";
import { CatalogPage, RENTAL_CATALOG_PAGES } from "@rental-os/rental-core/admin/catalog";
import { PricingGroupPage, RentalCommercialPage, RENTAL_COMMERCIAL_PAGES } from "@rental-os/rental-core/admin/commercial";
import { MembershipPlanPage, RENTAL_MEMBERSHIP_PAGES } from "@rental-os/rental-core/admin/membership";
import { adminRuntime } from "@/app/adminRuntime";
import { resolveAdminBrandName } from "@/app/branding";
import { APP_ROUTES, canAccessRoute, type AppRouteDefinition } from "@/app/navigation";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { useAuthStore } from "@/features/auth/authStore";

const sources = [
  { definition: RENTAL_SETUP_PAGES.tenantReadiness, component: TenantReadinessPage, route: APP_ROUTES.tenantReadiness },
  { definition: RENTAL_OPERATIONS_PAGES.workbench, component: WorkbenchPage, route: APP_ROUTES.workbench },
  { definition: RENTAL_LOCATION_PAGES.locations, component: LocationPage, route: APP_ROUTES.locations },
  { definition: RENTAL_GOVERNANCE_PAGES.settings, component: RentalGovernancePage, route: APP_ROUTES.rentalSettings },
  { definition: RENTAL_CATALOG_PAGES.catalog, component: CatalogPage, route: APP_ROUTES.itemGroups },
  { definition: RENTAL_COMMERCIAL_PAGES.pricingGroups, component: PricingGroupPage, route: APP_ROUTES.pricingGroups },
  { definition: RENTAL_COMMERCIAL_PAGES.pricing, component: RentalCommercialPage, route: APP_ROUTES.pricing },
  { definition: RENTAL_MEMBERSHIP_PAGES.plans, component: MembershipPlanPage, route: APP_ROUTES.membershipPlans },
];
const pages = new Map<string, CoreRegisteredPage<unknown>>(sources.map(source => {
  const key = corePageKey(RENTAL_SETUP_CORE_ID, source.definition.id);
  return [key, { key, coreId: RENTAL_SETUP_CORE_ID, path: source.route.path,
    definition: { ...source.definition, component: source.component } }];
}));

function sessionSnapshot(auth: ReturnType<typeof useAuthStore.getState>): RentalOrderSession {
  return { sessionVerified: auth.sessionVerified, authenticated: Boolean(auth.token), tenant: auth.tenant,
    user: auth.user, currentWorkspaceId: auth.currentWorkspaceId, hasPermission: auth.hasPermission };
}
const getSession = () => sessionSnapshot(useAuthStore.getState());

function routeAllowed(route: AppRouteDefinition) {
  const current = useAuthStore.getState();
  return canAccessRoute(route, current.hasPermission, current.hasCapability,
    current.tenant?.categoryCode, Boolean(current.user?.isSaasAdmin), current.hasTenantMembershipPermission);
}

export function useLegacyRentalSetupContext() {
  const auth = useAuthStore();
  const queryScope = useListQueryIdentity();
  const navigate = useNavigate();
  const epoch = adminRuntime.currentSessionEpoch();
  return useMemo(() => createRentalSetupPageContext({
    runtime: adminRuntime, session: sessionSnapshot(auth), getSession, queryScope,
    accounts: {
      canOpen: () => routeAllowed(APP_ROUTES.tenantAccounts),
      open: () => navigate(APP_ROUTES.tenantAccounts.path),
    },
  }), [auth, queryScope, navigate, epoch]);
}

export function LegacyRentalSetupPageHost({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const context = useLegacyRentalSetupContext();
  const auth = useAuthStore.getState();
  const page = pages.get(corePageKey(RENTAL_SETUP_CORE_ID, RENTAL_SETUP_PAGES.tenantReadiness.id))!;
  return <CorePageHostProvider host={{
    page, pages, navigate,
    brandName: resolveAdminBrandName(auth.tenant, auth.user),
    lifetimeKey: rentalOrderSessionIdentity(context.session, adminRuntime.currentSessionEpoch()),
    canAccess: (coreId, permissions) => coreId === RENTAL_SETUP_CORE_ID && context.isCurrent()
      && sources.some(source => permissions.every(permission => source.definition.permissions.some(base =>
        base.resource === permission.resource && base.action === permission.action)) && routeAllowed(source.route)),
  }}><RentalSetupPageProvider context={context}>{children}</RentalSetupPageProvider></CorePageHostProvider>;
}
