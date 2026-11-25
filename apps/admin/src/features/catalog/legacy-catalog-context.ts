/** 原宿主供给真实会话和唯一鉴权传输，商品、资产和订单照片使用同一范围。 */
import { useMemo } from "react";
import { createRentalCatalogPageContext } from "@rental-os/rental-core/admin/catalog/context";
import { rentalOrderSessionIdentity, type RentalOrderSession } from "@rental-os/rental-core/admin/orders";
import { adminRuntime } from "@/app/adminRuntime";
import { requestRentalCatalogImage } from "@/api/rentalCore";
import { useAuthStore } from "@/features/auth/authStore";

export function rentalCatalogScopeKey(auth: ReturnType<typeof useAuthStore.getState>): string | undefined {
  if (
    !auth.sessionVerified ||
    !auth.token ||
    !auth.tenant?.tenantId ||
    !auth.currentWorkspaceId ||
    !auth.user?.id
  )
    return undefined;
  const session: RentalOrderSession = {
    sessionVerified: auth.sessionVerified,
    authenticated: Boolean(auth.token),
    tenant: auth.tenant,
    user: auth.user,
    currentWorkspaceId: auth.currentWorkspaceId,
    hasPermission: auth.hasPermission,
  };
  return rentalOrderSessionIdentity(session, adminRuntime.currentSessionEpoch());
}
const currentScopeKey = () => rentalCatalogScopeKey(useAuthStore.getState());
export function useLegacyRentalCatalogContext() {
  const auth = useAuthStore();
  const scopeKey = rentalCatalogScopeKey(auth) ?? "";
  return useMemo(
    () =>
      createRentalCatalogPageContext({
        runtime: adminRuntime,
        requestImage: requestRentalCatalogImage,
        scopeKey,
        currentScopeKey,
      }),
    [scopeKey],
  );
}
