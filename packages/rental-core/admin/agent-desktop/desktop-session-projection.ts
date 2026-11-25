/** Builds non-secret desktop navigation from the same route registry and permissions as the Web shell. */
import type { AuthUser } from "@rental-os/platform-contracts";
import type { BusinessWorkspace, RentalCapability, RentalCategoryTerminology } from "@rental-os/rental-core";
import type { TenantContext } from "@rental-os/rental-core/auth-contracts";
import type { RentalDesktopSession } from "@rental-os/shared/agent-desktop";
/** 只描述宿主当前菜单，不带组件或任意导航执行器。 */
export interface DesktopNavigationRoute { path: string; label: string; menu?: boolean }
export interface DesktopNavigationSection { key: string; label: string; routes: DesktopNavigationRoute[] }

export interface DesktopProjectionSource {
  ready: boolean;
  sessionVerified: boolean;
  token?: string;
  user?: AuthUser;
  tenant?: TenantContext;
  currentWorkspaceId?: string;
  workspaces: BusinessWorkspace[];
  hasPermission(permission?: string): boolean;
  hasCapability(capability?: RentalCapability): boolean;
  hasTenantMembershipPermission(permission?: string): boolean;
}
export interface DesktopNavigationSource {
  routes: Record<string, DesktopNavigationRoute>;
  sections(terminology?: RentalCategoryTerminology): DesktopNavigationSection[];
  allowed(route: DesktopNavigationRoute, source: DesktopProjectionSource): boolean;
}

export function desktopSessionProjection(source: DesktopProjectionSource, navigation: DesktopNavigationSource,
  pathname: string, translate: (value: string) => string, terminology?: RentalCategoryTerminology): RentalDesktopSession {
  if (!source.ready) return { status: "unavailable" };
  if (!source.token || !source.user || !source.tenant) return { status: "signed-out" };
  if (!source.sessionVerified) return { status: "unavailable" };
  if (source.user.mustChangePassword) return { status: "password-change" };
  const ids = new Map(Object.entries(navigation.routes).map(([id, route]) => [route.path, id]));
  const sections = navigation.sections(terminology).map(section => ({
    id: section.key, label: translate(section.label), items: section.routes.filter(route => route.menu && navigation.allowed(route, source)).map(route => {
      const id = ids.get(route.path);
      if (!id) throw new Error("Unregistered desktop route");
      return { id, path: route.path, label: translate(route.label) };
    })
  })).filter(section => section.items.length > 0);
  return { status: "ready", actorId: source.user.id, tenantId: source.tenant.tenantId, tenantName: source.tenant.tenantName,
    displayName: source.user.displayName, audience: source.user.isSaasAdmin ? "saas" : "tenant",
    currentWorkspaceId: source.currentWorkspaceId ?? null,
    workspaces: source.workspaces.map(row => ({ id: row.id, name: row.name, categoryCode: row.categoryCode ?? null })),
    sections, defaultPath: Object.values(navigation.routes).find(route => route.menu && navigation.allowed(route, source))?.path ?? null, pathname };
}
