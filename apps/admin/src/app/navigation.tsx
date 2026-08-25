import {
  ApartmentOutlined,
  AppstoreOutlined,
  BoxPlotOutlined,
  ControlOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FormOutlined,
  FundOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShopOutlined,
  TagsOutlined,
  TeamOutlined
} from "@ant-design/icons";
import { RentalCategoryCode, type RentalCapability } from "@store-rental/shared";
import type { ReactNode } from "react";

export interface AppRouteDefinition {
  path: string;
  label: string;
  permission: string;
  icon: ReactNode;
  capability?: RentalCapability;
  categories?: RentalCategoryCode[];
  menu?: boolean;
}

export interface AppNavigationSection {
  key: string;
  label: string;
  icon: ReactNode;
  routes: AppRouteDefinition[];
}

export const APP_ROUTES = {
  workbench: { path: "/workbench", label: "运营概览", permission: "store-rental:report:view", icon: <DashboardOutlined />, menu: true },
  rentalCore: { path: "/rental/core", label: "租赁工作台", permission: "store-rental:order:view", icon: <ApartmentOutlined />, menu: true },
  orderCreate: { path: "/rental/orders/new", label: "新建订单", permission: "store-rental:order:create", icon: <FormOutlined />, menu: true },
  orders: { path: "/rental/orders", label: "订单管理", permission: "store-rental:order:view", icon: <FileTextOutlined />, menu: true },
  orderDetail: { path: "/rental/orders/:id", label: "订单详情", permission: "store-rental:order:view", icon: <FileTextOutlined /> },
  itemGroups: { path: "/rental/item-groups", label: "商品目录", permission: "store-rental:vehicle-group:manage", icon: <AppstoreOutlined />, menu: true },
  assets: { path: "/rental/assets", label: "资产与库存", permission: "store-rental:vehicle:view", icon: <BoxPlotOutlined />, menu: true },
  locations: { path: "/rental/locations", label: "履约地点", permission: "store-rental:station:view", icon: <ShopOutlined />, menu: true },
  pricing: { path: "/rental/pricing", label: "基础定价", permission: "store-rental:price:manage", icon: <FundOutlined />, menu: true },
  discounts: { path: "/rental/discounts", label: "优惠方案", permission: "store-rental:price:manage", icon: <TagsOutlined />, menu: true },
  coupons: { path: "/rental/coupons", label: "优惠券", permission: "store-rental:price:manage", icon: <TagsOutlined />, menu: true },
  services: { path: "/rental/services", label: "增值服务", permission: "store-rental:price:manage", icon: <SafetyCertificateOutlined />, menu: true },
  rentalSettings: { path: "/rental/settings", label: "品类与业务规则", permission: "store-rental:price:manage", icon: <SettingOutlined />, menu: true },
  customers: { path: "/customers", label: "客户、会员与企业", permission: "store-rental:member:view", icon: <TeamOutlined />, menu: true },
  platformTenants: { path: "/platform/tenants", label: "SaaS 租户", permission: "system:tenant:manage", icon: <ShopOutlined />, menu: true },
  platformUsers: { path: "/platform/users", label: "组织与权限", permission: "system:user:manage", icon: <TeamOutlined />, menu: true },
  platformSystem: { path: "/platform/system", label: "平台参数", permission: "system:params:manage", icon: <SettingOutlined />, menu: true },
  platformOperations: { path: "/platform/operations", label: "平台运维", permission: "system:params:manage", icon: <SafetyCertificateOutlined />, menu: true },
  platformTools: { path: "/platform/tools", label: "平台工具与治理", permission: "system:params:manage", icon: <ControlOutlined />, menu: true }
} satisfies Record<string, AppRouteDefinition>;

export const APP_NAVIGATION: AppNavigationSection[] = [
  { key: "overview", label: "概览", icon: <DashboardOutlined />, routes: [APP_ROUTES.workbench] },
  { key: "transactions", label: "租赁交易", icon: <ApartmentOutlined />, routes: [APP_ROUTES.rentalCore, APP_ROUTES.orderCreate, APP_ROUTES.orders] },
  { key: "inventory", label: "商品与资产", icon: <AppstoreOutlined />, routes: [APP_ROUTES.itemGroups, APP_ROUTES.assets, APP_ROUTES.locations] },
  { key: "commercial", label: "定价与营销", icon: <FundOutlined />, routes: [APP_ROUTES.pricing, APP_ROUTES.discounts, APP_ROUTES.coupons, APP_ROUTES.services] },
  { key: "customers", label: "客户管理", icon: <TeamOutlined />, routes: [APP_ROUTES.customers] },
  { key: "tenant-settings", label: "经营设置", icon: <SettingOutlined />, routes: [APP_ROUTES.rentalSettings] },
  { key: "platform-management", label: "平台管理", icon: <SettingOutlined />, routes: [APP_ROUTES.platformTenants, APP_ROUTES.platformUsers, APP_ROUTES.platformSystem, APP_ROUTES.platformOperations, APP_ROUTES.platformTools] }
];

export function canAccessRoute(
  route: AppRouteDefinition,
  hasPermission: (permission?: string) => boolean,
  hasCapability: (capability?: RentalCapability) => boolean,
  categoryCode?: RentalCategoryCode
) {
  const supportsCategory = !route.categories || Boolean(categoryCode && route.categories.includes(categoryCode));
  return hasPermission(route.permission) && hasCapability(route.capability) && supportsCategory;
}
