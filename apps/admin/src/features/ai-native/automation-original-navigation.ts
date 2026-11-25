/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/automation-original-navigation";
import { createAutomationOriginalNavigation as createNavigation } from "@rental-os/rental-core/admin/task-center/automation-original-navigation";
import { APP_ROUTES, canAccessRoute, type AppRouteDefinition } from "@/app/navigation";
import { rentalBrowserSession } from "@/api/http";
type NavigationOptions = Parameters<typeof createNavigation>[0];
export function createAutomationOriginalNavigation(input: Omit<NavigationOptions, "routes" | "canAccessRoute"> & { hasPermission(permission: string): boolean }) {
  return createNavigation({ ...input, routes: APP_ROUTES, canAccessRoute(route) {
    const registered: AppRouteDefinition | undefined = Object.values(APP_ROUTES).find(candidate => candidate.path === route.path);
    const auth = rentalBrowserSession.useAuthStore.getState();
    return Boolean(registered && (!registered.permission || input.hasPermission(registered.permission)
      || registered.legacyPermissions?.some(input.hasPermission)) && auth.sessionVerified
      && canAccessRoute(registered, auth.hasPermission, auth.hasCapability, auth.tenant?.categoryCode,
        Boolean(auth.user?.isSaasAdmin), auth.hasTenantMembershipPermission));
  } });
}
