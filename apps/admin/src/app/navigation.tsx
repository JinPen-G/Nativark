import {
  ApartmentOutlined,
  AppstoreOutlined,
  BoxPlotOutlined,
  CalendarOutlined,
  ControlOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FormOutlined,
  FundOutlined,
  IdcardOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShopOutlined,
  TagsOutlined,
  TeamOutlined,
  ToolOutlined
} from "@ant-design/icons";
import { RentalCategoryCode, type RentalCapability, type RentalCategoryTerminology } from "@store-rental/shared";
import type { ReactNode } from "react";
import { applyTenantNavigationLabels } from "./navigation-terminology";

export interface AppRouteDefinition {
  path: string;
  label: string;
  permission: string;
  /** 升级兼容：满足任一旧权限也可进入，新增授权应使用 permission。 */
  legacyPermissions?: string[];
  icon: ReactNode;
  /** 路由所属运行面；租户内全权限不能越过 SaaS/租户边界。 */
  audience: "tenant" | "saas";
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
  // 工作台既承载经营指标，也承载订单/维护待办。维护人员没有报表或订单数据权限时，
  // 仍应能进入页面查看自己的工单待办；页面内部会继续按数据权限隐藏订单和金额指标。
  workbench: { path: "/workbench", label: "运营概览", permission: "store-rental:report:view", legacyPermissions: ["store-rental:order:view", "rental-core:maintenance:view"], audience: "tenant", icon: <DashboardOutlined />, menu: true },
  // REPORT-01A：当前经营空间经营报表。文案固定「经营报表」——指标定义不随品类变化，
  // 只有页面标题内的标的说法用品类术语，菜单名跟着品类变会让人以为指标也变了。
  operationReport: { path: "/reports/operations", label: "经营报表", permission: "store-rental:report:view", audience: "tenant", icon: <FundOutlined />, menu: true },
  // 租赁工作台（Rental Core v0.1）暂不进菜单：它是早期的合并调试台，
  // 建单、确认预占、执行配货、取消都已经由「新建订单」和订单详情页各自承载，
  // 且详情页还多了部分归还。路由与页面保留，需要时把 menu 打开即可。
  rentalCore: { path: "/rental/core", label: "租赁工作台", permission: "store-rental:order:view", audience: "tenant", icon: <ApartmentOutlined /> },
  // 新建订单不进菜单：它是「订单管理」页上的主操作（页面右上角按钮），
  // 菜单里再放一条等于把一个动作伪装成一个板块，也让「租赁交易」多出一层噪音。
  // 路由本身照常注册，权限仍由 permission 把关。
  orderCreate: { path: "/rental/orders/new", label: "新建订单", permission: "store-rental:order:create", audience: "tenant", icon: <FormOutlined /> },
  orders: { path: "/rental/orders", label: "订单管理", permission: "store-rental:order:view", audience: "tenant", icon: <FileTextOutlined />, menu: true },
  orderDetail: { path: "/rental/orders/:id", label: "订单详情", permission: "store-rental:order:view", audience: "tenant", icon: <FileTextOutlined /> },
  itemGroups: { path: "/rental/item-groups", label: "商品目录", permission: "rental-core:catalog:view", legacyPermissions: ["store-rental:vehicle-group:manage"], audience: "tenant", icon: <AppstoreOutlined />, menu: true },
  pricingGroups: { path: "/rental/pricing-groups", label: "定价分组", permission: "store-rental:price:manage", audience: "tenant", icon: <TagsOutlined />, menu: true },
  assets: { path: "/rental/assets", label: "资产与库存", permission: "rental-core:asset:view", legacyPermissions: ["store-rental:vehicle:view"], audience: "tenant", icon: <BoxPlotOutlined />, menu: true },
  workOrders: { path: "/rental/work-orders", label: "养护工单", permission: "rental-core:maintenance:view", audience: "tenant", icon: <ToolOutlined />, menu: true },
  locations: { path: "/rental/locations", label: "履约地点", permission: "store-rental:station:view", audience: "tenant", icon: <ShopOutlined />, menu: true },
  pricing: { path: "/rental/pricing", label: "基础定价", permission: "store-rental:price:manage", audience: "tenant", icon: <FundOutlined />, menu: true },
  discounts: { path: "/rental/discounts", label: "优惠方案", permission: "store-rental:price:manage", audience: "tenant", icon: <TagsOutlined />, menu: true },
  coupons: { path: "/rental/coupons", label: "优惠券", permission: "store-rental:price:manage", audience: "tenant", icon: <TagsOutlined />, menu: true },
  services: { path: "/rental/services", label: "增值服务", permission: "store-rental:price:manage", audience: "tenant", icon: <SafetyCertificateOutlined />, menu: true },
  rentalSettings: { path: "/rental/settings", label: "品类与业务规则", permission: "store-rental:price:manage", legacyPermissions: ["store-rental:calendar:edit", "store-rental:calendar:publish", "store-rental:calendar:view-history", "store-rental:rules:manage"], audience: "tenant", icon: <SettingOutlined />, menu: true },
  // CORE-EXT-02C：能力治理入口。刻意**不**给 capability 门禁——它是治理能力本身的页面，
  // 若也要求某个能力已启用，全新空间就会陷入「没有入口去启用第一个能力」的死锁。
  rentalCapabilities: { path: "/rental/capabilities", label: "经营空间能力", permission: "rental-core:capability:view", legacyPermissions: ["rental-core:capability:manage"], audience: "tenant", icon: <ControlOutlined />, menu: true },
  membershipReviews: { path: "/membership/reviews", label: "会员审核", permission: "store-rental:member:view", legacyPermissions: ["store-rental:member:review", "store-rental:member:qualification-review"], audience: "tenant", icon: <SafetyCertificateOutlined />, menu: true },
  personalMembers: { path: "/membership/personal", label: "个人会员", permission: "store-rental:member:view", audience: "tenant", icon: <IdcardOutlined />, menu: true },
  corporateMembers: { path: "/membership/corporate", label: "企业会员", permission: "store-rental:corporate:view", legacyPermissions: ["store-rental:corporate:manage", "store-rental:corporate:employee-manage"], audience: "tenant", icon: <TeamOutlined />, menu: true },
  membershipPlans: { path: "/membership/plans", label: "会员方案", permission: "store-rental:member:view", legacyPermissions: ["store-rental:member:plan:manage", "store-rental:member:plan:publish"], audience: "tenant", icon: <TagsOutlined />, menu: true },
  tenantAccounts: { path: "/tenant/accounts", label: "运营账号", permission: "system:user:manage", audience: "tenant", icon: <TeamOutlined />, menu: true },
  tenantRoles: { path: "/tenant/roles", label: "角色权限", permission: "system:role:manage", audience: "tenant", icon: <SafetyCertificateOutlined />, menu: true },
  platformTenants: { path: "/platform/tenants", label: "SaaS 租户", permission: "system:tenant:manage", audience: "saas", icon: <ShopOutlined />, menu: true },
  platformUsers: { path: "/platform/users", label: "组织与权限", permission: "system:user:manage", audience: "saas", icon: <TeamOutlined />, menu: true },
  platformSystem: { path: "/platform/system", label: "平台参数", permission: "system:params:manage", audience: "saas", icon: <SettingOutlined />, menu: true },
  platformOperations: { path: "/platform/operations", label: "平台运维", permission: "system:params:manage", audience: "saas", icon: <SafetyCertificateOutlined />, menu: true },
  platformTools: { path: "/platform/tools", label: "平台工具与治理", permission: "system:params:manage", audience: "saas", icon: <ControlOutlined />, menu: true },
  platformOfficialCalendars: { path: "/platform/official-calendars", label: "公共官方日历", permission: "system:calendar-source:manage", audience: "saas", icon: <CalendarOutlined />, menu: true }
} satisfies Record<string, AppRouteDefinition>;

export const APP_NAVIGATION: AppNavigationSection[] = [
  { key: "overview", label: "概览", icon: <DashboardOutlined />, routes: [APP_ROUTES.workbench, APP_ROUTES.operationReport] },
  { key: "transactions", label: "租赁交易", icon: <ApartmentOutlined />, routes: [APP_ROUTES.orders] },
  { key: "inventory", label: "商品与资产", icon: <AppstoreOutlined />, routes: [APP_ROUTES.itemGroups, APP_ROUTES.assets, APP_ROUTES.workOrders, APP_ROUTES.locations] },
  { key: "commercial", label: "定价与营销", icon: <FundOutlined />, routes: [APP_ROUTES.pricingGroups, APP_ROUTES.pricing, APP_ROUTES.discounts, APP_ROUTES.coupons, APP_ROUTES.services] },
  { key: "customers", label: "会员与客户", icon: <TeamOutlined />, routes: [APP_ROUTES.membershipReviews, APP_ROUTES.personalMembers, APP_ROUTES.corporateMembers, APP_ROUTES.membershipPlans] },
  { key: "tenant-settings", label: "经营设置", icon: <SettingOutlined />, routes: [APP_ROUTES.rentalSettings, APP_ROUTES.rentalCapabilities, APP_ROUTES.tenantAccounts, APP_ROUTES.tenantRoles] },
  { key: "platform-management", label: "平台管理", icon: <SettingOutlined />, routes: [APP_ROUTES.platformTenants, APP_ROUTES.platformOfficialCalendars, APP_ROUTES.platformUsers, APP_ROUTES.platformSystem, APP_ROUTES.platformOperations, APP_ROUTES.platformTools] }
];

/**
 * UI-NAV-01：按当前经营空间的品类术语生成导航分组与菜单。
 *
 * 只覆盖 `label`，**不碰** `path`、`permission`、`capability`、`audience`——
 * 路由与鉴权是契约，换个说法不该换掉入口或门禁。
 * `APP_NAVIGATION` 常量本身保持不变，这里返回派生副本，
 * 因此固定文案在无品类档案（SaaS 平台账号、档案未就绪）时依然可用。
 *
 * 实际套用逻辑放在无 JSX 的纯模块里，好让专项直接断言「文案真的被套上了」；
 * 本函数只负责把路由注册表里的路径喂进去。
 */
export function buildNavigationSections(terminology?: RentalCategoryTerminology): AppNavigationSection[] {
  return applyTenantNavigationLabels(APP_NAVIGATION, terminology, {
    itemGroups: APP_ROUTES.itemGroups.path,
    pricingGroups: APP_ROUTES.pricingGroups.path,
    assets: APP_ROUTES.assets.path,
    locations: APP_ROUTES.locations.path
  });
}

/**
 * 按路径找回路由定义。
 *
 * 页面标题前的图标由此取得，因此和侧栏菜单必然是同一个符号——图标只在
 * `APP_ROUTES` 里声明一次，页面不各自再传一份，避免两处慢慢长歪。
 * 先精确匹配，再按最长前缀兜住 `/rental/orders/:id` 这类带参数的子路由。
 */
export function findRouteByPath(pathname: string): AppRouteDefinition | undefined {
  const all = Object.values(APP_ROUTES);
  return all.find((route) => route.path === pathname)
    ?? [...all]
      .sort((a, b) => b.path.length - a.path.length)
      .find((route) => pathname.startsWith(`${route.path}/`));
}

export function canAccessRoute(
  route: AppRouteDefinition,
  hasPermission: (permission?: string) => boolean,
  hasCapability: (capability?: RentalCapability) => boolean,
  categoryCode: RentalCategoryCode | undefined,
  isSaasAdmin: boolean
) {
  if ((route.audience === "saas") !== isSaasAdmin) return false;
  const supportsCategory = !route.categories || Boolean(categoryCode && route.categories.includes(categoryCode));
  const supportsPermission = hasPermission(route.permission) || Boolean(route.legacyPermissions?.some((permission) => hasPermission(permission)));
  return supportsPermission && hasCapability(route.capability) && supportsCategory;
}
