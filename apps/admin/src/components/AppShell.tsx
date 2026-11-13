import { Breadcrumb } from "antd";
import { Tooltip } from "@/components/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { APP_ROUTES, buildNavigationSections, canAccessRoute } from "@/app/navigation";
import { useAuthStore } from "@/features/auth/authStore";
import { NotificationProvider } from "@/features/notifications/NotificationProvider";
import { HeaderNotifications } from "@/features/notifications/HeaderNotifications";
import { RestProvider } from "@/features/rest/RestProvider";
import { RestEntry } from "@/features/rest/RestEntry";
import { WorkspaceClock } from "./WorkspaceClock";
import { AnimatedIcon } from "./ui/AnimatedIcon";
import { rentalDesktopHost } from "@/features/agent-desktop/desktop-host";
import { SubscriptionExpiryFloatingCard } from "@/features/subscription/SubscriptionExpiryFloatingCard";
import { BusinessShell } from "./BusinessShell";
import { NativeAccountMenu } from "./animate-sidebar/NativeAccountMenu";
import { NativeWorkspaceSwitcher } from "./animate-sidebar/NativeWorkspaceSwitcher";
import { NativeNavigation } from "./animate-sidebar/NativeNavigation";
import { OperatorProvider } from "@/features/ai-operator/OperatorContext";
import { AiOperatorNavigation, OperatorModeSwitch } from "@/features/ai-operator/AiOperatorNavigation";
import { CopilotProvider, useCopilot } from "@/features/copilot/CopilotProvider";
import { CopilotLayout } from "@/features/copilot/CopilotLayout";
import "@/features/ai-operator/ai-operator.css";

/** Native Animate UI Base UI sidebar; business route/permission data stays unchanged. */
export function AppShell({ children }: { children: ReactNode }) {
  return <CopilotProvider><OperatorProvider><NotificationProvider><RestProvider><AppShellLayout>{children}</AppShellLayout></RestProvider></NotificationProvider></OperatorProvider></CopilotProvider>;
}
function AppShellLayout({ children }: { children: ReactNode }) {
  if (rentalDesktopHost()) {
    return <div className="desktop-business-content" style={{ height: "100vh", overflow: "auto", padding: "24px" }}>
      <main className="content-canvas">{children}</main>
      <SubscriptionExpiryFloatingCard />
    </div>;
  }
  return <ShellContents>{children}</ShellContents>;
}

function ShellContents({ children }: { children: ReactNode }) {
  const copilot = useCopilot();
  const location = useLocation(), navigate = useNavigate(), { t } = useLocale();
  const tenant = useAuthStore(s => s.tenant), user = useAuthStore(s => s.user);
  const tenantConsole = Boolean(user && !user.isSaasAdmin);
  const hasPermission = useAuthStore(s => s.hasPermission), hasCapability = useAuthStore(s => s.hasCapability);
  const hasTenantMembershipPermission = useAuthStore(s => s.hasTenantMembershipPermission);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const aiMode = location.pathname === APP_ROUTES.aiOperator.path;
  const canUseOperator = canAccessRoute(APP_ROUTES.aiOperator, hasPermission, hasCapability, tenant?.categoryCode, Boolean(user?.isSaasAdmin), hasTenantMembershipPermission);
  const lastAdminPath = useRef("/workbench");
  useEffect(() => { if (!aiMode) lastAdminPath.current = location.pathname + location.search; }, [aiMode, location.pathname, location.search]);
  const categoryProfile = useQuery({
    queryKey: ["rental-core", "profile"],
    queryFn: rentalCoreApi.profile,
    enabled: Boolean(user && !user.isSaasAdmin && currentWorkspaceId && (
      hasPermission("rental-os:order:view") || hasPermission("rental-core:catalog:view") || hasPermission("rental-core:asset:view")
    ))
  });
  const terminology = categoryProfile.data?.terminology;
  const sections = useMemo(() => buildNavigationSections(terminology).map((section) => ({
    ...section,
    routes: section.routes.filter((route) => route.menu && canAccessRoute(route, hasPermission, hasCapability, tenant?.categoryCode, Boolean(user?.isSaasAdmin), hasTenantMembershipPermission))
  })).filter((section) => section.routes.length > 0), [hasCapability, hasPermission, hasTenantMembershipPermission, tenant?.categoryCode, tenant?.capabilities, terminology, user]);
  const routes = useMemo(() => sections.flatMap((section) => section.routes), [sections]);
  const current = useMemo(() => {
    const route = routes.find((entry) => entry.path === location.pathname)
      ?? [...routes].sort((a, b) => b.path.length - a.path.length).find((entry) => location.pathname.startsWith(`${entry.path}/`));
    return {
      route,
      section: sections.find((section) => section.routes.some((entry) => entry.path === route?.path))
    };
  }, [location.pathname, routes, sections]);
  // Detail routes inherit the longest permitted menu parent, including future record pages.
  const selectedKey = current.route?.path ?? location.pathname;
  const registeredRoute = Object.values(APP_ROUTES).find(route => matchPath(route.path, location.pathname));
  const detailRoute = registeredRoute && canAccessRoute(registeredRoute, hasPermission, hasCapability,
    tenant?.categoryCode, Boolean(user?.isSaasAdmin), hasTenantMembershipPermission) ? registeredRoute : undefined;
  // Registered route labels can identify a denied location without adding a menu
  // item or a link to protected content. Tenant terminology still owns permitted routes.
  const deniedLabel = registeredRoute && !detailRoute ? registeredRoute.label : undefined;
  const breadcrumbItems = [
    ...(current.section ? [{ title: <span className="breadcrumb-section">{t(current.section.label)}</span> }] : []),
    { title: detailRoute && detailRoute.path !== current.route?.path && current.route
      ? <button type="button" className="breadcrumb-link" onClick={() => navigate(current.route!.path)}>{t(current.route.label)}</button>
      : t(deniedLabel ?? current.route?.label ?? detailRoute?.label ?? "工作台") },
    ...(detailRoute && current.route && detailRoute.path !== current.route.path ? [{ title: t(detailRoute.label) }] : []),
  ];

  return <BusinessShell fullWidth={tenantConsole} selectedKey={selectedKey}
    brand={<NativeWorkspaceSwitcher compact={tenantConsole} />} account={<NativeAccountMenu />}
    navigation={({ query, onNavigate }) => aiMode ? <AiOperatorNavigation query={query} />
      : <NativeNavigation sections={sections} selectedKey={selectedKey} query={query} onNavigate={onNavigate} />}
    sidebarExtra={canUseOperator ? ({ resetSearch, onNavigate }) => <OperatorModeSwitch ai={aiMode} onChange={next => {
      resetSearch();
      onNavigate(next ? APP_ROUTES.aiOperator.path : routes.some(route => lastAdminPath.current.split("?")[0] === route.path || lastAdminPath.current.startsWith(route.path + "/")) ? lastAdminPath.current : routes[0]?.path ?? "/");
    }} /> : undefined}
    headerClassName={aiMode ? "operator-context-header" : undefined}
    headerContext={<Breadcrumb aria-label={t("面包屑")} items={breadcrumbItems} />}
    headerActions={<><WorkspaceClock /><RestEntry />
      {!aiMode && copilot?.available && <Tooltip title="Copilot"><button type="button" className="workspace-copilot-entry" aria-label="Copilot" aria-controls="business-copilot" aria-expanded={copilot.open} data-sound="press" onClick={() => copilot.open ? copilot.close() : copilot.show()}>
        <AnimatedIcon name="ai" /><span className="workspace-copilot-label">Copilot</span>
        {!!copilot.contexts.length && <span className="copilot-entry-count">{copilot.contexts.length}</span>}
      </button></Tooltip>}
      <HeaderNotifications />
    </>}
    contentClassName={aiMode ? "ai-operator-host" : undefined}
    wrapContent={content => <CopilotLayout suspended={aiMode}>{content}</CopilotLayout>}
    overlay={<SubscriptionExpiryFloatingCard />}>
    {children}
  </BusinessShell>;
}
