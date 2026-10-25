import { MenuOutlined } from "@/components/ui/icons";
import { Breadcrumb, Layout } from "antd";
import { Button, Drawer, Tooltip, SidebarMenu } from "@/components/ui";
import { motion } from "motion/react";
import { Bell, ChevronLeft, ChevronRight } from "lucide-react";
import type { MenuProps } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { APP_ROUTES, buildNavigationSections, canAccessRoute } from "@/app/navigation";
import { useAppearance } from "@/app/theme";
import { useAuthStore } from "@/features/auth/authStore";
import { AccountMenu } from "./AccountMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { SidebarQuickEntries } from "./SidebarQuickEntries";
import { WorkspaceClock } from "./WorkspaceClock";
import { SubscriptionExpiryFloatingCard } from "@/features/subscription/SubscriptionExpiryFloatingCard";
import { WorkspaceNavigationProvider, useWorkspaceNavigation } from "./workspace/WorkspaceNavigation";

const { Sider, Content } = Layout;

/**
 * 侧栏 / 抽屉的切换点。
 *
 * 刻意不用 antd 的 `Grid.useBreakpoint()`：它首帧返回空对象（`screens.lg` 为
 * `undefined`），而且实测视口变窄后没有更新，结果 768px 仍被判成桌面、抽屉永远出不来。
 * `matchMedia` 是同一件事的直接表达，首帧就有确定值，也能被直接断言。
 */
function useMinWidth(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

/**
 * 侧栏的响应式分档：
 * - 1200px 及以上默认展开完整侧栏；
 * - 768px～1199px 保留桌面布局，但默认收起为图标栏；
 * - 768px 以下才使用移动端抽屉。
 */
const DESKTOP_MIN_WIDTH = "(min-width: 768px)";
const WIDE_DESKTOP_MIN_WIDTH = "(min-width: 1200px)";

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => !window.matchMedia(WIDE_DESKTOP_MIN_WIDTH).matches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // One visible selection across fixed entries and business routes, including shared preview destinations.
  const [fixedSelection, setFixedSelection] = useState<string>();
  const navRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const navigation = useWorkspaceNavigation(contentRef);
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLocale();
  const { mode } = useAppearance();
  const isDesktop = useMinWidth(DESKTOP_MIN_WIDTH);
  const isWideDesktop = useMinWidth(WIDE_DESKTOP_MIN_WIDTH);
  const tenant = useAuthStore((state) => state.tenant);
  const user = useAuthStore((state) => state.user);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const hasTenantMembershipPermission = useAuthStore((state) => state.hasTenantMembershipPermission);
  const currentWorkspaceId = useAuthStore((state) => state.currentWorkspaceId);
  /**
   * UI-NAV-01：导航文案取自**当前经营空间**的品类档案。
   *
   * 复用业务页面已有的查询键，命中同一份缓存，不额外增加一次请求；
   * 空间切换时 `switchWorkspace()` 已清空查询缓存、`ProtectedRoutes` 又以
   * `租户:空间` 为 key 重挂本组件，因此这里会重新取数，菜单与标题
   * 随即换成新品类的说法，不会残留上一个空间的术语。
   *
   * SaaS 平台账号不发这个请求：它不属于任何经营空间，租户品类档案对它没有意义，
   * 发出去只会拿到 403 并把平台导航染上某个租户的术语。
   */
  const categoryProfile = useQuery({
    queryKey: ["rental-core", "profile"],
    queryFn: rentalCoreApi.profile,
    enabled: Boolean(user && !user.isSaasAdmin && currentWorkspaceId && (
      hasPermission("rental-os:order:view") || hasPermission("rental-core:catalog:view") || hasPermission("rental-core:asset:view")
    ))
  });
  const terminology = categoryProfile.data?.terminology;
  const sections = useMemo(() => buildNavigationSections(terminology).map((section) => ({
    ...section,
    routes: section.routes.filter((route) => route.menu && canAccessRoute(route, hasPermission, hasCapability, tenant?.categoryCode, Boolean(user?.isSaasAdmin), hasTenantMembershipPermission))
  })).filter((section) => section.routes.length > 0), [hasCapability, hasPermission, hasTenantMembershipPermission, tenant?.categoryCode, terminology, user]);
  const homePath = sections[0]?.routes[0]?.path ?? "/";
  // Tenant overview when authorized; platform/restricted users retain an accessible destination.
  const overviewPath = canAccessRoute(APP_ROUTES.workbench, hasPermission, hasCapability, tenant?.categoryCode, Boolean(user?.isSaasAdmin), hasTenantMembershipPermission)
    ? APP_ROUTES.workbench.path : homePath;
  const activeFixedKey = location.pathname === overviewPath ? fixedSelection : undefined;
  useEffect(() => { if (location.pathname !== overviewPath) setFixedSelection(undefined); }, [location.pathname, overviewPath]);
  /**
   * 展开态：一级是**不可点的分组标题**，二级直接铺开（`type: "group"`）。
   *
   * 收起态：一级换成**只有图标的父项**（去掉 `type`，即 SubMenu），二级收进悬浮浮层。
   * 64px 宽放不下分组标题，但把二级平铺成一串图标会丢掉归属关系；保留一级、
   * 悬停才展开二级，层级和展开态是同一套说法。
   *
   * 收起判据传参而不是直接读 `collapsed`：抽屉里永远是展开态，两处必须一致，
   * 否则抽屉会拿到收起态的结构。
   */
  const buildMenuItems = (isCollapsed: boolean): MenuProps["items"] => sections.map((section) => {
    const children = section.routes.map((route) => ({ key: route.path, icon: route.icon, label: t(route.label) }));
    return isCollapsed
      ? { key: section.key, icon: section.icon, label: t(section.label), children }
      : { type: "group" as const, key: section.key, label: t(section.label), children };
  });
  const routes = useMemo(() => sections.flatMap((section) => section.routes), [sections]);
  const current = useMemo(() => {
    const route = routes.find((entry) => entry.path === location.pathname)
      ?? [...routes].sort((a, b) => b.path.length - a.path.length).find((entry) => location.pathname.startsWith(`${entry.path}/`));
    return {
      route,
      section: sections.find((section) => section.routes.some((entry) => entry.path === route?.path))
    };
  }, [location.pathname, routes, sections]);
  // Detail routes inherit the longest permitted menu parent, including future record pages.
  const selectedKey = current.route?.path ?? location.pathname;
  const detailRoute = Object.values(APP_ROUTES).find(route => matchPath(route.path, location.pathname)
    && canAccessRoute(route, hasPermission, hasCapability, tenant?.categoryCode, Boolean(user?.isSaasAdmin), hasTenantMembershipPermission));
  const breadcrumbItems = [
    ...(current.section ? [{ title: <span className="breadcrumb-section">{current.section.icon}{t(current.section.label)}</span> }] : []),
    { title: detailRoute && detailRoute.path !== current.route?.path && current.route
      ? <button type="button" className="breadcrumb-link" onClick={() => navigate(current.route!.path)}>{t(current.route.label)}</button>
      : t(current.route?.label ?? detailRoute?.label ?? "工作台") },
    ...(detailRoute && current.route && detailRoute.path !== current.route.path ? [{ title: t(detailRoute.label) }] : []),
  ];

  // 路由变化即关抽屉：窄屏点完菜单还压着一层浮层，等于点了没反应。
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // 进入真正的移动端时交给抽屉；回到窄桌面时自动恢复图标栏，避免把移动端状态带回桌面。
  // 从窄桌面恢复到宽桌面时自动展开；宽桌面内的手动收起不会因普通重渲染被覆盖。
  useEffect(() => {
    if (!isDesktop) {
      setCollapsed(false);
      return;
    }
    setCollapsed(!isWideDesktop);
  }, [isDesktop, isWideDesktop]);
  /**
   * 刷新后把选中项滚进视野。
   *
   * 侧栏是独立滚动容器，重新挂载时 scrollTop 归零；二级全部常显后菜单远超一屏，
   * 靠后的选中项会停在可视区外，看起来像"选中态丢了"。
   * `block: "nearest"` 只在确实不可见时滚动，因此点击菜单这种本来就可见的场景不会跳动。
   * 依赖里带上 `sections`：权限与品类档案是异步到的，菜单变长后位置会重排。
   */
  useEffect(() => {
    navRef.current?.querySelector(".ant-menu-item-selected, .ant-menu-submenu-selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedKey, sections, drawerOpen]);
  /**
   * 侧栏内容抽成一个渲染函数：常驻侧栏与窄屏抽屉必须是同一份导航，
   * 各写一份迟早会只改其中一处。`inDrawer` 只影响收起态（抽屉里没有收起的意义）。
   */
  const renderSider = (inDrawer = false) => (
    <div id={inDrawer ? undefined : "workspace-sidebar"} className={`sider-shell${collapsed && !inDrawer ? " is-collapsed" : ""}`}>
      <div className="sider-workspace"><WorkspaceSwitcher collapsed={collapsed && !inDrawer} /></div>
      <SidebarQuickEntries collapsed={collapsed && !inDrawer} selectedKey={activeFixedKey}
        onNavigate={key => { setFixedSelection(key); navigation.fromSidebar(overviewPath); setDrawerOpen(false); }} />

      <motion.div layoutScroll className="sider-nav" ref={navRef}>
        <SidebarMenu
          mode="inline"
          inlineCollapsed={collapsed && !inDrawer}
          selectedKeys={activeFixedKey ? [] : [selectedKey]}
          items={buildMenuItems(collapsed && !inDrawer)}
          onClick={({ key }) => { if (String(key).startsWith("/")) { setFixedSelection(undefined); navigation.fromSidebar(String(key)); } }}
        />
      </motion.div>

      <div className="sider-account">
        <AccountMenu collapsed={collapsed && !inDrawer} />
      </div>
    </div>
  );

  return (
    <div className="app-frame-stage">
      <Layout className="app-shell">
        {isDesktop ? (
          <Sider
            className="app-sider"
            width={240}
            collapsedWidth={64}
            trigger={null}
            collapsible
            collapsed={collapsed}
            theme={mode === "dark" ? "dark" : "light"}
          >
            {renderSider()}
            <Tooltip title={collapsed ? t("展开导航") : t("收起导航")}>
              <Button type="default" size="small" shape="circle" className="sider-edge-toggle"
                aria-label={collapsed ? t("展开导航") : t("收起导航")}
                aria-expanded={!collapsed} aria-controls="workspace-sidebar"
                icon={collapsed ? <ChevronRight size={15} aria-hidden="true" /> : <ChevronLeft size={15} aria-hidden="true" />}
                onClick={() => setCollapsed(value => !value)} />
            </Tooltip>
          </Sider>
        ) : (
          <>
            <Button
              className="sider-drawer-trigger"
              type="text"
              aria-label={t("打开导航")}
              icon={<MenuOutlined />}
              onClick={() => setDrawerOpen(true)}
            />
            <Drawer
              className="sider-drawer"
              placement="left"
              size={272}
              open={drawerOpen}
              destroyOnHidden
              closable={false}
              styles={{ body: { padding: 0 } }}
              onClose={() => setDrawerOpen(false)}
            >
              {renderSider(true)}
            </Drawer>
          </>
        )}

        <Layout className="app-workspace">
          <header className="workspace-context">
            <div className="workspace-context-location">
              <Breadcrumb aria-label={t("面包屑")} items={breadcrumbItems} />
            </div>
            <div className="workspace-context-actions"><WorkspaceClock />
              <Tooltip title={t("通知入口预留，暂未接入")}>
                <Button type="text" size="small" className="workspace-notifications" aria-label={t("通知")} aria-disabled="true" icon={<Bell size={19} strokeWidth={1.75} />} />
              </Tooltip>
            </div>
          </header>
          <Content ref={contentRef} className="app-content"><main className="content-canvas"><WorkspaceNavigationProvider value={navigation.context}>{children}</WorkspaceNavigationProvider></main></Content>
        </Layout>
      </Layout>
      {/* SUB-02 §5.4 到期提醒：全局左下角浮窗，随各页常驻（无数据/平台账号时自渲染为空）。 */}
      <SubscriptionExpiryFloatingCard />
    </div>
  );
}
