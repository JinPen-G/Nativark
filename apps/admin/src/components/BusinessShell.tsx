/** Shared UI frame for operator and customer hosts. Menus, identity and business
 * actions come from the host, while layout, navigation and motion have one owner. */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAppearance } from "@/app/theme";
import { useLocale } from "@/app/locale";
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarRail, SidebarTrigger, SidebarInset, SidebarInput, useSidebar } from "./animate-sidebar/runtime/sidebar";
import { TooltipProvider } from "./animate-sidebar/runtime/tooltip";
import { Separator } from "./animate-sidebar/runtime/separator";
import { WorkspaceNavigationProvider, useWorkspaceNavigation } from "./workspace/WorkspaceNavigation";
import "./animate-sidebar/animate-sidebar.css";
import "./animate-sidebar/sidebar-adapter.css";

interface ShellNavigation {
  query: string;
  onNavigate: (path: string) => void;
  resetSearch: () => void;
}
interface BusinessShellProps {
  fullWidth?: boolean;
  identity?: string;
  brand: ReactNode;
  account: ReactNode;
  selectedKey: string;
  navigation: (navigation: ShellNavigation) => ReactNode;
  sidebarExtra?: (navigation: ShellNavigation) => ReactNode;
  headerContext: ReactNode;
  headerActions?: ReactNode;
  headerClassName?: string;
  contentClassName?: string;
  wrapContent?: (content: ReactNode) => ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}

export function BusinessShell(props: BusinessShellProps) {
  const { mode } = useAppearance();
  return <TooltipProvider><div className="app-frame-stage" data-tenant-console={props.fullWidth || undefined}>
    <div className="app-shell native-admin-shell">
      <SidebarProvider animateOnHover={false} style={{ "--sidebar-width": "var(--rental-sidebar-expanded-width)" } as CSSProperties}
        className={`rental-animate-scope relative h-full min-h-0${mode === "dark" ? " dark" : ""}`}>
        <BusinessShellContents {...props} />
      </SidebarProvider>
    </div>
  </div></TooltipProvider>;
}

function BusinessShellContents({ fullWidth, identity, brand, account, selectedKey, navigation: renderNavigation, sidebarExtra,
  headerContext, headerActions, headerClassName, contentClassName, wrapContent, overlay, children }: BusinessShellProps) {
  const { state, isMobile, openMobile, setOpenMobile } = useSidebar();
  const { pathname } = useLocation(), { t } = useLocale();
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
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selected = Array.from(host.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"][data-active], [data-sidebar="menu-sub-button"][data-active]'))
          .find(item => item.getBoundingClientRect().height > 0);
        if (selected) { selected.scrollIntoView({ block: "nearest" }); observer.disconnect(); }
      });
    };
    const observer = new MutationObserver(reveal);
    observer.observe(host, { childList: true, subtree: true }); reveal();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [selectedKey, query, identity, state, openMobile, renderNavigation]);
  const triggerProps = { "aria-label": navigationLabel, "aria-expanded": navigationExpanded,
    "aria-controls": "app-sidebar-navigation", "aria-keyshortcuts": "Control+B Meta+B",
    title: `${navigationLabel} (Ctrl / ⌘ B)`, "data-sound": "press" };
  const content = <div ref={contentRef} className={`app-content${contentClassName ? ` ${contentClassName}` : ""}`} data-admin-content style={{ flex: "1 1 auto" }}>
    <div className="content-canvas"><WorkspaceNavigationProvider value={navigation.context}>{children}</WorkspaceNavigationProvider></div>
  </div>;
  return <>
    <Sidebar collapsible="icon" className="rental-sidebar-colors">
      <SidebarHeader>
        {fullWidth ? <div className="rental-sidebar-top-row">{brand}<SidebarTrigger className="rental-sidebar-top-trigger" {...triggerProps} /></div> : brand}
        <SidebarInput className="group-data-[collapsible=icon]:hidden" type="search" aria-label={t("搜索菜单")}
          placeholder={t("搜索菜单")} value={query} onChange={event => setQuery(event.target.value)} />
      </SidebarHeader>
      {sidebarExtra?.(slots)}
      <SidebarContent id="app-sidebar-navigation" ref={navRef}>{renderNavigation(slots)}</SidebarContent>
      <SidebarFooter>{account}</SidebarFooter><SidebarRail />
    </Sidebar>
    <SidebarInset className="app-workspace min-h-0">
      <header className={`rental-sidebar-colors native-workspace-context flex shrink-0 items-center gap-2 transition-[width,height] duration-(--animate-ui-sidebar-duration) ease-(--animate-ui-sidebar-easing)${headerClassName ? ` ${headerClassName}` : ""}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
          {(!fullWidth || isMobile) && <><SidebarTrigger className="-ml-1" {...triggerProps} /><Separator orientation="vertical" className="mr-2 h-4" /></>}
          <div className="workspace-context-location">{headerContext}</div>
        </div>
        <div className="flex shrink-0 items-center gap-4 px-4">{headerActions}</div>
      </header>
      {wrapContent ? wrapContent(content) : content}
    </SidebarInset>
    {overlay}
  </>;
}
