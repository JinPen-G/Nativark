/** 原 Rental 菜单别名由本宿主提供；公共导航维护同一几何与动效。 */
import { NativeNavigation as SharedNavigation, type ShellNavigationSection } from "@rental-os/platform-admin/source/components/animate-sidebar/NativeNavigation";
import { MENU_GROUP_LABELS, menuRouteLabel } from "@/app/navigation-display";
import { AnimatedIcon, type AnimatedIconName } from "../ui/AnimatedIcon";
export type { ShellNavigationSection } from "@rental-os/platform-admin/source/components/animate-sidebar/NativeNavigation";
const groupIcons: Record<string, AnimatedIconName> = { overview: "dashboard", transactions: "orders", inventory: "inventory",
  commercial: "pricing", customers: "customers", "operations-foundation": "rules",
  "account-access": "access", "service-channels": "plugins", "finance-reconciliation": "finance" };

export function NativeNavigation(props: {
  sections: Omit<ShellNavigationSection, "icon">[]; selectedKey: string; query: string;
  onNavigate: (path: string) => void; flat?: boolean;
}) {
  return <SharedNavigation {...props} sections={props.sections.map(section => ({ key: section.key,
    label: MENU_GROUP_LABELS[section.key] ?? section.label,
    icon: <AnimatedIcon name={groupIcons[section.key] ?? "rules"} />,
    routes: section.routes.map(route => ({ ...route, displayLabel: menuRouteLabel(route.path, route.label) }))
  }))} />;
}
