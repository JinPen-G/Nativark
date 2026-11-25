/** 原 Rental 宿主将真实会话、经营空间和管理权限回退绑定到同源能力页。 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { corePageKey, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import { CapabilityGovernancePage as RentalCapabilityGovernancePage, createRentalCapabilityPageContext }
  from "@rental-os/rental-core/admin/capabilities";
import { RENTAL_CAPABILITY_CORE_ID, RENTAL_CAPABILITY_PAGES, RENTAL_CAPABILITY_LEGACY_PERMISSIONS }
  from "@rental-os/rental-core/admin/capabilities/pages";
import { rentalOrderSessionIdentity, type RentalOrderSession } from "@rental-os/rental-core/admin/orders";
import { adminRuntime } from "@/app/adminRuntime";
import { resolveAdminBrandName } from "@/app/branding";
import { useAuthStore } from "@/features/auth/authStore";

const definition = RENTAL_CAPABILITY_PAGES.capabilities;
const pageKey = corePageKey(RENTAL_CAPABILITY_CORE_ID, definition.id);
const page: CoreRegisteredPage<unknown> = {
  key: pageKey, coreId: RENTAL_CAPABILITY_CORE_ID, path: "/rental" + definition.path,
  definition: { ...definition, component: RentalCapabilityGovernancePage }
};
const pages = new Map([[pageKey, page]]);

function capabilityScopeKey(auth: ReturnType<typeof useAuthStore.getState>): string | undefined {
  if (!auth.sessionVerified || !auth.token || !auth.tenant?.tenantId || !auth.currentWorkspaceId || !auth.user?.id)
    return undefined;
  const session: RentalOrderSession = { sessionVerified: auth.sessionVerified, authenticated: Boolean(auth.token),
    tenant: auth.tenant, user: auth.user, currentWorkspaceId: auth.currentWorkspaceId, hasPermission: auth.hasPermission };
  return rentalOrderSessionIdentity(session, adminRuntime.currentSessionEpoch());
}
const currentScopeKey = () => capabilityScopeKey(useAuthStore.getState());
const refreshSession = () => useAuthStore.getState().bootstrap();

export function CapabilityGovernancePage() {
  const auth = useAuthStore();
  const navigate = useNavigate();
  const scopeKey = capabilityScopeKey(auth) ?? "";
  const context = useMemo(() => createRentalCapabilityPageContext({ runtime: adminRuntime, scopeKey,
    currentScopeKey, refreshSession }), [scopeKey]);
  return <CorePageHostProvider host={{ page, pages, navigate,
    brandName: resolveAdminBrandName(auth.tenant, auth.user), lifetimeKey: scopeKey,
    canAccess: (coreId, permissions) => {
      const current = useAuthStore.getState();
      if (!scopeKey || capabilityScopeKey(current) !== scopeKey || coreId !== RENTAL_CAPABILITY_CORE_ID) return false;
      return permissions.every(permission => {
        if (permission.resource !== "capability") return false;
        if (permission.action === "view") return current.hasPermission(RENTAL_CAPABILITY_LEGACY_PERMISSIONS.view)
          || current.hasPermission(RENTAL_CAPABILITY_LEGACY_PERMISSIONS.manage);
        return permission.action === "manage" && current.hasPermission(RENTAL_CAPABILITY_LEGACY_PERMISSIONS.manage);
      });
    }
  }}><RentalCapabilityGovernancePage {...context} /></CorePageHostProvider>;
}
