import {
  ApartmentOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BankOutlined,
  BoxPlotOutlined,
  ControlOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FormOutlined,
  FundOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShopOutlined,
  SwapOutlined,
  TeamOutlined
} from "@ant-design/icons";
import { Avatar, Breadcrumb, Button, Dropdown, Layout, Menu, Space } from "antd";
import type { MenuProps } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppearance } from "@/app/theme";
import { useAuthStore } from "@/features/auth/authStore";
import { AppearanceSwitcher } from "./AppearanceSwitcher";

const { Header, Sider, Content } = Layout;

type NavLeaf = { key: string; icon: ReactNode; label: string; permission: string };
type NavSection = { key: string; icon: ReactNode; label: string; children: NavLeaf[] };
type NavNode = NavLeaf | NavSection;

function isSection(item: NavNode): item is NavSection {
  return "children" in item;
}

const nav: NavNode[] = [
  { key: "/workbench", icon: <DashboardOutlined />, label: "运营概览", permission: "store-rental:report:view" },
  { key: "rental-business", icon: <ApartmentOutlined />, label: "租赁业务", children: [
    { key: "/rental/core", icon: <ApartmentOutlined />, label: "Rental Core", permission: "store-rental:order:view" },
    { key: "/rental/orders/new", icon: <FormOutlined />, label: "新建订单", permission: "store-rental:order:create" },
    { key: "/rental/orders", icon: <FileTextOutlined />, label: "租赁订单", permission: "store-rental:order:view" },
    { key: "/rental/contracts", icon: <SafetyCertificateOutlined />, label: "合同与单据", permission: "store-rental:order:view" },
    { key: "/rental/item-groups", icon: <AppstoreOutlined />, label: "标的分组", permission: "store-rental:vehicle-group:manage" },
    { key: "/rental/assets", icon: <BoxPlotOutlined />, label: "资产与库存", permission: "store-rental:vehicle:view" },
    { key: "/rental/locations", icon: <ShopOutlined />, label: "履约网点", permission: "store-rental:station:view" },
    { key: "/rental/commercial", icon: <FundOutlined />, label: "商业规则", permission: "store-rental:price:manage" }
  ] },
  { key: "business-operations", icon: <BarChartOutlined />, label: "经营管理", children: [
    { key: "/customers", icon: <TeamOutlined />, label: "客户与企业", permission: "store-rental:member:view" },
    { key: "/finance", icon: <BankOutlined />, label: "财务结算", permission: "store-rental:finance:view" },
    { key: "/operations", icon: <ControlOutlined />, label: "资产运营", permission: "store-rental:dispatch:manage" },
    { key: "/asset-operations", icon: <SwapOutlined />, label: "资产调拨与设备", permission: "store-rental:vehicle:view" },
    { key: "/asset-lifecycle", icon: <BoxPlotOutlined />, label: "资产生命周期", permission: "store-rental:vehicle:view" },
    { key: "/business-tools", icon: <ControlOutlined />, label: "业务控制台", permission: "store-rental:dispatch:manage" },
    { key: "/reports", icon: <BarChartOutlined />, label: "经营报表", permission: "store-rental:report:view" }
  ] },
  { key: "platform-management", icon: <SettingOutlined />, label: "平台管理", children: [
    { key: "/platform/tenants", icon: <ShopOutlined />, label: "SaaS 租户", permission: "system:tenant:manage" },
    { key: "/platform/users", icon: <TeamOutlined />, label: "组织与权限", permission: "system:user:manage" },
    { key: "/platform/system", icon: <SettingOutlined />, label: "系统配置", permission: "system:params:manage" },
    { key: "/platform/operations", icon: <SafetyCertificateOutlined />, label: "平台运维", permission: "system:params:manage" },
    { key: "/platform/tools", icon: <SettingOutlined />, label: "平台工具与治理", permission: "system:params:manage" }
  ] }
];

function filterNav(items: NavNode[], hasPermission: (permission?: string) => boolean): NavNode[] {
  return items.flatMap((item): NavNode[] => {
    if (isSection(item)) {
      const children = item.children.filter((child) => hasPermission(child.permission));
      return children.length ? [{ ...item, children }] : [];
    }
    return hasPermission(item.permission) ? [item] : [];
  });
}

function toMenuItems(items: NavNode[]): MenuProps["items"] {
  return items.map((item) => ({
    key: item.key,
    icon: item.icon,
    label: item.label,
    children: isSection(item) ? item.children.map((child) => ({ key: child.key, icon: child.icon, label: child.label })) : undefined
  }));
}

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
  const homePath = user?.isSaasAdmin ? "/platform/tenants" : "/workbench";
  const items = useMemo(() => filterNav(nav, hasPermission), [hasPermission]);
  const menuItems = useMemo(() => toMenuItems(items), [items]);
  const leaves = useMemo(() => items.flatMap((entry): NavLeaf[] => isSection(entry) ? entry.children : [entry]), [items]);
  const current = useMemo(() => {
    const leaf = leaves.find((entry) => entry.key === location.pathname)
      ?? [...leaves].sort((a, b) => b.key.length - a.key.length).find((entry) => location.pathname.startsWith(`${entry.key}/`));
    const section = items.find((entry) => isSection(entry) && entry.children.some((child) => child.key === leaf?.key));
    return { leaf, section: section && isSection(section) ? section : undefined };
  }, [items, leaves, location.pathname]);
  const selectedKey = location.pathname === "/rental/orders/new"
    ? "/rental/orders/new"
    : location.pathname.startsWith("/rental/orders/") ? "/rental/orders" : location.pathname;
  const accountInitial = (user?.displayName ?? "运营用户").slice(0, 1).toUpperCase();
  const breadcrumbMenuItems = useMemo(() => {
    if (current.section) {
      return current.section.children.map((entry) => ({
        key: entry.key,
        label: entry.label,
        icon: entry.icon,
        onClick: () => navigate(entry.key)
      }));
    }

    return items.map((entry) => {
      const target = isSection(entry) ? entry.children[0]?.key : entry.key;
      return {
        key: entry.key,
        label: entry.label,
        icon: entry.icon,
        disabled: !target,
        onClick: target ? () => navigate(target) : undefined
      };
    });
  }, [current.section, items, navigate]);

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
        <Sider className="app-sider" width={200} collapsedWidth={56} trigger={null} collapsible collapsed={collapsed} theme={mode === "dark" ? "dark" : "light"}>
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
              { title: current.leaf?.label ?? "租赁运营台" }
            ]} />
          </div>
          <Content className="app-content"><main className="content-canvas">{children}</main></Content>
        </Layout>
      </Layout>
      </Layout>
    </div>
  );
}
