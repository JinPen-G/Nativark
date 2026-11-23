/** 公共后台外壳组合。业务路由、菜单和面包屑来自同一受控注册表，当前使用权来自服务端目录。 */
import { Breadcrumb } from "antd";
import { useCallback, useMemo, useState, type ComponentProps, type ReactNode } from "react";
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
import { useAdminBrandIcon } from "./app/BrandIconProvider";
import { HugeiconsIcon } from "@hugeicons/react";
import { CreditCardIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import { WorkspaceClock } from "./components/WorkspaceClock";
import { SubscriptionExpiryFloatingCard, hasSubscriptionPermission } from "./features/subscription";
import { canManagePublicResource } from "./application-access";
import { publicAdminMenuPath } from "./application-navigation";

const shellMessages = {
  "功能导航": "Navigation", "业务 Core": "Business Core", "平台管理面": "Platform administration", "管理后台": "Admin console",
  "面包屑": "Breadcrumb", "收起面板": "Collapse panel", "展开面板": "Expand panel"
};

const noMessages: ShellNotifications = { messages: [], loading: false, error: false, refresh: () => undefined, update: () => undefined };
const noPages: ReadonlyMap<string, CoreRegisteredPage<CoreRouteComponent>> = new Map();

/** 可信宿主接回原 Agent/Copilot 呈现；插槽不改变菜单、路由或接口的授权集合。 */
export type PlatformShellLayout = Pick<ComponentProps<typeof BusinessShell>,
  "navigation" | "sidebarExtra" | "headerContext" | "headerClassName" | "headerPanelControl" | "contentClassName" | "wrapContent">;

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
  layout?: Partial<PlatformShellLayout>;
  /** 受控宿主仅调整已获权菜单的呈现与排序，业务访问仍由原路由/API核验。 */
  mapNavigation?: (sections: ShellNavigationSection[]) => ShellNavigationSection[];
}

export function PlatformShell(props: PlatformShellProps) {
  const session = useAdminSession(), runtime = useAdminRuntime();
  const identity = JSON.stringify([session.tenant?.tenantId, session.user?.id, runtime.currentSessionEpoch()]);
  return <RestProvider key={identity} browserSession={Boolean(session.user && session.tenant && !session.user.isSaasAdmin)} verified={session.sessionVerified}>
    <ShellContents {...props} identity={identity} />
  </RestProvider>;
}

function ShellContents({ children, brandName, brand, publicSections, pages = noPages, onSignOut,
  notifications = noMessages, notificationDetails, panel, contextSwitcher, mapNavigation, layout, identity }: PlatformShellProps & { identity: string }) {
  const { t: translate, locale } = useLocale(), session = useAdminSession(), cores = useCoreSession();
  const t = (value: string) => locale === "en-US" ? shellMessages[value as keyof typeof shellMessages] ?? translate(value) : value;
  const location = useLocation(), navigate = useNavigate();
  const brandIcon = useAdminBrandIcon();
  const [panelOpen, setPanelOpen] = useState(false);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const sections = useMemo(() => {
    const entries = cores.data ? coreNavigationEntries(pages, cores.data, locale) : [];
    const groups = new Map<string, ShellNavigationSection>(publicSections.map(section => [section.key,
      { ...section, routes: [...section.routes] }]));
    for (const entry of entries) {
      const label = entry.group ?? entry.coreName;
      const shared = publicSections.find(section => translate(section.label) === label || section.label === label);
      const key = shared?.key ?? JSON.stringify([entry.coreId, entry.group]);
      const group = groups.get(key) ?? { key, label, routes: [] };
      group.routes.push({ path: entry.path, label: entry.label });
      groups.set(key, group);
    }
    const result = [...groups.values()];
    return mapNavigation ? mapNavigation(result) : result;
  }, [publicSections, cores.data, pages, locale, translate, mapNavigation]);
  const matched = matchRoutes(
    [...pages.values()].map(page => ({ path: page.path, handle: page })),
    location.pathname,
  )?.at(-1);
  const registered = matched?.route.handle;
  const publicPathname = publicAdminMenuPath(location.pathname);
  const publicRoute = publicSections.flatMap(section => section.routes)
    .filter(route => route.path === publicPathname || publicPathname.startsWith(`${route.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0];
  const breadcrumbs = registered && cores.data ? coreBreadcrumbEntries(pages, registered,
    Object.fromEntries(Object.entries(matched?.params ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")), cores.data, locale) : [];
  // 菜单沿 Router 已匹配的路径定位，编码后的 Core 和静态页片段也对应同一登记项。
  const currentPathname = matched?.pathname ?? publicPathname;
  const current = sections.flatMap(section => section.routes).filter(route => currentPathname === route.path || currentPathname.startsWith(`${route.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const currentSection = sections.find(section => section.routes.some(route => route.path === current?.path));
  const sectionCrumb = currentSection?.label ? [{ key: "section", title: <span className="breadcrumb-section">{t(currentSection.label)}</span> }] : [];
  const items = breadcrumbs.length ? [...sectionCrumb, ...breadcrumbs.map((crumb, index) => ({ key: crumb.key, title: crumb.path
    ? <button type="button" className="breadcrumb-link" onClick={() => navigate(crumb.path!)}>{crumb.label}</button>
    : index === breadcrumbs.length - 1 ? <WorkspaceBreadcrumbCurrent>{crumb.label}</WorkspaceBreadcrumbCurrent> : crumb.label }))]
    : [...sectionCrumb, { key: "current", title: <WorkspaceBreadcrumbCurrent>{t(publicRoute?.label ?? "工作台")}</WorkspaceBreadcrumbCurrent> }];
  const saas = session.user?.isSaasAdmin === true;
  const settingsPath = saas ? "/platform/system" : "/settings/appearance";
  const canSettings = canManagePublicResource(session.user, saas ? "saas" : "tenant", saas ? "system:params:manage" : "system:integration:manage");
  const billingPermission = saas ? "system:tenant:subscription:manage" : "rental-os:subscription:view";
  return <BusinessShell fullWidth={!saas} referenceSidebar identity={identity} selectedKey={current?.path ?? location.pathname}
    brand={contextSwitcher ?? <NativeContextSwitcher title={saas ? brandName : session.tenant?.tenantName || brandName}
      fullTitle={saas ? brandName : session.tenant?.tenantName || brandName} subtitle={t(session.user?.isSaasAdmin ? "平台管理面" : "管理后台")}
      brand={brand} brandUnframed={brandIcon.isPlatformMark} compact options={[]} value="" label={t("业务 Core")} onChange={() => undefined} />}
    account={<NativeAccountMenuView name={session.user?.displayName ?? ""} account={session.user?.account ?? ""}
      compact
      billingAction={hasSubscriptionPermission(session.user, billingPermission) ? {
        label: t("版本订阅"), icon: <HugeiconsIcon icon={CreditCardIcon} strokeWidth={2} />,
        onSelect: () => navigate(saas ? "/platform/subscriptions" : "/settings/subscription")
      } : undefined}
      actions={canSettings ? [{ label: t(saas ? "平台参数" : "外观与音效"),
        icon: <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} />, onSelect: () => navigate(settingsPath) }] : []}
      onSignOut={onSignOut} />}
    navigation={layout?.navigation ?? (({ query, onNavigate }) => <NativeNavigation sections={sections} selectedKey={current?.path ?? location.pathname}
      query={query} onNavigate={onNavigate} />)}
    sidebarExtra={layout?.sidebarExtra}
    headerClassName={layout?.headerClassName}
    contentClassName={layout?.contentClassName}
    headerTitleTarget={false} headerContext={layout?.headerContext ?? <Breadcrumb aria-label={t("面包屑")}
      separator={<RightOutlined size={13} className="workspace-breadcrumb-separator" />} items={items} />}
    headerUtilities={<><RestEntry /><HeaderNotifications inbox={notifications} renderDetails={notificationDetails} /></>}
    headerTime={<WorkspaceClock />}
    headerPanelControl={layout?.headerPanelControl ?? (panel && <WorkspacePanelToggle open={panelOpen} onChange={setPanelOpen} controls="platform-workspace-panel"
      label={t(panelOpen ? "收起面板" : "展开面板")} />)}
    wrapContent={layout?.wrapContent ?? (column => panel ? <WorkspacePanel id="platform-workspace-panel" label={t("业务 Core")} open={panelOpen}
      onClose={closePanel} panel={panel}>{column}</WorkspacePanel> : <div className="workspace-main-panel">{column}</div>)}
    overlay={<SubscriptionExpiryFloatingCard />}>
    {children}
  </BusinessShell>;
}
