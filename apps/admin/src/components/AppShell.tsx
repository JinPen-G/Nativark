import {
  BellOutlined,
  BoxPlotOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  SettingOutlined
} from "@ant-design/icons";
import { App, Avatar, Breadcrumb, Button, Drawer, Dropdown, Layout, Menu, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { buildNavigationSections, canAccessRoute } from "@/app/navigation";
import { useAppearance } from "@/app/theme";
import { useAuthStore } from "@/features/auth/authStore";
import { AppearanceSwitcher } from "./AppearanceSwitcher";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const { Sider, Content } = Layout;

/**
 * 面包屑暂不展示。
 *
 * 二级菜单已经全部常显，面包屑那个「同组内跳转」的下拉在信息上是冗余的；
 * 但导航层级本身还没定论，所以**保留计算与渲染代码**，只用这个开关关掉显示，
 * 需要时改回 `true` 即可，不必重新实现。
 */
const SHOW_BREADCRUMB = false;

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

/** 侧栏在窄屏改成抽屉：`lg` 以下（<992px）没有常驻侧栏，由悬浮按钮唤出。 */
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { mode } = useAppearance();
  const isDesktop = useMinWidth("(min-width: 992px)");
  const tenant = useAuthStore((state) => state.tenant);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const homePath = user?.isSaasAdmin ? "/platform/tenants" : "/workbench";
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
    enabled: Boolean(user && !user.isSaasAdmin)
  });
  const terminology = categoryProfile.data?.terminology;
  const sections = useMemo(() => buildNavigationSections(terminology).map((section) => ({
    ...section,
    routes: section.routes.filter((route) => route.menu && canAccessRoute(route, hasPermission, hasCapability, tenant?.categoryCode, Boolean(user?.isSaasAdmin)))
  })).filter((section) => section.routes.length > 0), [hasCapability, hasPermission, tenant?.categoryCode, terminology, user?.isSaasAdmin]);
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
    const children = section.routes.map((route) => ({ key: route.path, icon: route.icon, label: route.label }));
    return isCollapsed
      ? { key: section.key, icon: section.icon, label: section.label, children }
      : { type: "group" as const, key: section.key, label: section.label, children };
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
  const selectedKey = location.pathname === "/rental/orders/new"
    ? "/rental/orders/new"
    : location.pathname.startsWith("/rental/orders/") ? "/rental/orders" : location.pathname;
  const accountInitial = (user?.displayName ?? "运营用户").slice(0, 1).toUpperCase();
  const accountCaption = user?.roleNames?.join(" · ") || user?.organizationName || tenant?.tenantCode || "运营账号";
  const breadcrumbMenuItems = useMemo(() => current.section?.routes.map((entry) => ({
    key: entry.path,
    label: entry.label,
    icon: entry.icon,
    onClick: () => navigate(entry.path)
  })) ?? sections.map((section) => ({
    key: section.key,
    label: section.label,
    icon: section.icon,
    onClick: () => navigate(section.routes[0].path)
  })), [current.section, navigate, sections]);

  // 路由变化即关抽屉：窄屏点完菜单还压着一层浮层，等于点了没反应。
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  /**
   * 侧栏内容抽成一个渲染函数：常驻侧栏与窄屏抽屉必须是同一份导航，
   * 各写一份迟早会只改其中一处。`inDrawer` 只影响收起态（抽屉里没有收起的意义）。
   */
  const renderSider = (inDrawer = false) => (
    <div className={`sider-shell${collapsed && !inDrawer ? " is-collapsed" : ""}`}>
      <div className="sider-brand">
        <button className="app-brand" type="button" onClick={() => navigate(homePath)}>
          <span className="app-brand-mark"><BoxPlotOutlined /></span>
          {(!collapsed || inDrawer) && <span className="app-brand-copy"><b>Rental OS</b></span>}
        </button>
        {!inDrawer && (
          <Tooltip title={collapsed ? "展开导航" : "收起导航"} placement="right">
            <Button
              type="text"
              className="sider-collapse"
              aria-label={collapsed ? "展开导航" : "收起导航"}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
          </Tooltip>
        )}
      </div>

      {(!collapsed || inDrawer) && (
        <div className="sider-workspace"><WorkspaceSwitcher /></div>
      )}

      <div className="sider-nav">
        <Menu
          mode="inline"
          inlineCollapsed={collapsed && !inDrawer}
          selectedKeys={[selectedKey]}
          items={buildMenuItems(collapsed && !inDrawer)}
          onClick={({ key }) => { if (String(key).startsWith("/")) navigate(String(key)); }}
        />
      </div>

      <div className="sider-tools">
        <AppearanceSwitcher collapsed={collapsed && !inDrawer} />
        {[
          { key: "notice", label: "通知", icon: <BellOutlined />, hint: "通知中心尚未接入" },
          { key: "settings", label: "设置", icon: <SettingOutlined />, hint: "偏好设置尚未接入" }
        ].map((row) => (
          <Tooltip key={row.key} title={collapsed && !inDrawer ? row.label : row.hint} placement={collapsed && !inDrawer ? "right" : "top"}>
            {/* 占位入口：还没有数据源，因此点击如实说明「未接入」，而不是静默无反应。 */}
            <button className="sider-link" type="button" aria-label={row.label} onClick={() => message.info(row.hint)}>
              {row.icon}
              {(!collapsed || inDrawer) && <span className="sider-link-label">{row.label}</span>}
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="sider-account">
        {/* 必须点击才展开：antd 默认是悬浮触发，鼠标路过账号卡就弹出「退出登录」，太容易误点。 */}
        <Dropdown
          trigger={["click"]}
          placement="topLeft"
          menu={{ items: [{ key: "logout", icon: <LogoutOutlined />, label: "退出登录", onClick: () => { logout(); navigate("/login"); } }] }}
        >
          <button className="account-card" type="button">
            <Avatar size={32} className="account-avatar">{accountInitial}</Avatar>
            {(!collapsed || inDrawer) && (
              <>
                <span className="account-copy">
                  <b>{user?.displayName ?? "运营用户"}</b>
                  <small>{accountCaption}</small>
                </span>
                <MoreOutlined className="account-more" />
              </>
            )}
          </button>
        </Dropdown>
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
          </Sider>
        ) : (
          <>
            <Button
              className="sider-drawer-trigger"
              type="text"
              aria-label="打开导航"
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
          {SHOW_BREADCRUMB && (
            <div className="workspace-context">
              <Breadcrumb items={[
                { title: <HomeOutlined className="breadcrumb-home" onClick={() => navigate(homePath)} /> },
                { title: current.section?.label ?? "工作台", menu: { items: breadcrumbMenuItems } },
                { title: current.route?.label ?? "租赁运营台" }
              ]} />
            </div>
          )}
          <Content className="app-content"><main className="content-canvas">{children}</main></Content>
        </Layout>
      </Layout>
    </div>
  );
}
