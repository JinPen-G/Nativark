/** 原商品与资产路由绑定同源页面声明，主业务及附属读取沿当前身份的正式原权限映射复验。 */
import { useNavigate } from "react-router-dom";
import { corePageKey, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import { CatalogPage, AssetWorkspacePage } from "@rental-os/rental-core/admin/catalog";
import {
  RENTAL_CATALOG_CORE_ID,
  RENTAL_CATALOG_PAGES,
} from "@rental-os/rental-core/admin/catalog/pages";
import { rentalOriginalPermissionCode } from "@rental-os/rental-core/permissions";
import { resolveAdminBrandName } from "@/app/branding";
import { useAuthStore } from "@/features/auth/authStore";
import { rentalCatalogScopeKey, useLegacyRentalCatalogContext } from "./legacy-catalog-context";

const definitions = {
  catalog: { ...RENTAL_CATALOG_PAGES.catalog, component: CatalogPage },
  assets: { ...RENTAL_CATALOG_PAGES.assets, component: AssetWorkspacePage },
};
const pages = new Map(
  Object.values(definitions).map((definition) => {
    const key = corePageKey(RENTAL_CATALOG_CORE_ID, definition.id);
    const page: CoreRegisteredPage<unknown> = {
      key,
      coreId: RENTAL_CATALOG_CORE_ID,
      path: "/rental" + definition.path,
      definition,
    };
    return [key, page];
  }),
);
export function LegacyRentalCatalogPage({
  pageId,
  scope,
}: {
  pageId: keyof typeof definitions;
  scope: string;
}) {
  const auth = useAuthStore();
  const navigate = useNavigate();
  const context = useLegacyRentalCatalogContext();
  const definition = definitions[pageId];
  const page = pages.get(corePageKey(RENTAL_CATALOG_CORE_ID, definition.id))!;
  const Page = definition.component;
  return (
    <CorePageHostProvider
      host={{
        page,
        pages,
        navigate,
        brandName: resolveAdminBrandName(auth.tenant, auth.user),
        lifetimeKey: JSON.stringify([scope, context.scopeKey]),
        canAccess: (coreId, permissions) => {
          const current = useAuthStore.getState();
          if (
            !context.scopeKey ||
            rentalCatalogScopeKey(current) !== context.scopeKey ||
            coreId !== RENTAL_CATALOG_CORE_ID
          )
            return false;
          return permissions.every((permission) => {
            const original = rentalOriginalPermissionCode(
              `${coreId}:${permission.resource}:${permission.action}`,
            );
            return original !== undefined && current.hasPermission(original);
          });
        },
      }}
    >
      <Page {...context} />
    </CorePageHostProvider>
  );
}
