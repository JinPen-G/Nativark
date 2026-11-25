/** 原 Rental 宿主绑定同源订单页，沿已验证会话、原 HTTP 与原引用库提供业务接点。 */
import { useMemo, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { corePageKey, resolveCorePageLocation, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";
import { readSettingsReference, retainSettingsReference, clearSettingsReference } from "@rental-os/platform-admin/forms";
import {
  createRentalOrderPageContext, RentalOrderPageContextProvider, rentalOrderSessionIdentity,
  RentalOrdersPage, RentalOrderDetailPage, RentalOrderCreatePage,
  type RentalOrderOperationContext, type RentalOrderReferenceJournal, type RentalOrderSession
} from "@rental-os/rental-core/admin/orders";
import { RENTAL_ORDER_CORE_ID, RENTAL_ORDER_PAGES, RENTAL_ORDER_LEGACY_PERMISSIONS, rentalOrderLocation, rentalOrderCreateLocation }
  from "@rental-os/rental-core/admin/orders/pages";
import { MaintenanceWorkOrdersPage } from "@rental-os/rental-core/admin/work-orders";
import { RENTAL_WORK_ORDER_PAGES, RENTAL_WORK_ORDER_LEGACY_PERMISSIONS, rentalWorkOrderLocation }
  from "@rental-os/rental-core/admin/work-orders/pages";
import { adminRuntime } from "@/app/adminRuntime";
import { resolveAdminBrandName } from "@/app/branding";
import { useAuthStore } from "@/features/auth/authStore";
import { CustomerPreview } from "@/features/membership/CustomerPreview";
import { ItemGroupPhoto } from "@/features/catalog/ItemGroupPhoto";
import { OrderFactsEntry } from "@/features/ai-native/OrderFactsEntry";

const references: RentalOrderReferenceJournal = {
  read: readSettingsReference, retain: retainSettingsReference, clear: clearSettingsReference
};
const components = { CustomerPreview, ItemGroupPhoto, OrderFactsEntry };
const orderComponents = {
  [RENTAL_ORDER_PAGES.orders.id]: RentalOrdersPage,
  [RENTAL_ORDER_PAGES.orderCreate.id]: RentalOrderCreatePage,
  [RENTAL_ORDER_PAGES.orderDetail.id]: RentalOrderDetailPage
};
const pages = new Map<string, CoreRegisteredPage<unknown>>([
  ...Object.values(RENTAL_ORDER_PAGES).map(definition => ({ definition,
    component: orderComponents[definition.id] })),
  ...Object.values(RENTAL_WORK_ORDER_PAGES).map(definition => ({ definition, component: MaintenanceWorkOrdersPage }))
].map(({ definition, component }) => {
  const key = corePageKey(RENTAL_ORDER_CORE_ID, definition.id);
  return [key, { key, coreId: RENTAL_ORDER_CORE_ID, path: `/rental${definition.path}`, definition: { ...definition, component } }];
}));

function sessionSnapshot(auth: ReturnType<typeof useAuthStore.getState>): RentalOrderSession {
  return { sessionVerified: auth.sessionVerified, authenticated: Boolean(auth.token), tenant: auth.tenant, user: auth.user,
    currentWorkspaceId: auth.currentWorkspaceId, hasPermission: auth.hasPermission };
}
const getSession = () => sessionSnapshot(useAuthStore.getState());
// 原换货链已封存操作键，公共单次派发模式保留原查询和收据核对入口。
const requestOriginal: AdminRuntime["request"] = <Output,>(path: string, options = {}): Promise<Output> =>
  adminRuntime.request<Output>(path, { ...options, retryAuthentication: false });

export function useLegacyRentalOrderOperations(): RentalOrderOperationContext {
  const auth = useAuthStore();
  return useMemo(() => ({ session: sessionSnapshot(auth), runtime: adminRuntime, getSession, requestOriginal }), [auth]);
}

export function LegacyRentalOrderPageHost({ orderId, page: pageName, children }: {
  orderId?: string; page?: keyof typeof RENTAL_ORDER_PAGES; children: ReactNode
}) {
  const route = useParams<{ id: string }>();
  const id = orderId ?? route.id;
  const navigate = useNavigate();
  const operations = useLegacyRentalOrderOperations();
  const epoch = adminRuntime.currentSessionEpoch();
  const context = useMemo(() => createRentalOrderPageContext({ ...operations, references, components, navigation: {
    openOrder: (targetId, action) => {
      const path = resolveCorePageLocation(pages, rentalOrderLocation(targetId));
      navigate(action ? `${path}?action=${encodeURIComponent(action)}` : path);
    },
    createOrder: () => navigate(resolveCorePageLocation(pages, rentalOrderCreateLocation())),
    openWorkOrders: () => navigate(resolveCorePageLocation(pages, rentalWorkOrderLocation()))
  } }), [operations, navigate, epoch]);
  const page = pages.get(corePageKey(RENTAL_ORDER_CORE_ID, RENTAL_ORDER_PAGES[pageName ?? (id ? "orderDetail" : "orders")].id))!;
  const auth = useAuthStore.getState();
  return <CorePageHostProvider host={{ page, pages, params: id ? { id } : {}, navigate,
    brandName: resolveAdminBrandName(auth.tenant, auth.user),
    lifetimeKey: JSON.stringify([rentalOrderSessionIdentity(context.session, epoch), id]),
    canAccess: (coreId, permissions) => {
      const current = useAuthStore.getState();
      return current.sessionVerified && Boolean(current.token) && coreId === RENTAL_ORDER_CORE_ID && permissions.every(permission => {
        const mapping = permission.resource === "order" ? RENTAL_ORDER_LEGACY_PERMISSIONS
          : permission.resource === "maintenance" ? RENTAL_WORK_ORDER_LEGACY_PERMISSIONS : undefined;
        const code = mapping?.[permission.action];
        return Boolean(code) && current.hasPermission(code);
      });
    }
  }}><RentalOrderPageContextProvider context={context}>{children}</RentalOrderPageContextProvider></CorePageHostProvider>;
}
