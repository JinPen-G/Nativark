/** Builds non-secret desktop navigation from the same route registry and permissions as the Web shell. */
import type { AuthUser, BusinessWorkspace, RentalCapability, RentalCategoryTerminology, TenantContext, RentalDesktopSession } from "@rental-os/shared";
import type { AppNavigationSection, AppRouteDefinition } from "@/app/navigation";

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
  routes: Record<string, AppRouteDefinition>;
  sections(terminology?: RentalCategoryTerminology): AppNavigationSection[];
  allowed(route: AppRouteDefinition, source: DesktopProjectionSource): boolean;
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
