/** Shared presentation frame. Hosts supply identity, permitted navigation and commands;
 * this module owns geometry and motion without importing an authentication runtime. */
import { Children, isValidElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { toCssTiming, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { ADMIN_SIDEBAR_REFERENCE_MOTION } from "@/app/designTokens";
import { useAppearance } from "@/app/theme";
import { useLocale } from "@/app/locale";
import { RightOutlined } from "./ui/icons";
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarRail, SidebarTrigger, SidebarInset, SidebarInput, useSidebar } from "./animate-sidebar/runtime/sidebar";
import { TooltipProvider } from "./animate-sidebar/runtime/tooltip";
import { Separator } from "./animate-sidebar/runtime/separator";
import { TenantSidebarHeader } from "./animate-sidebar/TenantSidebarHeader";
import { WorkspaceClock } from "./WorkspaceClock";
import { WorkspaceNavigationProvider, useWorkspaceNavigation } from "./workspace/WorkspaceNavigation";
import { WorkspaceHeaderProvider, WorkspaceBreadcrumbCurrent, useWorkspaceHeader } from "./workspace/WorkspaceHeader";
import "./animate-sidebar/animate-sidebar.css";
import "./animate-sidebar/sidebar-adapter.css";

export interface ShellNavigation {
  query: string;
  onNavigate: (path: string) => void;
  resetSearch: () => void;
}
export interface BusinessShellProps {
  fullWidth?: boolean;
  identity?: string;
  brand: ReactNode;
  account: ReactNode;
  selectedKey: string;
  navigation: (navigation: ShellNavigation) => ReactNode;
  sidebarExtra?: (navigation: ShellNavigation) => ReactNode;
  headerContext: ReactNode;
  /** Hosts with their own breadcrumb/current-title target opt out of the default extension. */
  headerTitleTarget?: boolean;
  headerActions?: ReactNode;
  headerUtilities?: ReactNode;
  headerTime?: ReactNode;
  headerClassName?: string;
  contentClassName?: string;
  /** Wrap the complete header/content column, so sibling panels retain their own edges. */
  wrapContent?: (content: ReactNode) => ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}

export function BusinessShell(props: BusinessShellProps) {
  const { mode } = useAppearance();
  const sidebarMotion = toCssTiming(useTempoTransition(ADMIN_SIDEBAR_REFERENCE_MOTION.layout));
  const labelMotion = toCssTiming(useTempoTransition(ADMIN_SIDEBAR_REFERENCE_MOTION.label));
  const reduced = useShouldReduceMotion();
  const style = { "--sidebar-width": "var(--rental-sidebar-expanded-width)", ...(props.fullWidth ? {
    "--rental-sidebar-expanded-width": "var(--rental-shell-sidebar-width)",
    "--rental-sidebar-collapsed-width": "var(--rental-shell-sidebar-collapsed-width)",
    "--sidebar-width-icon": "var(--rental-shell-sidebar-collapsed-width)",
    "--animate-ui-sidebar-duration": `${reduced ? 0 : sidebarMotion.duration}ms`,
    "--animate-ui-sidebar-easing": sidebarMotion.easing,
    "--rental-sidebar-label-duration": `${reduced ? 0 : labelMotion.duration}ms`,
    "--rental-sidebar-label-easing": labelMotion.easing,
  } : {}) } as CSSProperties;
  return <TooltipProvider><div className="app-frame-stage" data-tenant-console={props.fullWidth || undefined}>
    <div className="app-shell native-admin-shell"><SidebarProvider animateOnHover={false} style={style}
      className={`rental-animate-scope relative h-full min-h-0${mode === "dark" ? " dark" : ""}`}>
      <WorkspaceHeaderProvider><BusinessShellContents {...props} /></WorkspaceHeaderProvider>
    </SidebarProvider></div>
  </div></TooltipProvider>;
}

function BusinessShellContents({ fullWidth, identity, brand, account, selectedKey, navigation: renderNavigation, sidebarExtra,
  headerContext, headerTitleTarget = true, headerActions, headerUtilities, headerTime, headerClassName, contentClassName, wrapContent, overlay, children }: BusinessShellProps) {
  const { state, isMobile, openMobile, setOpenMobile } = useSidebar();
  const { pathname } = useLocation(), { t } = useLocale(), headerSlots = useWorkspaceHeader()!;
  const [query, setQuery] = useState("");
  const navRef = useRef<HTMLDivElement>(null), contentRef = useRef<HTMLDivElement>(null);
  const navigation = useWorkspaceNavigation(contentRef, navRef, identity);
  const navigationExpanded = isMobile ? openMobile : state === "expanded";
  const navigationLabel = t(navigationExpanded ? "收起导航" : "展开导航");
  const slots = { query, onNavigate: navigation.fromSidebar, resetSearch: () => setQuery("") };
  useEffect(() => { setOpenMobile(false); }, [pathname, identity, setOpenMobile]);
  useEffect(() => { setQuery(""); }, [identity]);
  useEffect(() => {
    const host = navRef.current;
    if (!host) return;
    let frame = 0;
    const reveal = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const selected = Array.from(host.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"][data-active], [data-sidebar="menu-sub-button"][data-active]'))
        .find(item => !item.closest('[inert], [aria-hidden="true"]') && item.getBoundingClientRect().height > 0);
      if (selected) { selected.scrollIntoView({ block: "nearest" }); observer.disconnect(); }
    }); };
    const observer = new MutationObserver(reveal); observer.observe(host, { childList: true, subtree: true }); reveal();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [selectedKey, query, identity, state, openMobile]);
  const triggerProps = { "aria-label": navigationLabel, "aria-expanded": fullWidth ? navigationExpanded : undefined,
    "aria-controls": "app-sidebar-navigation", "aria-keyshortcuts": "Control+B Meta+B",
    title: `${navigationLabel} (Ctrl / ⌘ B)`, "data-sound": "press" };
  // The fixed enterprise consumer supplied its clock through the old action slot.
  // Keep that public call compatible while moving the clock to the shared second row.
  const oldActions = Children.toArray(headerActions);
  const isClock = (node: ReactNode) => isValidElement(node) && node.type === WorkspaceClock;
  const actions = oldActions.filter(node => !isClock(node));
  const time = headerTime === undefined ? oldActions.find(isClock) ?? <WorkspaceClock /> : headerTime;
  const header = <header className={`native-workspace-context workspace-header${headerClassName ? ` ${headerClassName}` : ""}`}>
    <div className="workspace-header-location">
      {(!fullWidth || isMobile) && <><SidebarTrigger className="rental-sidebar-colors -ml-1" {...triggerProps} /><Separator orientation="vertical" className="mr-2 h-4" /></>}
      <div className="workspace-context-location">{headerContext}{headerTitleTarget && <span className="workspace-breadcrumb-extension">
        <RightOutlined size={13} className="workspace-breadcrumb-separator" /><WorkspaceBreadcrumbCurrent />
      </span>}</div>
    </div>
    <div ref={headerSlots.setActions} className="workspace-header-actions" data-admin-content>
      {!!actions.length && <div className="workspace-page-action-group" data-workspace-page-actions="">{actions}</div>}
    </div>
    <div className="workspace-header-utilities">{headerUtilities}</div>
    {time != null && <div className="workspace-header-time">{time}</div>}
  </header>;
  const column = <>{header}<div ref={contentRef} className={`app-content${contentClassName ? ` ${contentClassName}` : ""}`} data-admin-content style={{ flex: "1 1 auto" }}>
    <div className="content-canvas"><WorkspaceNavigationProvider value={navigation.context}>{children}</WorkspaceNavigationProvider></div>
  </div></>;
  return <>
    <Sidebar collapsible="icon" className="rental-sidebar-colors" transition={fullWidth ? ADMIN_SIDEBAR_REFERENCE_MOTION.layout : undefined}>
      <SidebarHeader>{fullWidth ? <TenantSidebarHeader workspace={brand} query={query} onQueryChange={setQuery} /> : <>
        {brand}<SidebarInput className="group-data-[collapsible=icon]:hidden" type="search" aria-label={t("搜索菜单")}
          placeholder={t("搜索菜单")} value={query} onChange={event => setQuery(event.target.value)} />
      </>}</SidebarHeader>
      {sidebarExtra?.(slots)}
      <SidebarContent id="app-sidebar-navigation" ref={navRef}>{renderNavigation(slots)}</SidebarContent>
      <SidebarFooter>{account}</SidebarFooter><SidebarRail />
    </Sidebar>
    <SidebarInset className="app-workspace min-h-0">{wrapContent ? wrapContent(column) : <div className="workspace-main-panel">{column}</div>}</SidebarInset>
    {overlay}
  </>;
}
