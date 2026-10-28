import { Breadcrumb } from "antd";
import { Bell } from "lucide-react";
import { Button, Tooltip } from "@/components/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { APP_ROUTES, buildNavigationSections, canAccessRoute } from "@/app/navigation";
import { useAppearance } from "@/app/theme";
import { useAuthStore } from "@/features/auth/authStore";
import { NotificationProvider } from "@/features/notifications/NotificationProvider";
import { HeaderNotifications } from "@/features/notifications/HeaderNotifications";
import { WorkspaceClock } from "./WorkspaceClock";
import { rentalDesktopHost } from "@/features/agent-desktop/desktop-host";
import { SubscriptionExpiryFloatingCard } from "@/features/subscription/SubscriptionExpiryFloatingCard";
import { WorkspaceNavigationProvider, useWorkspaceNavigation } from "./workspace/WorkspaceNavigation";
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarRail, SidebarTrigger, SidebarInset, SidebarInput, useSidebar } from "./animate-sidebar/runtime/sidebar";
import { TooltipProvider } from "./animate-sidebar/runtime/tooltip";
import { Separator } from "./animate-sidebar/runtime/separator";
import { NativeAccountMenu } from "./animate-sidebar/NativeAccountMenu";
import { NativeWorkspaceSwitcher } from "./animate-sidebar/NativeWorkspaceSwitcher";
import { NativeNavigation } from "./animate-sidebar/NativeNavigation";
import { OperatorProvider } from "@/features/ai-operator/OperatorContext";
import { AiOperatorNavigation, OperatorModeSwitch } from "@/features/ai-operator/AiOperatorNavigation";
import "@/features/ai-operator/ai-operator.css";
import "./animate-sidebar/animate-sidebar.css";
import "./animate-sidebar/sidebar-adapter.css";

/** Native Animate UI Base UI sidebar; business route/permission data stays unchanged. */
export function AppShell({ children }: { children: ReactNode }) {
  return <OperatorProvider><NotificationProvider><AppShellLayout>{children}</AppShellLayout></NotificationProvider></OperatorProvider>;
}
function AppShellLayout({ children }: { children: ReactNode }) {
  const { mode } = useAppearance();
  if (rentalDesktopHost()) {
    return <div className="desktop-business-content" style={{ height: "100vh", overflow: "auto", padding: "24px" }}>
      <main className="content-canvas">{children}</main>
      <SubscriptionExpiryFloatingCard />
    </div>;
  }
  // Route Highlight is controlled separately so focused/hovered items cannot steal its surface.
  return <TooltipProvider><div className="app-frame-stage"><div className="app-shell native-admin-shell"><SidebarProvider animateOnHover={false} style={{ "--sidebar-width": "var(--rental-sidebar-expanded-width)" } as CSSProperties} className={`rental-animate-scope relative h-full min-h-0${mode === "dark" ? " dark" : ""}`}>
    <ShellContents>{children}</ShellContents>
  </SidebarProvider></div></div></TooltipProvider>;
}

function ShellContents({ children }: { children: ReactNode }) {
  const { state, openMobile, setOpenMobile } = useSidebar();
  const [query, setQuery] = useState("");
  const navRef = useRef<HTMLDivElement>(null), contentRef = useRef<HTMLDivElement>(null);
  const navigation = useWorkspaceNavigation(contentRef, navRef);
  const location = useLocation(), navigate = useNavigate(), { t } = useLocale();
  const tenant = useAuthStore(s => s.tenant), user = useAuthStore(s => s.user);
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
  })).filter((section) => section.routes.length > 0), [hasCapability, hasPermission, hasTenantMembershipPermission, tenant?.categoryCode, terminology, user]);
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
  const detailRoute = Object.values(APP_ROUTES).find(route => matchPath(route.path, location.pathname)
    && canAccessRoute(route, hasPermission, hasCapability, tenant?.categoryCode, Boolean(user?.isSaasAdmin), hasTenantMembershipPermission));
  const breadcrumbItems = [
    ...(current.section ? [{ title: <span className="breadcrumb-section">{t(current.section.label)}</span> }] : []),
    { title: detailRoute && detailRoute.path !== current.route?.path && current.route
      ? <button type="button" className="breadcrumb-link" onClick={() => navigate(current.route!.path)}>{t(current.route.label)}</button>
      : t(current.route?.label ?? detailRoute?.label ?? "工作台") },
    ...(detailRoute && current.route && detailRoute.path !== current.route.path ? [{ title: t(detailRoute.label) }] : []),
  ];

  useEffect(() => { setOpenMobile(false); }, [location.pathname, setOpenMobile]);
  useEffect(() => {
    const host = navRef.current;
    if (!host) return;
    let frame = 0;
    const reveal = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const selected = Array.from(host.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"][data-active], [data-sidebar="menu-sub-button"][data-active]')).find(e => e.getBoundingClientRect().height > 0);
      if (selected) { selected.scrollIntoView({ block: "nearest" }); observer.disconnect(); }
    }); };
    const observer = new MutationObserver(reveal); observer.observe(host, {childList:true, subtree:true}); reveal();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [selectedKey, sections, state, openMobile]);
  return <>
    <Sidebar collapsible="icon" className="rental-sidebar-colors">
      <SidebarHeader><NativeWorkspaceSwitcher />
        <SidebarInput className="group-data-[collapsible=icon]:hidden" type="search" aria-label={t("搜索菜单")} placeholder={t("搜索菜单")} value={query} onChange={event => setQuery(event.target.value)} />
      </SidebarHeader>
      <SidebarContent ref={navRef}>
        {canUseOperator && <OperatorModeSwitch ai={aiMode} onChange={next => { setQuery(""); navigation.fromSidebar(next ? APP_ROUTES.aiOperator.path : routes.some(route => lastAdminPath.current.split("?")[0] === route.path || lastAdminPath.current.startsWith(`${route.path}/`)) ? lastAdminPath.current : routes[0]?.path ?? "/"); }} />}
        {aiMode ? <AiOperatorNavigation query={query} /> : <NativeNavigation sections={sections} selectedKey={selectedKey} query={query} onNavigate={navigation.fromSidebar} />}
      </SidebarContent>
      <SidebarFooter><NativeAccountMenu /></SidebarFooter><SidebarRail />
    </Sidebar>
    <SidebarInset className="app-workspace min-h-0">
      <header className={`rental-sidebar-colors native-workspace-context flex shrink-0 items-center gap-2 transition-[width,height] duration-(--animate-ui-sidebar-duration) ease-(--animate-ui-sidebar-easing)${aiMode ? " operator-context-header" : ""}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" aria-label={t(state === "collapsed" ? "展开导航" : "收起导航")} />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="workspace-context-location"><Breadcrumb aria-label={t("面包屑")} items={breadcrumbItems} /></div>
        </div>
        <div className="flex shrink-0 items-center gap-4 px-4"><WorkspaceClock />
          <HeaderNotifications />
        </div>
      </header>
      <div ref={contentRef} className={`app-content${aiMode ? " ai-operator-host" : ""}`} data-admin-content style={{ flex: "1 1 auto" }}><div className="content-canvas"><WorkspaceNavigationProvider value={navigation.context}>{children}</WorkspaceNavigationProvider></div></div>
    </SidebarInset>
    <SubscriptionExpiryFloatingCard />
  </>;
}
