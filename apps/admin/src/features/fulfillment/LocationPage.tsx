/** 原地点入口绑定真实会话、品类读取和组织映射权限，履约网络正文由 Rental Core 单源提供。 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { corePageKey, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import { LocationPage as RentalLocationPage, createRentalLocationPageContext }
  from "@rental-os/rental-core/admin/locations";
import { RENTAL_LOCATION_CORE_ID, RENTAL_LOCATION_PAGES, RENTAL_LOCATION_LEGACY_PERMISSIONS }
  from "@rental-os/rental-core/admin/locations/pages";
import { rentalOrderSessionIdentity, type RentalOrderSession } from "@rental-os/rental-core/admin/orders";
import { adminRuntime } from "@/app/adminRuntime";
import { resolveAdminBrandName } from "@/app/branding";
import { useAuthStore } from "@/features/auth/authStore";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";

const definition = RENTAL_LOCATION_PAGES.locations;
const pageKey = corePageKey(RENTAL_LOCATION_CORE_ID, definition.id);
const page: CoreRegisteredPage<unknown> = {
  key: pageKey, coreId: RENTAL_LOCATION_CORE_ID, path: "/rental" + definition.path,
  definition: { ...definition, component: RentalLocationPage }
};
const pages = new Map([[pageKey, page]]);

function locationScopeKey(auth: ReturnType<typeof useAuthStore.getState>): string | undefined {
  if (!auth.sessionVerified || !auth.token || !auth.tenant?.tenantId || !auth.currentWorkspaceId || !auth.user?.id)
    return undefined;
  const session: RentalOrderSession = { sessionVerified: auth.sessionVerified, authenticated: Boolean(auth.token),
    tenant: auth.tenant, user: auth.user, currentWorkspaceId: auth.currentWorkspaceId, hasPermission: auth.hasPermission };
  return rentalOrderSessionIdentity(session, adminRuntime.currentSessionEpoch());
}
const currentScopeKey = () => locationScopeKey(useAuthStore.getState());
const canViewProfile = () => ["rental-os:order:view", "rental-core:catalog:view", "rental-core:asset:view"]
  .some(permission => useAuthStore.getState().hasPermission(permission));
const canViewCategories = () => canViewProfile() || useAuthStore.getState().hasPermission("system:tenant:manage");
const canViewOrganizations = () => useAuthStore.getState().hasPermission("system:user:manage");
const canManageOrganizationMapping = () => {
  const auth = useAuthStore.getState();
  return auth.user?.dataScope === "all" && auth.user.locationScope?.mode !== "selected"
    && auth.hasPermission("system:user:manage");
};

export function LocationPage() {
  const scope = useListQueryIdentity();
  return <LocationWorkspace key={scope} scope={scope} />;
}

function LocationWorkspace({ scope }: { scope: string }) {
  const auth = useAuthStore();
  const navigate = useNavigate();
  const scopeKey = locationScopeKey(auth) ?? "";
  const context = useMemo(() => createRentalLocationPageContext({ runtime: adminRuntime, scopeKey,
    currentScopeKey, canViewProfile, canViewCategories, canViewOrganizations, canManageOrganizationMapping }), [scopeKey]);
  return <CorePageHostProvider host={{ page, pages, navigate,
    brandName: resolveAdminBrandName(auth.tenant, auth.user), lifetimeKey: JSON.stringify([scope, scopeKey]),
    canAccess: (coreId, permissions) => {
      const current = useAuthStore.getState();
      if (!scopeKey || locationScopeKey(current) !== scopeKey || coreId !== RENTAL_LOCATION_CORE_ID) return false;
      return permissions.every(permission => {
        if (permission.resource !== "station") return false;
        if (permission.action === "view") return current.hasPermission(RENTAL_LOCATION_LEGACY_PERMISSIONS.view);
        return permission.action === "manage" && current.hasPermission(RENTAL_LOCATION_LEGACY_PERMISSIONS.manage);
      });
    }
  }}><RentalLocationPage {...context} /></CorePageHostProvider>;
}
