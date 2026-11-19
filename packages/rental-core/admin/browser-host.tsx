/** 浏览器宿主将原 Rental 会话、文件与组织权限供给同一十二组页面。
 * 公共应用拥有路由、外壳与 QueryClient。业务范围来自当前已验证的原会话。 */
import { useMemo, type ComponentProps } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "@rental-os/platform-admin/ui";
import { useLocale } from "@rental-os/platform-admin/locale";
import { createRentalAdminHost, type RentalAdminHostOptions, type RentalAdminHostState } from "./host-context";
import type { RentalBrowserAdminSession } from "./browser";
import type { RentalCatalogImageRequest } from "./catalog/client";
import { CustomerPreview } from "./membership/CustomerPreview";
import { RentalMembershipPageProvider, type RentalMembershipFiles } from "./membership/page-context";
import { rentalOrderSessionIdentity } from "./orders/page-context";

export interface RentalBrowserAdminHostOptions {
  session: RentalBrowserAdminSession;
  loginDefaults: RentalAdminHostOptions["channels"]["loginDefaults"];
  categoryGovernancePreviewEnabled: boolean;
  OrderFactsEntry?: RentalAdminHostOptions["OrderFactsEntry"];
  membership?: Omit<NonNullable<RentalAdminHostOptions["membership"]>, "files">;
  governance?: RentalAdminHostOptions["governance"];
}

function UnconfiguredOrderFactsEntry() {
  const { locale } = useLocale();
  return <Alert type="info" showIcon title={locale === "en-US"
    ? "Order AI assistance is not configured" : "订单 AI 辅助尚未装配"} />;
}

export function createRentalBrowserAdminHost(options: RentalBrowserAdminHostOptions) {
  const { session } = options;
  const getAuth = session.useAuthStore.getState;
  const getState = (): RentalAdminHostState => {
    const auth = getAuth();
    const current = {
      sessionVerified: auth.sessionVerified,
      authenticated: Boolean(auth.token),
      tenant: auth.tenant,
      user: auth.user,
      currentWorkspaceId: auth.currentWorkspaceId,
      hasPermission: auth.hasPermission,
      hasTenantMembershipPermission: auth.hasTenantMembershipPermission,
    };
    const verified = current.sessionVerified && current.authenticated && current.tenant?.tenantId
      && current.user?.id && !current.user.isSaasAdmin;
    return {
      session: current,
      scopeKey: verified && current.currentWorkspaceId
        ? rentalOrderSessionIdentity(current, session.currentSessionEpoch()) : undefined,
      queryScope: JSON.stringify([
        auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id,
        auth.user?.isPlatformAdmin, auth.user?.isSaasAdmin, auth.user?.dataScope, auth.user?.locationScope,
        auth.user?.permissions && [...new Set(auth.user.permissions)].sort(), auth.user?.organizationId,
      ]),
      workOrderPermissions: {
        manage: auth.hasPermission("rental-core:maintenance:manage"),
        review: auth.hasPermission("rental-core:maintenance:review"),
        viewOrders: auth.hasPermission("rental-os:order:view"),
        restore: auth.hasPermission("rental-core:maintenance:review") || auth.hasPermission("rental-core:asset:manage"),
      },
      categoryGovernancePreviewEnabled: options.categoryGovernancePreviewEnabled,
    };
  };

  const requestImage: RentalCatalogImageRequest = async (path, requestOptions) => {
    const epoch = session.currentSessionEpoch();
    const sessionSignal = session.currentSessionSignal();
    const signal = requestOptions?.signal ? AbortSignal.any([requestOptions.signal, sessionSignal]) : sessionSignal;
    if (signal.aborted) throw new DOMException("型号图片读取已取消", "AbortError");
    const response = await session.http.get<Blob>(path, { responseType: "blob", signal });
    if (signal.aborted || session.currentSessionEpoch() !== epoch)
      throw new DOMException("型号图片所属会话已变化", "AbortError");
    return response.data;
  };
  const files: RentalMembershipFiles = {
    avatar: (customerId, signal) => requestImage(
      "/platform/customers/" + encodeURIComponent(customerId) + "/avatar", { signal },
    ),
    application: (applicationId, fileId, signal) => requestImage(
      "/membership/enterprise-workflows/applications/" + encodeURIComponent(applicationId)
        + "/files/" + encodeURIComponent(fileId), { signal },
    ),
    management: (requestId, fileId, signal) => requestImage(
      "/membership/enterprise-workflows/management-requests/" + encodeURIComponent(requestId)
        + "/files/" + encodeURIComponent(fileId), { signal },
    ),
  };
  const host = createRentalAdminHost({
    runtime: session.runtime,
    getState,
    requestImage,
    requestText: async (path, params) => {
      const epoch = session.currentSessionEpoch(), signal = session.currentSessionSignal();
      const text = await session.requestText(path, params);
      if (signal.aborted || session.currentSessionEpoch() !== epoch)
        throw new DOMException("报表所属会话已变化", "AbortError");
      return text;
    },
    refreshSession: session.bootstrap,
    CustomerPreview: BrowserCustomerPreview,
    canViewOrganizations: () => getAuth().hasPermission("system:user:manage"),
    canManageOrganizationMapping: () => {
      const auth = getAuth();
      return auth.user?.dataScope === "all" && auth.user.locationScope?.mode !== "selected"
        && auth.hasPermission("system:user:manage");
    },
    channels: {
      assetOrigin: session.apiAssetOrigin,
      loginDefaults: options.loginDefaults,
      setTenantBranding: branding => getAuth().setTenantBranding(branding),
    },
    membership: { ...options.membership, files },
    governance: options.governance,
    OrderFactsEntry: options.OrderFactsEntry ?? UnconfiguredOrderFactsEntry,
  });

  function BrowserCustomerPreview(props: ComponentProps<typeof CustomerPreview>) {
    const context = host.contexts.useMembershipContext();
    return <RentalMembershipPageProvider context={context}>
      <CustomerPreview {...props} />
    </RentalMembershipPageProvider>;
  }

  function useSetupContext() {
    const context = host.contexts.useSetupContext();
    const navigate = useNavigate();
    return useMemo(() => ({
      ...context,
      accounts: {
        canOpen: () => context.isCurrent() && getAuth().hasPermission("system:user:manage"),
        open: () => {
          if (!context.isCurrent()) throw new DOMException("开业配置的会话或业务范围已变化", "AbortError");
          if (!getAuth().hasPermission("system:user:manage")) throw new Error("当前账号管理入口不可用");
          navigate("/settings/users");
        },
      },
    }), [context, navigate]);
  }

  return { ...host, getState, contexts: { ...host.contexts, useSetupContext } };
}
