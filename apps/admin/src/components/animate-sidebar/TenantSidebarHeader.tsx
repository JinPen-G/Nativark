import { useEffect, useRef, type ReactNode } from "react";
import { PanelLeft, Search } from "lucide-react";
import { useLocale } from "@/app/locale";
import { SidebarInput, SidebarTrigger, useSidebar } from "./runtime/sidebar";

/** The same logo slot restores the rail; workspace switching stays in its original child. */
export function TenantSidebarHeader({ workspace, query, onQueryChange }: {
  workspace: ReactNode; query: string; onQueryChange: (value: string) => void;
}) {
  const { state, isMobile, openMobile, toggleSidebar } = useSidebar(), { t } = useLocale();
  const expanded = isMobile ? openMobile : state === "expanded";
  const collapsed = !isMobile && state === "collapsed";
  const label = t(expanded ? "收起导航" : "展开导航");
  const search = useRef<HTMLInputElement>(null), focusSearch = useRef(false);
  useEffect(() => { if (expanded && focusSearch.current) { focusSearch.current = false; search.current?.focus(); } }, [expanded]);
  return <>
    <div className="rental-sidebar-top-row">
      <div className="rental-sidebar-workspace" inert={collapsed || undefined} aria-hidden={collapsed || undefined}>{workspace}</div>
      <SidebarTrigger className="rental-sidebar-top-trigger" aria-label={label}
        aria-expanded={expanded} aria-controls="app-sidebar-navigation" aria-keyshortcuts="Control+B Meta+B"
        inert={collapsed || undefined} aria-hidden={collapsed || undefined} tabIndex={collapsed ? -1 : undefined}
        title={`${label} (Ctrl / ⌘ B)`} data-sound="press"><PanelLeft size={16} strokeWidth={1.75} aria-hidden="true" /></SidebarTrigger>
      <button type="button" className="rental-sidebar-rail-trigger" aria-label={t("展开导航")}
        aria-expanded="false" aria-controls="app-sidebar-navigation" aria-keyshortcuts="Control+B Meta+B"
        inert={!collapsed || undefined} aria-hidden={!collapsed || undefined} tabIndex={collapsed ? 0 : -1}
        title={`${t("展开导航")} (Ctrl / ⌘ B)`} data-sound="press" onClick={toggleSidebar}>
        <PanelLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
    <div className="rental-sidebar-search-row">
      <SidebarInput ref={search} className="rental-sidebar-search-input" type="search" aria-label={t("搜索菜单")}
        inert={collapsed || undefined} aria-hidden={collapsed || undefined} tabIndex={collapsed ? -1 : undefined}
        placeholder={t("搜索菜单")} value={query} onChange={event => onQueryChange(event.target.value)} />
      <button type="button" className="rental-sidebar-search-trigger" aria-label={t("搜索菜单")}
        inert={!collapsed || undefined} aria-hidden={!collapsed || undefined} tabIndex={collapsed ? 0 : -1}
        data-sound="press" onClick={() => { focusSearch.current = true; toggleSidebar(); }}><Search size={16} strokeWidth={1.75} aria-hidden="true" /></button>
    </div>
  </>;
}
