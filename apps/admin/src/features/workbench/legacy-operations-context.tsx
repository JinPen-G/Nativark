/** 原工作台和报表绑定同一 Rental 实现，身份、客户预览与文本请求沿原宿主提供。 */
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { corePageKey, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import {
  createRentalOperationsPageContext,
  RentalOperationsPageProvider,
  rentalOperationsPageComponents,
} from "@rental-os/rental-core/admin/operations";
import {
  RENTAL_OPERATIONS_CORE_ID,
  RENTAL_OPERATIONS_PAGES,
  rentalOperationsLegacyPageAllowed,
} from "@rental-os/rental-core/admin/operations/pages";
import { RentalOrdersPage, RentalOrderDetailPage, rentalOrderSessionIdentity, type RentalOrderSession }
  from "@rental-os/rental-core/admin/orders";
import { RENTAL_ORDER_PAGES } from "@rental-os/rental-core/admin/orders/pages";
import { MaintenanceWorkOrdersPage } from "@rental-os/rental-core/admin/work-orders";
import { RENTAL_WORK_ORDER_PAGES } from "@rental-os/rental-core/admin/work-orders/pages";
import { AssetWorkspacePage } from "@rental-os/rental-core/admin/catalog";
import { RENTAL_CATALOG_PAGES } from "@rental-os/rental-core/admin/catalog/pages";
import { adminRuntime } from "@/app/adminRuntime";
import { resolveAdminBrandName } from "@/app/branding";
import { requestText } from "@/api/http";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { useAuthStore } from "@/features/auth/authStore";
import { CustomerPreview } from "@/features/membership/CustomerPreview";

const components = { CustomerPreview };
const pages = new Map<string, CoreRegisteredPage<unknown>>([
  ...Object.values(RENTAL_OPERATIONS_PAGES).map(definition => ({
    coreId: RENTAL_OPERATIONS_CORE_ID,
    path: definition.path,
    definition: { ...definition, component: rentalOperationsPageComponents[definition.id] },
  })),
  ...[
    { ...RENTAL_ORDER_PAGES.orders, component: RentalOrdersPage },
    { ...RENTAL_ORDER_PAGES.orderDetail, component: RentalOrderDetailPage },
    ...Object.values(RENTAL_WORK_ORDER_PAGES).map(definition => ({ ...definition, component: MaintenanceWorkOrdersPage })),
    { ...RENTAL_CATALOG_PAGES.assets, component: AssetWorkspacePage },
  ].map(definition => ({
    coreId: RENTAL_OPERATIONS_CORE_ID,
    path: "/rental" + definition.path,
    definition,
  })),
].map(page => {
  const key = corePageKey(page.coreId, page.definition.id);
  return [key, { ...page, key }];
}));

function sessionSnapshot(auth: ReturnType<typeof useAuthStore.getState>): RentalOrderSession {
  return { sessionVerified: auth.sessionVerified, authenticated: Boolean(auth.token), tenant: auth.tenant,
    user: auth.user, currentWorkspaceId: auth.currentWorkspaceId, hasPermission: auth.hasPermission };
}
const getSession = () => sessionSnapshot(useAuthStore.getState());

export function useLegacyRentalOperationsContext() {
  const auth = useAuthStore();
  const queryScope = useListQueryIdentity();
  const epoch = adminRuntime.currentSessionEpoch();
  return useMemo(() => createRentalOperationsPageContext({
    runtime: adminRuntime,
    requestText,
    session: sessionSnapshot(auth),
    getSession,
    queryScope,
    components,
  }), [auth, queryScope, epoch]);
}

export function LegacyRentalOperationsPageHost({ page: pageName, children }: {
  page: keyof typeof RENTAL_OPERATIONS_PAGES;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const context = useLegacyRentalOperationsContext();
  const page = pages.get(corePageKey(RENTAL_OPERATIONS_CORE_ID, RENTAL_OPERATIONS_PAGES[pageName].id))!;
  const auth = useAuthStore.getState();
  return <CorePageHostProvider host={{
    page,
    pages,
    params: {},
    navigate,
    brandName: resolveAdminBrandName(auth.tenant, auth.user),
    lifetimeKey: rentalOrderSessionIdentity(context.session, adminRuntime.currentSessionEpoch()),
    canAccess: (coreId, permissions) => {
      const current = getSession();
      if (coreId !== RENTAL_OPERATIONS_CORE_ID || !rentalOperationsLegacyPageAllowed(page.definition.id, current))
        return false;
      // 工作台的原 OR 准入只映射基础页面要求，附加动作继续核其原领域权限。
      return permissions.every(permission => page.definition.permissions.some(base =>
        base.resource === permission.resource && base.action === permission.action)
        || current.hasPermission((permission.resource === "maintenance" || permission.resource === "asset"
          ? "rental-core:" : "rental-os:") + permission.resource + ":" + permission.action));
    },
  }}><RentalOperationsPageProvider context={context}>{children}</RentalOperationsPageProvider></CorePageHostProvider>;
}
