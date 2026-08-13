import { BoxPlotOutlined, HomeOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Avatar, Breadcrumb, Button, Dropdown, Layout, Menu, Space } from "antd";
import type { MenuProps } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { APP_NAVIGATION, canAccessRoute } from "@/app/navigation";
import { useAppearance } from "@/app/theme";
import { useAuthStore } from "@/features/auth/authStore";
import { AppearanceSwitcher } from "./AppearanceSwitcher";

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
  const sections = useMemo(() => APP_NAVIGATION.map((section) => ({
    ...section,
    routes: section.routes.filter((route) => route.menu && canAccessRoute(route, hasPermission, hasCapability))
  })).filter((section) => section.routes.length > 0), [hasCapability, hasPermission]);
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
