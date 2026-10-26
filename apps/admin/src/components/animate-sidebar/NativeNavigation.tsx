import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, CreditCardIcon, DashboardSquare01Icon, Invoice01Icon, Layers01Icon, Settings01Icon, UserGroupIcon, CheckmarkBadge01Icon, CommandIcon } from "@hugeicons/core-free-icons";
import type { AppNavigationSection } from "@/app/navigation";
import { MENU_GROUP_LABELS, menuRouteLabel } from "@/app/navigation-display";
import { useLocale } from "@/app/locale";
import { useState } from "react";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton, useSidebar } from "./runtime/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./runtime/collapsible";

const groupIcons = { overview: DashboardSquare01Icon, transactions: Invoice01Icon, inventory: Layers01Icon,
  commercial: CreditCardIcon, customers: UserGroupIcon, "operations-foundation": Settings01Icon,
  "account-access": CheckmarkBadge01Icon, "service-channels": CommandIcon, "finance-reconciliation": Invoice01Icon };

export function NativeNavigation({ sections, selectedKey, query, onNavigate }: {
  sections: AppNavigationSection[]; selectedKey: string; query: string; onNavigate: (path: string) => void;
}) {
  const { t } = useLocale(), { state, isMobile, setOpen } = useSidebar();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const keyword = query.trim().toLocaleLowerCase();
  const visible = sections.map(section => ({ ...section, routes: section.routes.filter(route => !keyword ||
    [route.label, menuRouteLabel(route.path, route.label), t(route.label), t(menuRouteLabel(route.path, route.label))].some(label => label.toLocaleLowerCase().includes(keyword))) })).filter(s => s.routes.length);
  const collapsed = !isMobile && state === "collapsed";
  const overview = visible.find(s => s.key === "overview");
  return <>
    {overview && <SidebarGroup><SidebarGroupLabel>{t(overview.label)}</SidebarGroupLabel><SidebarMenu>
      {overview.routes.map(route => <SidebarMenuItem key={route.path}><SidebarMenuButton data-route={route.path} data-sound="page" aria-current={selectedKey === route.path ? "page" : undefined} isActive={selectedKey === route.path} tooltip={t(route.label)} onClick={() => onNavigate(route.path)}>
        <HugeiconsIcon icon={DashboardSquare01Icon} strokeWidth={2} /><span>{t(menuRouteLabel(route.path, route.label))}</span>
      </SidebarMenuButton></SidebarMenuItem>)}
    </SidebarMenu></SidebarGroup>}
    {visible.some(s => s.key !== "overview") && <SidebarGroup><SidebarGroupLabel>{t("业务管理")}</SidebarGroupLabel><SidebarMenu>
      {visible.filter(s => s.key !== "overview").map(section => {
        const active = section.routes.some(route => selectedKey === route.path);
        return <Collapsible key={section.key} open={keyword ? true : openGroups[section.key] ?? active} onOpenChange={open => setOpenGroups(groups => ({ ...groups, [section.key]: collapsed ? true : open }))} className="group/collapsible rental-menu-group">
          <SidebarMenuItem>
            <CollapsibleTrigger data-sound="press" render={<SidebarMenuButton tooltip={t(MENU_GROUP_LABELS[section.key] ?? section.label)} isActive={collapsed && active} />}
              onClick={() => { if (collapsed) setOpen(true); }}>
              <HugeiconsIcon icon={groupIcons[section.key as keyof typeof groupIcons] ?? Settings01Icon} strokeWidth={2} />
              <span>{t(MENU_GROUP_LABELS[section.key] ?? section.label)}</span>
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="ml-auto transition-transform duration-350 ease-[cubic-bezier(0.215,0.61,0.355,1)] group-data-open/collapsible:rotate-90" />
            </CollapsibleTrigger>
            <CollapsibleContent><SidebarMenuSub>{section.routes.map(route => <SidebarMenuSubItem key={route.path}>
              <SidebarMenuSubButton data-route={route.path} data-sound="page" aria-current={selectedKey === route.path ? "page" : undefined} isActive={selectedKey === route.path} render={<a href={route.path} />}
                onClick={event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate(route.path); }}>
                <span>{t(menuRouteLabel(route.path, route.label))}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>)}</SidebarMenuSub></CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>;
      })}
    </SidebarMenu></SidebarGroup>}
    {!visible.length && keyword && <SidebarGroup><SidebarGroupLabel>{t("没有匹配的菜单")}</SidebarGroupLabel></SidebarGroup>}
  </>;
}
