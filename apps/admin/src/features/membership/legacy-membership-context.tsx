/** 原会员宿主供给当前身份、鉴权文件和可选 AI 接点，页面沿同一 Rental 贡献运行。 */
import { useMemo, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { corePageKey, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import {
  createRentalMembershipPageContext,
  RentalMembershipPageProvider,
  rentalMembershipPageComponents,
  type RentalMembershipSession,
  type RentalMembershipFiles,
} from "@rental-os/rental-core/admin/membership";
import {
  RENTAL_MEMBERSHIP_CORE_ID,
  RENTAL_MEMBERSHIP_PAGES,
  rentalMembershipLegacyPageAllowed,
} from "@rental-os/rental-core/admin/membership/pages";
import {
  rentalOrderSessionIdentity,
  RentalOrdersPage,
  RentalOrderCreatePage,
  RentalOrderDetailPage,
} from "@rental-os/rental-core/admin/orders";
import { RENTAL_ORDER_PAGES } from "@rental-os/rental-core/admin/orders/pages";
import { adminRuntime } from "@/app/adminRuntime";
import { resolveAdminBrandName } from "@/app/branding";
import { http } from "@/api/http";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { useAuthStore } from "@/features/auth/authStore";
import { MemberNameFlow } from "@/features/ai-native/MemberNameFlow";
import { NotificationDraftFlow } from "@/features/ai-native/NotificationDraftFlow";
import { useAiManagementLocale } from "@/features/ai-native/management-locale";

function sessionSnapshot(auth: ReturnType<typeof useAuthStore.getState>): RentalMembershipSession {
  return {
    sessionVerified: auth.sessionVerified,
    authenticated: Boolean(auth.token),
    tenant: auth.tenant,
    user: auth.user,
    currentWorkspaceId: auth.currentWorkspaceId,
    hasPermission: auth.hasPermission,
    hasTenantMembershipPermission: auth.hasTenantMembershipPermission,
  };
}
const getSession = () => sessionSnapshot(useAuthStore.getState());
/** 原姓名引用和企业操作身份通过同一会话读取，不产生新的业务操作键。 */
export const legacyRentalMembershipReferenceContext = { runtime: adminRuntime, getSession };
const components = { MemberNameFlow, NotificationDraftFlow };
const files: RentalMembershipFiles = {
  avatar: async (customerId, signal) =>
    (
      await http.get<Blob>("/platform/customers/" + encodeURIComponent(customerId) + "/avatar", {
        responseType: "blob",
        signal,
      })
    ).data,
  application: async (applicationId, fileId, signal) =>
    (
      await http.request<Blob>({
        url:
          "/membership/enterprise-workflows/applications/" +
          encodeURIComponent(applicationId) +
          "/files/" +
          encodeURIComponent(fileId),
        method: "get",
        responseType: "blob",
        signal: signal ?? adminRuntime.currentSessionSignal(),
      })
    ).data,
  management: async (requestId, fileId, signal) =>
    (
      await http.request<Blob>({
        url:
          "/membership/enterprise-workflows/management-requests/" +
          encodeURIComponent(requestId) +
          "/files/" +
          encodeURIComponent(fileId),
        method: "get",
        responseType: "blob",
        signal: signal ?? adminRuntime.currentSessionSignal(),
      })
    ).data,
};

export function useLegacyRentalMembershipContext() {
  const auth = useAuthStore();
  const queryScope = useListQueryIdentity();
  const { t: managementText } = useAiManagementLocale();
  const epoch = adminRuntime.currentSessionEpoch();
  return useMemo(
    () =>
      createRentalMembershipPageContext({
        runtime: adminRuntime,
        session: sessionSnapshot(auth),
        getSession,
        queryScope,
        files,
        components,
        managementText,
      }),
    [auth, queryScope, managementText, epoch],
  );
}

export function LegacyRentalMembershipProvider({ children }: { children: ReactNode }) {
  return (
    <RentalMembershipPageProvider context={useLegacyRentalMembershipContext()}>
      {children}
    </RentalMembershipPageProvider>
  );
}

const orderComponents = {
  [RENTAL_ORDER_PAGES.orders.id]: RentalOrdersPage,
  [RENTAL_ORDER_PAGES.orderCreate.id]: RentalOrderCreatePage,
  [RENTAL_ORDER_PAGES.orderDetail.id]: RentalOrderDetailPage,
};
const pages = new Map<string, CoreRegisteredPage<unknown>>(
  [
    ...Object.values(RENTAL_MEMBERSHIP_PAGES).map((definition) => ({
      key: corePageKey(RENTAL_MEMBERSHIP_CORE_ID, definition.id),
      coreId: RENTAL_MEMBERSHIP_CORE_ID,
      path:
        definition.id === RENTAL_MEMBERSHIP_PAGES.qualificationTypes.id
          ? "/rental" + definition.path
          : definition.path,
      definition: { ...definition, component: rentalMembershipPageComponents[definition.id] },
    })),
    ...Object.values(RENTAL_ORDER_PAGES).map((definition) => ({
      key: corePageKey(RENTAL_MEMBERSHIP_CORE_ID, definition.id),
      coreId: RENTAL_MEMBERSHIP_CORE_ID,
      path: "/rental" + definition.path,
      definition: { ...definition, component: orderComponents[definition.id] },
    })),
  ].map((page) => [page.key, page]),
);

export function LegacyRentalMembershipPageHost({
  page: pageName,
  customerId: explicitCustomerId,
  children,
}: {
  page: keyof typeof RENTAL_MEMBERSHIP_PAGES;
  customerId?: string;
  children: ReactNode;
}) {
  const route = useParams<{ customerId: string }>();
  const customerId = explicitCustomerId ?? route.customerId;
  const navigate = useNavigate();
  const context = useLegacyRentalMembershipContext();
  const selectedPage =
    customerId && pageName === "personal"
      ? "personalDetail"
      : customerId && pageName === "corporate"
        ? "corporateDetail"
        : pageName;
  const page = pages.get(
    corePageKey(RENTAL_MEMBERSHIP_CORE_ID, RENTAL_MEMBERSHIP_PAGES[selectedPage].id),
  )!;
  const auth = useAuthStore.getState();
  return (
    <CorePageHostProvider
      host={{
        page,
        pages,
        navigate,
        params: customerId ? { customerId } : {},
        brandName: resolveAdminBrandName(auth.tenant, auth.user),
        lifetimeKey: JSON.stringify([
          rentalOrderSessionIdentity(context.session, adminRuntime.currentSessionEpoch()),
          customerId,
        ]),
        canAccess: (coreId, permissions) => {
          const current = getSession();
          if (
            coreId !== RENTAL_MEMBERSHIP_CORE_ID ||
            !rentalMembershipLegacyPageAllowed(page.definition.id, current)
          )
            return false;
          // 旧页面的 OR 准入保留；另外声明的动作仍核其原权限。
          return permissions.every(
            (permission) =>
              page.definition.permissions.some(
                (base) =>
                  base.resource === permission.resource && base.action === permission.action,
              ) ||
              (permission.resource === "member" || permission.resource === "corporate"
                ? current.hasTenantMembershipPermission(
                    "rental-os:" + permission.resource + ":" + permission.action,
                  )
                : current.hasPermission(
                    "rental-os:" + permission.resource + ":" + permission.action,
                  )),
          );
        },
      }}
    >
      <RentalMembershipPageProvider context={context}>{children}</RentalMembershipPageProvider>
    </CorePageHostProvider>
  );
}
