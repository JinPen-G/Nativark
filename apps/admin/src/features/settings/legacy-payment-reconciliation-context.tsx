/** 原对账 URL 和财务权限绑定同源页面，当前批次随已匹配路由进入 Core 宿主。 */
import { useMemo, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { corePageKey, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import {
  createRentalPaymentReconciliationPageContext,
  PaymentReconciliationPage,
  RentalPaymentReconciliationPageProvider,
  RENTAL_PAYMENT_RECONCILIATION_CORE_ID,
  RENTAL_PAYMENT_RECONCILIATION_PAGES,
} from "@rental-os/rental-core/admin/payment-reconciliation";
import { rentalOrderSessionIdentity, type RentalOrderSession } from "@rental-os/rental-core/admin/orders";
import { adminRuntime } from "@/app/adminRuntime";
import { resolveAdminBrandName } from "@/app/branding";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { useAuthStore } from "@/features/auth/authStore";

const pages = new Map<string, CoreRegisteredPage<unknown>>(
  Object.values(RENTAL_PAYMENT_RECONCILIATION_PAGES).map(definition => {
    const key = corePageKey(RENTAL_PAYMENT_RECONCILIATION_CORE_ID, definition.id);
    return [key, {
      key,
      coreId: RENTAL_PAYMENT_RECONCILIATION_CORE_ID,
      path: `/rental${definition.path}`,
      definition: { ...definition, component: PaymentReconciliationPage },
    }];
  }),
);

function sessionSnapshot(auth: ReturnType<typeof useAuthStore.getState>): RentalOrderSession {
  return {
    sessionVerified: auth.sessionVerified,
    authenticated: Boolean(auth.token),
    tenant: auth.tenant,
    user: auth.user,
    currentWorkspaceId: auth.currentWorkspaceId,
    hasPermission: auth.hasPermission,
  };
}
const getSession = () => sessionSnapshot(useAuthStore.getState());

export function useLegacyRentalPaymentReconciliationContext() {
  const auth = useAuthStore();
  const queryScope = useListQueryIdentity();
  const epoch = adminRuntime.currentSessionEpoch();
  return useMemo(() => createRentalPaymentReconciliationPageContext({
    runtime: adminRuntime, session: sessionSnapshot(auth), getSession, queryScope,
  }), [auth, queryScope, epoch]);
}

export function LegacyRentalPaymentReconciliationPageHost({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { batchId } = useParams<{ batchId: string }>();
  const context = useLegacyRentalPaymentReconciliationContext();
  const definition = batchId
    ? RENTAL_PAYMENT_RECONCILIATION_PAGES.detail
    : RENTAL_PAYMENT_RECONCILIATION_PAGES.batches;
  const page = pages.get(corePageKey(RENTAL_PAYMENT_RECONCILIATION_CORE_ID, definition.id))!;
  const auth = useAuthStore.getState();
  return <CorePageHostProvider host={{
    page, pages, navigate,
    params: batchId ? { batchId } : {},
    brandName: resolveAdminBrandName(auth.tenant, auth.user),
    lifetimeKey: JSON.stringify([rentalOrderSessionIdentity(context.session, adminRuntime.currentSessionEpoch()), batchId]),
    canAccess: (coreId, permissions) => coreId === RENTAL_PAYMENT_RECONCILIATION_CORE_ID
      && context.isCurrent()
      && permissions.every(permission => permission.resource === "finance" && permission.action === "reconcile"),
  }}><RentalPaymentReconciliationPageProvider context={context}>{children}</RentalPaymentReconciliationPageProvider></CorePageHostProvider>;
}
