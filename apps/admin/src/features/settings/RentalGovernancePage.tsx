/** 原 /rental/settings 绑定治理声明与同源正文，当前身份复验原入口权限。 */
import { useNavigate } from "react-router-dom";
import { corePageKey, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import {
  RentalGovernancePage as RentalPage,
  createRentalGovernanceAdminContribution,
} from "@rental-os/rental-core/admin/governance";
import {
  RENTAL_GOVERNANCE_CORE_ID,
  RENTAL_GOVERNANCE_PAGES,
  RENTAL_GOVERNANCE_LEGACY_PERMISSIONS,
} from "@rental-os/rental-core/admin/governance/pages";
import { createRentalCommercialAdminContribution } from "@rental-os/rental-core/admin/commercial";
import {
  RENTAL_COMMERCIAL_CORE_ID,
  RENTAL_COMMERCIAL_LEGACY_PERMISSION,
} from "@rental-os/rental-core/admin/commercial/pages";
import { useLegacyRentalCommercialContext } from "@/features/commercial/legacy-commercial-context";
import { rentalCatalogScopeKey } from "@/features/catalog/legacy-catalog-context";
import { useAuthStore } from "@/features/auth/authStore";
import { resolveAdminBrandName } from "@/app/branding";
import { useLegacyRentalGovernanceContext } from "./legacy-governance-context";

const governance = createRentalGovernanceAdminContribution("0.1.0", useLegacyRentalGovernanceContext);
const commercial = createRentalCommercialAdminContribution("0.1.0", useLegacyRentalCommercialContext);
const pages = new Map<string, CoreRegisteredPage<unknown>>(
  [...governance.pages, ...commercial.pages].map((definition) => {
    const key = corePageKey(RENTAL_GOVERNANCE_CORE_ID, definition.id);
    return [key, { key, coreId: RENTAL_GOVERNANCE_CORE_ID, path: "/rental" + definition.path, definition }];
  }),
);

export function RentalGovernancePage() {
  const auth = useAuthStore();
  const navigate = useNavigate();
  const context = useLegacyRentalGovernanceContext();
  const page = pages.get(corePageKey(RENTAL_GOVERNANCE_CORE_ID, RENTAL_GOVERNANCE_PAGES.settings.id))!;
  return (
    <CorePageHostProvider
      host={{
        page,
        pages,
        navigate,
        brandName: resolveAdminBrandName(auth.tenant, auth.user),
        lifetimeKey: context.scopeKey,
        canAccess: (coreId, permissions) => {
          const current = useAuthStore.getState();
          if (
            !context.scopeKey ||
            rentalCatalogScopeKey(current) !== context.scopeKey ||
            coreId !== RENTAL_GOVERNANCE_CORE_ID
          )
            return false;
          return permissions.every((permission) => {
            if (permission.resource === "governance" && permission.action === "view")
              return RENTAL_GOVERNANCE_LEGACY_PERMISSIONS.some((code) => current.hasPermission(code));
            if (
              coreId === RENTAL_COMMERCIAL_CORE_ID &&
              permission.resource === "price" &&
              permission.action === "manage"
            )
              return current.hasPermission(RENTAL_COMMERCIAL_LEGACY_PERMISSION);
            return false;
          });
        },
      }}
    >
      <RentalPage {...context} />
    </CorePageHostProvider>
  );
}
