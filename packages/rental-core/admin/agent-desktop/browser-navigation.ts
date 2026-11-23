/** 桌面菜单投影当前 Web 登记与授权，原页面标识由同一导航端口解析。
 * 只接收宿主当前菜单，命令仍由原桥接按最新会话和登记目标核验。
 */
import { rentalDesktopPath } from "@rental-os/shared/agent-desktop";
import type { RentalAssistantNavigation, RentalAssistantRoute } from "../assistant";
import type {
  DesktopNavigationRoute,
  DesktopNavigationSection,
  DesktopNavigationSource,
} from "./desktop-session-projection";

export interface RentalDesktopBrowserNavigationOptions {
  /** 原助手导航 hook，消费同一会话、当前登记和真实公共页面端口。 */
  useNavigation: () => RentalAssistantNavigation;
  /** 同一 Web 壳当前已过滤的分组，包含原品类称呼；须订阅菜单变化。 */
  useSections: () => readonly DesktopNavigationSection[];
}

export function createRentalDesktopBrowserNavigation({ useNavigation, useSections }: RentalDesktopBrowserNavigationOptions) {
  return function useRentalDesktopBrowserNavigation(): DesktopNavigationSource {
    const navigation = useNavigation();
    const sections = useSections();

    function currentPath(route: RentalAssistantRoute): string | undefined {
      if (!route.menu || !navigation.canAccess(route)) return undefined;
      const path = navigation.resolve(route.path);
      if (!path || navigation.originalPath(path) !== route.path) return undefined;
      try {
        return rentalDesktopPath(path);
      } catch {
        return undefined;
      }
    }

    const registered = new Map<string, { id: string; original: RentalAssistantRoute; route: DesktopNavigationRoute }>();
    for (const [id, original] of Object.entries(navigation.routes)) {
      const path = currentPath(original);
      if (path) registered.set(path, { id, original, route: { path, label: original.label, menu: true } });
    }
    const visible = new Set<string>();
    const projected = sections.map(section => ({
      key: section.key,
      label: section.label,
      routes: section.routes.flatMap(route => {
        const entry = registered.get(route.path);
        if (!entry || route.menu === false) return [];
        visible.add(entry.id);
        return [{ ...entry.route, label: route.label }];
      }),
    })).filter(section => section.routes.length > 0);

    return {
      routes: Object.fromEntries([...registered.values()].filter(entry => visible.has(entry.id))
        .map(entry => [entry.id, entry.route])),
      sections: () => projected,
      // 原桥接在命令完成后再读投影，旧菜单对象不能保留已经撤销的访问。
      allowed(route) {
        const entry = registered.get(route.path);
        return Boolean(entry && visible.has(entry.id) && currentPath(entry.original) === route.path);
      },
    };
  };
}
