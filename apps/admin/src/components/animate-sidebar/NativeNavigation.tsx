import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { AppNavigationSection } from "@/app/navigation";
import { MENU_GROUP_LABELS, menuRouteLabel } from "@/app/navigation-display";
import { useLocale } from "@/app/locale";
import { useEffect, useState } from "react";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton, useSidebar } from "./runtime/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./runtime/collapsible";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem } from "./runtime/dropdown-menu";
import { AnimatedIcon, type AnimatedIconName } from "../ui/AnimatedIcon";

const groupIcons: Record<string, AnimatedIconName> = { overview: "dashboard", transactions: "orders", inventory: "inventory",
  commercial: "pricing", customers: "customers", "operations-foundation": "rules",
  "account-access": "access", "service-channels": "plugins", "finance-reconciliation": "finance" };

export function NativeNavigation({ sections, selectedKey, query, onNavigate }: {
  sections: AppNavigationSection[]; selectedKey: string; query: string; onNavigate: (path: string) => void;
}) {
  const { t } = useLocale(), { state, isMobile } = useSidebar();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [popupGroup, setPopupGroup] = useState<string | null>(null);
  const keyword = query.trim().toLocaleLowerCase();
  const visible = sections.map(section => ({ ...section, routes: section.routes.filter(route => !keyword ||
    [route.label, menuRouteLabel(route.path, route.label), t(route.label), t(menuRouteLabel(route.path, route.label))].some(label => label.toLocaleLowerCase().includes(keyword))) })).filter(s => s.routes.length);
  const collapsed = !isMobile && state === "collapsed";
  useEffect(() => { setPopupGroup(null); }, [collapsed, selectedKey, keyword]);
  const overview = visible.find(s => s.key === "overview");
  const isExpanded = (section: AppNavigationSection) => Boolean(keyword || (openGroups[section.key] ?? section.routes.some(route => selectedKey === route.path)));
  const selectedSection = visible.find(section => section.routes.some(route => route.path === selectedKey));
  // Only the permitted current route owns the shared surface; hover/focus cannot steal it.
  const selectedValue = selectedSection && selectedSection.key !== "overview" && (collapsed || !isExpanded(selectedSection))
    ? `group:${selectedSection.key}` : selectedSection ? selectedKey : null;
  return <Highlight mode="parent" controlledItems value={selectedValue} enabled={selectedValue !== null} hover={false} click={false}
    containerClassName="rental-sidebar-navigation" className="rental-sidebar-route-highlight">
    {overview && <SidebarGroup><SidebarGroupLabel>{t(overview.label)}</SidebarGroupLabel><SidebarMenu>
      {overview.routes.map(route => <SidebarMenuItem key={route.path}><HighlightItem value={route.path} asChild><div className="rental-sidebar-route-target"><SidebarMenuButton data-route={route.path} data-sound="page" aria-current={selectedKey === route.path ? "page" : undefined} isActive={selectedKey === route.path} tooltip={t(route.label)} onClick={() => onNavigate(route.path)}>
        <AnimatedIcon name={route.path === "/workbench" ? "dashboard" : "report"} /><span>{t(menuRouteLabel(route.path, route.label))}</span>
      </SidebarMenuButton></div></HighlightItem></SidebarMenuItem>)}
    </SidebarMenu></SidebarGroup>}
    {visible.some(s => s.key !== "overview") && <SidebarGroup><SidebarGroupLabel>{t("业务管理")}</SidebarGroupLabel><SidebarMenu>
      {visible.filter(s => s.key !== "overview").map(section => {
        const active = section.routes.some(route => selectedKey === route.path);
        const expanded = isExpanded(section);
        const label = t(MENU_GROUP_LABELS[section.key] ?? section.label);
        if (collapsed) return <DropdownMenu key={section.key} modal={false} open={popupGroup === section.key}
          onOpenChange={open => setPopupGroup(current => open ? section.key : current === section.key ? null : current)}>
          <SidebarMenuItem><HighlightItem value={`group:${section.key}`} asChild><div className="rental-sidebar-route-target">
            <DropdownMenuTrigger aria-label={label} data-sound="press" render={<SidebarMenuButton isActive={active} />}>
              <AnimatedIcon name={groupIcons[section.key] ?? "rules"} />
            </DropdownMenuTrigger>
          </div></HighlightItem></SidebarMenuItem>
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
        return <Collapsible key={section.key} open={expanded} onOpenChange={open => setOpenGroups(groups => ({ ...groups, [section.key]: open }))} className="group/collapsible rental-menu-group">
          <SidebarMenuItem>
            {/* Measure the trigger row only, never the still-exiting submenu. */}
            <HighlightItem value={`group:${section.key}`} asChild><div className="rental-sidebar-route-target">
              <CollapsibleTrigger data-sound="press" render={<SidebarMenuButton tooltip={label} isActive={active && !expanded} />}>
                <AnimatedIcon name={groupIcons[section.key] ?? "rules"} />
                <span>{t(MENU_GROUP_LABELS[section.key] ?? section.label)}</span>
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="ml-auto transition-transform duration-350 ease-[cubic-bezier(0.215,0.61,0.355,1)] group-data-open/collapsible:rotate-90" />
              </CollapsibleTrigger>
            </div></HighlightItem>
            <CollapsibleContent><SidebarMenuSub>{section.routes.map(route => <HighlightItem key={route.path} value={route.path} activeClassName="rental-sidebar-sub-highlight" asChild><SidebarMenuSubItem>
              <SidebarMenuSubButton data-route={route.path} data-sound="page" aria-current={selectedKey === route.path ? "page" : undefined} isActive={selectedKey === route.path} render={<a href={route.path} />}
                onClick={event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate(route.path); }}>
                <span>{t(menuRouteLabel(route.path, route.label))}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem></HighlightItem>)}</SidebarMenuSub></CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>;
      })}
    </SidebarMenu></SidebarGroup>}
    {!visible.length && keyword && <SidebarGroup><SidebarGroupLabel>{t("没有匹配的菜单")}</SidebarGroupLabel></SidebarGroup>}
  </Highlight>;
}
