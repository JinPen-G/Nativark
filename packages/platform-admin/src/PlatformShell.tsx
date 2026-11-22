/** 公共后台外壳组合。业务路由、菜单和面包屑来自同一受控注册表，当前使用权来自服务端目录。 */
import { Breadcrumb } from "antd";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { matchRoutes, useLocation, useNavigate } from "react-router-dom";
import { coreBreadcrumbEntries, coreNavigationEntries, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { BusinessShell } from "./components/BusinessShell";
import { NativeNavigation, type ShellNavigationSection } from "./components/animate-sidebar/NativeNavigation";
import { NativeAccountMenuView } from "./components/animate-sidebar/NativeAccountMenuView";
import { NativeContextSwitcher } from "./components/animate-sidebar/NativeContextSwitcher";
import { WorkspaceBreadcrumbCurrent } from "./components/workspace/WorkspaceHeader";
import { WorkspacePanel, WorkspacePanelToggle } from "./components/workspace/WorkspacePanel";
import { RightOutlined } from "./components/ui/icons";
import { HeaderNotifications, type ShellNotifications } from "./features/notifications/HeaderNotifications";
import { RestProvider } from "./features/rest/RestProvider";
import { RestEntry } from "./features/rest/RestEntry";
import { useAdminRuntime, useAdminSession } from "./runtime";
import { useCoreSession } from "./core/useCoreSession";
import type { CoreRouteComponent } from "./core/CoreRoutes";
import { useLocale } from "./app/locale";
import { coreNavigationMessage } from "./coreNavigationMessage";

const shellMessages = {
  "功能导航": "Navigation", "业务 Core": "Business Core", "平台管理": "Platform administration", "管理后台": "Admin console",
  "面包屑": "Breadcrumb", "收起面板": "Collapse panel", "展开面板": "Expand panel"
};

const noMessages: ShellNotifications = { messages: [], loading: false, error: false, refresh: () => undefined, update: () => undefined };
const noPages: ReadonlyMap<string, CoreRegisteredPage<CoreRouteComponent>> = new Map();

export interface PlatformShellProps {
  children: ReactNode;
  brandName: string;
  brand: ReactNode;
  contextSwitcher?: ReactNode;
  publicSections: ShellNavigationSection[];
  pages?: ReadonlyMap<string, CoreRegisteredPage<CoreRouteComponent>>;
  onSignOut: () => void | Promise<void>;
  notifications?: ShellNotifications;
  notificationDetails?: (id: string) => ReactNode;
  panel?: ReactNode;
}

export function PlatformShell(props: PlatformShellProps) {
  const session = useAdminSession(), runtime = useAdminRuntime();
  const identity = JSON.stringify([session.tenant?.tenantId, session.user?.id, runtime.currentSessionEpoch()]);
  return <RestProvider key={identity} browserSession={Boolean(session.user && session.tenant && !session.user.isSaasAdmin)} verified={session.sessionVerified}>
    <ShellContents {...props} identity={identity} />
  </RestProvider>;
}

function ShellContents({ children, brandName, brand, publicSections, pages = noPages, onSignOut,
  notifications = noMessages, notificationDetails, panel, contextSwitcher, identity }: PlatformShellProps & { identity: string }) {
  const { t: translate, locale } = useLocale(), session = useAdminSession(), cores = useCoreSession();
  const t = (value: string) => locale === "en-US" ? shellMessages[value as keyof typeof shellMessages] ?? translate(value) : value;
  const location = useLocation(), navigate = useNavigate();
  const [panelOpen, setPanelOpen] = useState(false);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const sections = useMemo(() => {
    const entries = cores.data ? coreNavigationEntries(pages, cores.data, locale) : [];
    const groups = new Map<string, ShellNavigationSection>();
    for (const entry of entries) {
      const key = JSON.stringify([entry.coreId, entry.group]);
      const group = groups.get(key) ?? { key, label: entry.group ? `${entry.coreName} · ${entry.group}` : entry.coreName, routes: [] };
      group.routes.push({ path: entry.path, label: entry.label });
      groups.set(key, group);
    }
    return [...publicSections, ...groups.values()];
  }, [publicSections, cores.data, pages, locale]);
  const matched = matchRoutes(
    [...pages.values()].map(page => ({ path: page.path, handle: page })),
    location.pathname,
  )?.at(-1);
  const registered = matched?.route.handle;
  const publicRoute = publicSections.flatMap(section => section.routes)
    .filter(route => route.path === location.pathname || location.pathname.startsWith(`${route.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0];
  const breadcrumbs = registered && cores.data ? coreBreadcrumbEntries(pages, registered,
    Object.fromEntries(Object.entries(matched?.params ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")), cores.data, locale) : [];
  // 菜单沿 Router 已匹配的路径定位，编码后的 Core 和静态页片段也对应同一登记项。
  const currentPathname = matched?.pathname ?? location.pathname;
  const current = sections.flatMap(section => section.routes).filter(route => currentPathname === route.path || currentPathname.startsWith(`${route.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const items = breadcrumbs.length ? breadcrumbs.map((crumb, index) => ({ key: crumb.key, title: crumb.path
    ? <button type="button" className="breadcrumb-link" onClick={() => navigate(crumb.path!)}>{crumb.label}</button>
    : index === breadcrumbs.length - 1 ? <WorkspaceBreadcrumbCurrent>{crumb.label}</WorkspaceBreadcrumbCurrent> : crumb.label }))
    : [{ key: "current", title: <WorkspaceBreadcrumbCurrent>{t(publicRoute?.label ?? "管理后台")}</WorkspaceBreadcrumbCurrent> }];
  const defaultPanel = <p>{coreNavigationMessage(pages, cores, locale, Boolean(session.user?.isSaasAdmin))}</p>;
  return <BusinessShell fullWidth={!session.user?.isSaasAdmin} identity={identity} selectedKey={current?.path ?? location.pathname}
    brand={contextSwitcher ?? <NativeContextSwitcher title={session.tenant?.operatorShortName || session.tenant?.tenantName || brandName}
      fullTitle={session.tenant?.tenantName || brandName} subtitle={t(session.user?.isSaasAdmin ? "平台管理" : "管理后台")}
      brand={brand} brandUnframed options={[]} value="" label={t("业务 Core")} onChange={() => undefined} />}
    account={<NativeAccountMenuView name={session.user?.displayName ?? ""} account={session.user?.account ?? ""}
      compact={!session.user?.isSaasAdmin} onSignOut={onSignOut} />}
    navigation={({ query, onNavigate }) => <NativeNavigation sections={sections} selectedKey={current?.path ?? location.pathname}
      query={query} onNavigate={onNavigate} groupLabel={t("功能导航")} />}
    headerTitleTarget={false} headerContext={<Breadcrumb aria-label={t("面包屑")}
      separator={<RightOutlined size={13} className="workspace-breadcrumb-separator" />} items={items} />}
    headerUtilities={<><RestEntry /><HeaderNotifications inbox={notifications} renderDetails={notificationDetails} /></>}
    headerPanelControl={<WorkspacePanelToggle open={panelOpen} onChange={setPanelOpen} controls="platform-workspace-panel"
      label={t(panelOpen ? "收起面板" : "展开面板")} />}
    wrapContent={column => <WorkspacePanel id="platform-workspace-panel" label={t("业务 Core")} open={panelOpen}
      onClose={closePanel} panel={panel ?? defaultPanel}>{column}</WorkspacePanel>}>
    {children}
  </BusinessShell>;
}
