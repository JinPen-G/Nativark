/** 原宿主沿同一 Rental 会话身份和鉴权图片传输供给商业上下文。 */
import { useMemo } from "react";
import { createRentalCommercialPageContext } from "@rental-os/rental-core/admin/commercial/context";
import { rentalCatalogScopeKey } from "../catalog/legacy-catalog-context";
import { adminRuntime } from "@/app/adminRuntime";
import { requestRentalCatalogImage } from "@/api/rentalCore";
import { useAuthStore } from "@/features/auth/authStore";

export const rentalCommercialScopeKey = rentalCatalogScopeKey;
const currentScopeKey = () => rentalCommercialScopeKey(useAuthStore.getState());
export function useLegacyRentalCommercialContext() {
  const auth = useAuthStore();
  const scopeKey = rentalCommercialScopeKey(auth) ?? "";
  return useMemo(
    () =>
      createRentalCommercialPageContext({
        runtime: adminRuntime,
        requestImage: requestRentalCatalogImage,
        scopeKey,
        currentScopeKey,
      }),
    [scopeKey],
  );
}
