import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { MENU_GROUP_LABELS, menuRouteLabel } from "@/app/navigation-display";
import { ADMIN_SIDEBAR_REFERENCE_MOTION } from "@/app/designTokens";
import { useLocale } from "@/app/locale";
import { useEffect, useId, useState, type ReactNode } from "react";
import { motion, type Transition } from "motion/react";
import { useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton, useSidebar } from "./runtime/sidebar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem } from "./runtime/dropdown-menu";
import { AnimatedIcon, type AnimatedIconName } from "../ui/AnimatedIcon";

const groupIcons: Record<string, AnimatedIconName> = { overview: "dashboard", transactions: "orders", inventory: "inventory",
  commercial: "pricing", customers: "customers", "operations-foundation": "rules",
  "account-access": "access", "service-channels": "plugins", "finance-reconciliation": "finance" };

export interface ShellNavigationSection {
  key: string;
  label: string;
  routes: Array<{ path: string; label: string; icon?: ReactNode }>;
}

/** Keep the same parent and child rows during rail changes; only their height and visibility move. */
export function NativeNavigation({ sections, selectedKey, query, onNavigate, flat = false }: {
  sections: ShellNavigationSection[]; selectedKey: string; query: string; onNavigate: (path: string) => void; flat?: boolean;
}) {
  const { t } = useLocale(), { state, isMobile } = useSidebar();
  const submenuId = useId();
  const reduced = useShouldReduceMotion();
  const submenuTransition = useTempoTransition<Transition>({
    height: ADMIN_SIDEBAR_REFERENCE_MOTION.layout,
    opacity: ADMIN_SIDEBAR_REFERENCE_MOTION.contentEnter,
  });
  const submenuExitTransition = useTempoTransition<Transition>({
    height: ADMIN_SIDEBAR_REFERENCE_MOTION.layout,
    opacity: ADMIN_SIDEBAR_REFERENCE_MOTION.contentExit,
  });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [popupGroup, setPopupGroup] = useState<string | null>(null);
  const keyword = query.trim().toLocaleLowerCase();
  const visible = sections.map(section => ({ ...section, routes: section.routes.filter(route => !keyword ||
    [route.label, menuRouteLabel(route.path, route.label), t(route.label), t(menuRouteLabel(route.path, route.label))].some(label => label.toLocaleLowerCase().includes(keyword))) })).filter(s => s.routes.length);
  const collapsed = !isMobile && state === "collapsed";
  useEffect(() => { setPopupGroup(null); }, [collapsed, selectedKey, keyword]);
  const overview = flat ? { label: "", routes: visible.flatMap(section => section.routes) } : visible.find(s => s.key === "overview");
  const isExpanded = (section: ShellNavigationSection) => Boolean(keyword || (openGroups[section.key] ?? section.routes.some(route => selectedKey === route.path)));
  const selectedSection = visible.find(section => section.routes.some(route => route.path === selectedKey));
  // Only the permitted current route owns the shared surface; hover/focus cannot steal it.
  const selectedValue = !flat && selectedSection && selectedSection.key !== "overview" && (collapsed || !isExpanded(selectedSection))
    ? `group:${selectedSection.key}` : selectedSection ? selectedKey : null;
  return <Highlight mode="parent" controlledItems value={selectedValue} enabled={selectedValue !== null} hover={false} click={false}
    containerClassName="rental-sidebar-navigation" className="rental-sidebar-route-highlight">
    {overview && <SidebarGroup>{overview.label && <SidebarGroupLabel>{t(overview.label)}</SidebarGroupLabel>}<SidebarMenu>
      {overview.routes.map(route => <SidebarMenuItem key={route.path}><HighlightItem value={route.path} asChild><div className="rental-sidebar-route-target"><SidebarMenuButton render={flat ? <a href={route.path} /> : undefined} data-route={route.path} data-sound="page" aria-current={selectedKey === route.path ? "page" : undefined} isActive={selectedKey === route.path} tooltip={t(route.label)} onClick={event => {
        if (flat && (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
        event.preventDefault(); onNavigate(route.path);
      }}>
        {flat ? route.icon : <AnimatedIcon name={route.path === "/workbench" ? "dashboard" : route.path === "/notifications" ? "messages" : "report"} />}<span>{t(menuRouteLabel(route.path, route.label))}</span>
      </SidebarMenuButton></div></HighlightItem></SidebarMenuItem>)}
    </SidebarMenu></SidebarGroup>}
    {!flat && visible.some(s => s.key !== "overview") && <SidebarGroup><SidebarGroupLabel>{t("业务管理")}</SidebarGroupLabel><SidebarMenu>
      {visible.filter(s => s.key !== "overview").map(section => {
        const active = section.routes.some(route => selectedKey === route.path);
        const expanded = isExpanded(section);
        const label = t(MENU_GROUP_LABELS[section.key] ?? section.label);
        const panelId = `${submenuId}-${section.key}`;
        const panelOpen = expanded && !collapsed;
        return <DropdownMenu key={section.key} modal={false} open={collapsed && popupGroup === section.key}
          onOpenChange={(open, details) => {
            // In the wide sidebar this same trigger owns the inline group, never a popup.
            if (!collapsed) { details.cancel(); return; }
            setPopupGroup(current => open ? section.key : current === section.key ? null : current);
          }}>
          <SidebarMenuItem className="rental-menu-group" data-open={panelOpen || undefined}><HighlightItem value={`group:${section.key}`} asChild><div className="rental-sidebar-route-target">
            <DropdownMenuTrigger aria-label={label} aria-haspopup={collapsed ? "menu" : undefined}
              aria-expanded={collapsed ? popupGroup === section.key : expanded} aria-controls={collapsed ? undefined : panelId}
              data-sound="press" onClick={() => { if (!collapsed) setOpenGroups(groups => ({ ...groups, [section.key]: !expanded })); }}
              render={<SidebarMenuButton tooltip={label} isActive={active && !panelOpen} />}>
              <AnimatedIcon name={groupIcons[section.key] ?? "rules"} />
              <span className="rental-sidebar-label" title={label}>{label}</span>
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="rental-sidebar-group-chevron" />
            </DropdownMenuTrigger>
          </div></HighlightItem>
          <motion.div id={panelId} className="rental-sidebar-submenu-motion" role="group" aria-label={label}
            aria-hidden={!panelOpen || undefined} inert={!panelOpen || undefined} data-rail={collapsed || undefined}
            initial={false} animate={{ height: panelOpen ? "auto" : 0, opacity: expanded ? 1 : 0 }}
            transition={reduced ? { duration: 0 } : expanded ? submenuTransition : submenuExitTransition}>
            <div className="rental-sidebar-submenu-content"><SidebarMenuSub>{section.routes.map(route => <HighlightItem key={route.path} value={route.path} activeClassName="rental-sidebar-sub-highlight" asChild><SidebarMenuSubItem>
              <SidebarMenuSubButton data-route={route.path} data-sound="page" aria-current={selectedKey === route.path ? "page" : undefined} isActive={selectedKey === route.path} render={<a href={route.path} />}
                onClick={event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate(route.path); }}>
                <span>{t(menuRouteLabel(route.path, route.label))}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem></HighlightItem>)}</SidebarMenuSub></div>
          </motion.div></SidebarMenuItem>
          <DropdownMenuContent className="rental-sidebar-submenu" side="right" align="start" sideOffset={8} aria-label={label}>
            <DropdownMenuGroup><DropdownMenuLabel>{label}</DropdownMenuLabel>
              {section.routes.map(route => <DropdownMenuItem key={route.path} render={<a href={route.path} />}
                data-route={route.path} data-sound="page" aria-current={selectedKey === route.path ? "page" : undefined}
                onClick={event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setPopupGroup(null); onNavigate(route.path); }}>
                <span>{t(menuRouteLabel(route.path, route.label))}</span>
                {selectedKey === route.path && <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />}
              </DropdownMenuItem>)}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>;
      })}
    </SidebarMenu></SidebarGroup>}
    {!visible.length && keyword && <SidebarGroup><SidebarGroupLabel>{t("没有匹配的菜单")}</SidebarGroupLabel></SidebarGroup>}
  </Highlight>;
}
