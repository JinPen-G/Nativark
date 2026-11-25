/** 原组合后台复用唯一 Rental 会话及登记导航；所有旧入口共享同一助手上下文。 */
import type { ComponentType } from "react";
import { matchPath } from "react-router-dom";
import { createRentalAssistantContext, RentalAssistantHost,
  type RentalAssistantNavigation } from "@rental-os/rental-core/admin/assistant/host";
import { rentalBrowserSession } from "@/api/http";
import { APP_ROUTES, canAccessRoute } from "@/app/navigation";

const navigation: RentalAssistantNavigation = {
  routes: APP_ROUTES,
  canAccess(route) {
    const registered = Object.values(APP_ROUTES).find(candidate => candidate.path === route.path);
    const auth = rentalBrowserSession.useAuthStore.getState();
    return Boolean(registered && auth.sessionVerified && canAccessRoute(registered, auth.hasPermission,
      auth.hasCapability, auth.tenant?.categoryCode, Boolean(auth.user?.isSaasAdmin), auth.hasTenantMembershipPermission));
  },
  resolve(href) {
    if (!/^\/(?!\/)/u.test(href)) return null;
    const target = new URL(href, "https://admin.invalid");
    if (target.origin !== "https://admin.invalid") return null;
    const route = Object.values(APP_ROUTES).find(candidate => matchPath({ path: candidate.path, end: true }, target.pathname));
    return route && navigation.canAccess(route) ? `${target.pathname}${target.search}${target.hash}` : null;
  },
  originalPath: pathname => pathname,
};

export const legacyRentalAssistant = createRentalAssistantContext({
  session: rentalBrowserSession, useNavigation: () => navigation,
});

export function bindLegacyRentalAssistant<Props extends object>(Component: ComponentType<Props>) {
  return function LegacyRentalAssistantComponent(props: Props) {
    return <RentalAssistantHost value={legacyRentalAssistant}><Component {...props} /></RentalAssistantHost>;
  };
}
