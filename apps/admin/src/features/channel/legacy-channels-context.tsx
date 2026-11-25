/** 原渠道入口供给当前会话、品牌默认与资产传输，页面和保存复用 Rental 单源实现。 */
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { corePageKey, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { CorePageHostProvider } from "@rental-os/platform-admin/core";
import {
  ClientChannelPage,
  createRentalChannelsPageContext,
  RentalChannelsPageProvider,
  RENTAL_CHANNELS_CORE_ID,
  RENTAL_CHANNELS_PAGES,
  rentalChannelsLegacyPageAllowed,
} from "@rental-os/rental-core/admin/channels";
import { rentalOrderSessionIdentity, type RentalOrderSession } from "@rental-os/rental-core/admin/orders";
import { adminRuntime } from "@/app/adminRuntime";
import { ADMIN_LOGIN_DEFAULTS, resolveAdminBrandName } from "@/app/branding";
import { apiAssetOrigin } from "@/api/http";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { useAuthStore } from "@/features/auth/authStore";

const definition = RENTAL_CHANNELS_PAGES.clientChannel;
const key = corePageKey(RENTAL_CHANNELS_CORE_ID, definition.id);
const page: CoreRegisteredPage<unknown> = {
  key, coreId: RENTAL_CHANNELS_CORE_ID, path: "/tenant/client-channel",
  definition: { ...definition, component: ClientChannelPage },
};
const pages = new Map([[key, page]]);

function sessionSnapshot(auth: ReturnType<typeof useAuthStore.getState>): RentalOrderSession {
  return { sessionVerified: auth.sessionVerified, authenticated: Boolean(auth.token), tenant: auth.tenant,
    user: auth.user, currentWorkspaceId: auth.currentWorkspaceId, hasPermission: auth.hasPermission };
}
const getSession = () => sessionSnapshot(useAuthStore.getState());

export function useLegacyRentalChannelsContext() {
  const auth = useAuthStore();
  const queryScope = useListQueryIdentity();
  const epoch = adminRuntime.currentSessionEpoch();
  return useMemo(() => createRentalChannelsPageContext({
    runtime: adminRuntime, session: sessionSnapshot(auth), getSession, queryScope,
    assetOrigin: apiAssetOrigin, loginDefaults: ADMIN_LOGIN_DEFAULTS,
    setTenantBranding: branding => useAuthStore.getState().setTenantBranding(branding),
  }), [auth, queryScope, epoch]);
}

export function LegacyRentalChannelsPageHost({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const context = useLegacyRentalChannelsContext();
  const auth = useAuthStore.getState();
  return <CorePageHostProvider host={{
    page, pages, navigate,
    brandName: resolveAdminBrandName(auth.tenant, auth.user),
    lifetimeKey: rentalOrderSessionIdentity(context.session, adminRuntime.currentSessionEpoch()),
    canAccess: (coreId, permissions) => coreId === RENTAL_CHANNELS_CORE_ID
      && context.isCurrent() && rentalChannelsLegacyPageAllowed(getSession())
      && permissions.every(permission => definition.permissions.some(base =>
        base.resource === permission.resource && base.action === permission.action)),
  }}><RentalChannelsPageProvider context={context}>{children}</RentalChannelsPageProvider></CorePageHostProvider>;
}
