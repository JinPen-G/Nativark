import { BoxPlotOutlined, HomeOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Avatar, Breadcrumb, Button, Dropdown, Layout, Menu, Space } from "antd";
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

const { Header, Sider, Content } = Layout;

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const location = useLocation();
  const navigate = useNavigate();
  const { mode } = useAppearance();
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
   * `租户:空间` 为 key 重挂本组件，因此这里会重新取数，菜单、面包屑与标题
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
  const menuItems = useMemo<MenuProps["items"]>(() => sections.map((section) => ({
    key: section.key,
    icon: section.icon,
    label: section.label,
    children: section.routes.map((route) => ({ key: route.path, icon: route.icon, label: route.label }))
  })), [sections]);
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

  useEffect(() => {
    if (current.section) setOpenKeys([current.section.key]);
  }, [current.section]);

  return (
    <div className="app-frame-stage">
      <Layout className="app-shell">
        <Header className="app-global-header">
          <button className="app-brand" type="button" onClick={() => navigate(homePath)}>
            <span className="app-brand-mark"><BoxPlotOutlined /></span>
            <span className="app-brand-copy"><b>Rental OS</b></span>
          </button>
          <div />
          <Space className="header-actions" size={8}>
            <WorkspaceSwitcher />
            <AppearanceSwitcher />
            <span className="header-divider" />
            <Dropdown placement="bottomRight" menu={{ items: [{ key: "logout", icon: <LogoutOutlined />, label: "退出登录", onClick: () => { logout(); navigate("/login"); } }] }}>
              <Button type="text" className="account-button">
                <Avatar size={32} className="account-avatar">{accountInitial}</Avatar>
                <span className="account-copy"><b>{user?.displayName ?? "运营用户"}</b><small>{tenant?.tenantCode ?? "DEMO"}</small></span>
              </Button>
            </Dropdown>
          </Space>
        </Header>

        <Layout className="app-body">
          <Sider className="app-sider" width={216} collapsedWidth={56} trigger={null} collapsible collapsed={collapsed} theme={mode === "dark" ? "dark" : "light"}>
            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              openKeys={collapsed ? undefined : openKeys}
              items={menuItems}
              onOpenChange={(keys) => {
                const latest = keys.find((key) => !openKeys.includes(String(key)));
                setOpenKeys(latest ? [String(latest)] : []);
              }}
              onClick={({ key }) => { if (String(key).startsWith("/")) navigate(String(key)); }}
            />
            <div className="sider-footer">
              <Button block type="text" onClick={() => setCollapsed((value) => !value)} icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}>
                {!collapsed && "收起导航"}
              </Button>
            </div>
          </Sider>

          <Layout className="app-workspace">
            <div className="workspace-context">
              <Breadcrumb items={[
                { title: <HomeOutlined className="breadcrumb-home" onClick={() => navigate(homePath)} /> },
                { title: current.section?.label ?? "工作台", menu: { items: breadcrumbMenuItems } },
                { title: current.route?.label ?? "租赁运营台" }
              ]} />
            </div>
            <Content className="app-content"><main className="content-canvas">{children}</main></Content>
          </Layout>
        </Layout>
      </Layout>
    </div>
  );
}
