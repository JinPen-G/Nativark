/** 原营运宿主为 Rental 同源工单页供给已验证会话、原权限和旧深链接。 */
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import { corePageKey } from "@rental-os/core-contracts";
import {
  MaintenanceWorkOrdersPage as RentalMaintenanceWorkOrdersPage
} from "@rental-os/rental-core/admin/work-orders";
import { RENTAL_WORK_ORDER_CORE_ID, RENTAL_WORK_ORDER_PAGES, RENTAL_WORK_ORDER_LEGACY_PERMISSIONS }
  from "@rental-os/rental-core/admin/work-orders/pages";
import { useNavigate, useParams } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { resolveAdminBrandName } from "@/app/branding";
import { currentSessionEpoch } from "@/app/queryClient";
import { useAuthStore } from "@/features/auth/authStore";

const pages = new Map(Object.values(RENTAL_WORK_ORDER_PAGES).map(definition => {
  const key = corePageKey(RENTAL_WORK_ORDER_CORE_ID, definition.id);
  return [key, {
    key, coreId: RENTAL_WORK_ORDER_CORE_ID, path: `/rental${definition.path}`,
    definition: { ...definition, component: RentalMaintenanceWorkOrdersPage }
  }] as const;
}));

export function MaintenanceWorkOrdersPage() {
  const navigate = useNavigate();
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const tenant = useAuthStore(state => state.tenant);
  const user = useAuthStore(state => state.user);
  const scopeKey = useAuthStore(state => JSON.stringify([
    state.tenant?.tenantId, state.currentWorkspaceId, state.user?.id, state.user?.permissions,
    state.user?.dataScope, state.user?.locationScope
  ]));
  const manage = useAuthStore(state => state.hasPermission("rental-core:maintenance:manage"));
  const review = useAuthStore(state => state.hasPermission("rental-core:maintenance:review"));
  const viewOrders = useAuthStore(state => state.hasPermission("rental-os:order:view"));
  const restore = useAuthStore(state => state.hasPermission("rental-core:maintenance:review") || state.hasPermission("rental-core:asset:manage"));
  const definition = workOrderId ? RENTAL_WORK_ORDER_PAGES.workOrderDetail : RENTAL_WORK_ORDER_PAGES.workOrders;
  const page = pages.get(corePageKey(RENTAL_WORK_ORDER_CORE_ID, definition.id))!;
  const epoch = currentSessionEpoch();
  return <CorePageHostProvider host={{
    page, pages, brandName: resolveAdminBrandName(tenant, user),
    lifetimeKey: JSON.stringify([epoch, scopeKey, workOrderId, user?.isPlatformAdmin, user?.isSaasAdmin, user?.organizationId]),
    params: workOrderId ? { workOrderId } : {}, navigate,
    // 旧路由只消费原 AuthStore 的实际权限；未知 Core/资源/动作保持不可访问。
    canAccess: (coreId, permissions) => {
      const session = useAuthStore.getState();
      return session.sessionVerified && coreId === RENTAL_WORK_ORDER_CORE_ID && permissions.every(permission =>
        permission.resource === "maintenance" && Boolean(RENTAL_WORK_ORDER_LEGACY_PERMISSIONS[permission.action])
        && session.hasPermission(RENTAL_WORK_ORDER_LEGACY_PERMISSIONS[permission.action])
      );
    }
  }}><RentalMaintenanceWorkOrdersPage api={rentalCoreApi} permissions={{ manage, review, viewOrders, restore }} scopeKey={scopeKey}
    currentScopeKey={() => {
      if (currentSessionEpoch() !== epoch) return undefined;
      const session = useAuthStore.getState();
      return JSON.stringify([session.tenant?.tenantId, session.currentWorkspaceId, session.user?.id,
        session.user?.permissions, session.user?.dataScope, session.user?.locationScope]);
    }} openOrder={id => navigate(`/rental/orders/${encodeURIComponent(id)}`)} /></CorePageHostProvider>;
}
