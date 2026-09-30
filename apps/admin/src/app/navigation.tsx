import {
  ApartmentOutlined,
  ApiOutlined,
  AppstoreOutlined,
  BgColorsOutlined,
  BoxPlotOutlined,
  CalendarOutlined,
  ControlOutlined,
  CrownOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FormOutlined,
  FundOutlined,
  GiftOutlined,
  IdcardOutlined,
  MobileOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShopOutlined,
  TagsOutlined,
  TeamOutlined,
  ToolOutlined
} from "@ant-design/icons";
import { RentalCategoryCode, type RentalCapability, type RentalCategoryTerminology } from "@rental-os/shared";
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
  scope?: "tenant-membership";
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
  workbench: { path: "/workbench", label: "运营概览", permission: "rental-os:report:view", legacyPermissions: ["rental-os:order:view", "rental-core:maintenance:view"], audience: "tenant", icon: <DashboardOutlined />, menu: true },
  // REPORT-01A：当前经营空间经营报表。文案固定「经营报表」——指标定义不随品类变化，
  // 只有页面标题内的标的说法用品类术语，菜单名跟着品类变会让人以为指标也变了。
  operationReport: { path: "/reports/operations", label: "经营报表", permission: "rental-os:report:view", audience: "tenant", icon: <FundOutlined />, menu: true },
  // 新建订单不进菜单：它是「订单管理」页上的主操作（页面右上角按钮），
  // 菜单里再放一条等于把一个动作伪装成一个板块，也让「租赁交易」多出一层噪音。
  // 路由本身照常注册，权限仍由 permission 把关。
  orderCreate: { path: "/rental/orders/new", label: "新建订单", permission: "rental-os:order:create", audience: "tenant", icon: <FormOutlined /> },
  orders: { path: "/rental/orders", label: "订单管理", permission: "rental-os:order:view", audience: "tenant", icon: <FileTextOutlined />, menu: true },
  orderDetail: { path: "/rental/orders/:id", label: "订单详情", permission: "rental-os:order:view", audience: "tenant", icon: <FileTextOutlined /> },
  itemGroups: { path: "/rental/item-groups", label: "商品目录", permission: "rental-core:catalog:view", audience: "tenant", icon: <AppstoreOutlined />, menu: true },
  pricingGroups: { path: "/rental/pricing-groups", label: "定价分组", permission: "rental-os:price:manage", audience: "tenant", icon: <TagsOutlined />, menu: true },
  assets: { path: "/rental/assets", label: "资产与库存", permission: "rental-core:asset:view", audience: "tenant", icon: <BoxPlotOutlined />, menu: true },
  workOrders: { path: "/rental/work-orders", label: "养护工单", permission: "rental-core:maintenance:view", audience: "tenant", icon: <ToolOutlined />, menu: true },
  locations: { path: "/rental/locations", label: "履约地点", permission: "rental-os:station:view", audience: "tenant", icon: <ShopOutlined />, menu: true },
  pricing: { path: "/rental/pricing", label: "价格版本与调价", permission: "rental-os:price:manage", audience: "tenant", icon: <FundOutlined />, menu: true },
  discounts: { path: "/rental/discounts", label: "优惠方案", permission: "rental-os:price:manage", audience: "tenant", icon: <TagsOutlined />, menu: true },
  coupons: { path: "/rental/coupons", label: "优惠券", permission: "rental-os:price:manage", audience: "tenant", icon: <TagsOutlined />, menu: true },
  services: { path: "/rental/services", label: "增值服务", permission: "rental-os:price:manage", audience: "tenant", icon: <SafetyCertificateOutlined />, menu: true },
  rentalSettings: { path: "/rental/settings", label: "品类与业务规则", permission: "rental-os:price:manage", legacyPermissions: ["rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:calendar:view-history", "rental-os:rules:manage"], audience: "tenant", icon: <SettingOutlined />, menu: true },
  // CORE-EXT-02C：能力治理入口。刻意**不**给 capability 门禁——它是治理能力本身的页面，
  // 若也要求某个能力已启用，全新空间就会陷入「没有入口去启用第一个能力」的死锁。
  rentalCapabilities: { path: "/rental/capabilities", label: "经营空间能力", permission: "rental-core:capability:view", legacyPermissions: ["rental-core:capability:manage"], audience: "tenant", icon: <ControlOutlined />, menu: true },
  membershipReviews: { scope: "tenant-membership", path: "/membership/reviews", label: "会员审核", permission: "rental-os:member:view", legacyPermissions: ["rental-os:member:review", "rental-os:member:qualification-review"], audience: "tenant", icon: <SafetyCertificateOutlined />, menu: true },
  personalMembers: { scope: "tenant-membership", path: "/membership/personal", label: "个人会员", permission: "rental-os:member:view", audience: "tenant", icon: <IdcardOutlined />, menu: true },
  corporateMembers: { scope: "tenant-membership", path: "/membership/corporate", label: "企业会员", permission: "rental-os:corporate:view", legacyPermissions: ["rental-os:corporate:manage", "rental-os:corporate:employee-manage"], audience: "tenant", icon: <TeamOutlined />, menu: true },
  membershipPlans: { scope: "tenant-membership", path: "/membership/plans", label: "会员方案", permission: "rental-os:member:view", legacyPermissions: ["rental-os:member:plan:manage", "rental-os:member:plan:publish"], audience: "tenant", icon: <TagsOutlined />, menu: true },
  // 会员激励（人工补发奖励、权益账户与奖励流水）从「品类与业务规则」拆出来单独成页。
  // 它读写的是 /rental/v1/rewards 与 /rental/v1/benefit-accounts：这两条是**空间级**接口，
  // 服务端守卫认的是 price:manage / rules:manage / system:params:manage，而不是租户级会员权限，
  // 因此这里不能像其他会员页那样走 tenant-membership 作用域，否则菜单会对能用的人隐藏、
  // 对不能用的人放行。
  membershipRewards: { path: "/membership/rewards", label: "会员激励", permission: "rental-os:price:manage", legacyPermissions: ["rental-os:rules:manage", "system:params:manage"], audience: "tenant", icon: <GiftOutlined />, menu: true },
  // 证件类型是当前经营空间的业务配置，与租户级会员资料维护是两种责任；
  // 单独一个权限码，旧的会员管理权限只作过渡期兼容，新授权应使用新码。
  qualificationTypes: { path: "/rental/qualification-types", label: "空间证件类型", permission: "rental-os:qualification-type:manage", legacyPermissions: ["rental-os:member:manage", "rental-os:member:view"], audience: "tenant", icon: <SafetyCertificateOutlined />, menu: true },
  tenantReadiness: { path: "/tenant/readiness", label: "开业配置", permission: "rental-os:order:view", legacyPermissions: ["rental-os:price:manage", "system:user:manage", "system:role:manage"], audience: "tenant", icon: <DashboardOutlined />, menu: true },
  tenantAccounts: { path: "/tenant/accounts", label: "运营账号", permission: "system:user:manage", audience: "tenant", icon: <TeamOutlined />, menu: true },
  tenantRoles: { path: "/tenant/roles", label: "角色权限", permission: "system:role:manage", audience: "tenant", icon: <SafetyCertificateOutlined />, menu: true },
  tenantIntegrations: { path: "/tenant/integrations", label: "第三方服务", permission: "system:integration:manage", audience: "tenant", icon: <ApiOutlined />, menu: true },
  clientChannel: { path: "/tenant/client-channel", label: "客户端渠道", permission: "system:integration:manage", audience: "tenant", icon: <MobileOutlined />, menu: true },
  // 圆角与本地音效设置；品牌标识、主题色仍在客户端渠道维护。
  appearance: { path: "/settings/appearance", label: "外观与音效", permission: "system:integration:manage", audience: "tenant", icon: <BgColorsOutlined />, menu: true },
  paymentReconciliation: { path: "/rental/payment-reconciliation", label: "支付对账", permission: "rental-os:finance:reconcile", audience: "tenant", icon: <FileSearchOutlined />, menu: true },
  platformTenants: { path: "/platform/tenants", label: "SaaS 租户", permission: "system:tenant:manage", audience: "saas", icon: <ShopOutlined />, menu: true },
  platformDemoRequests: { path: "/platform/demo-requests", label: "演示预约", permission: "system:demo-request:view", audience: "saas", icon: <CalendarOutlined />, menu: true },
  platformUsers: { path: "/platform/users", label: "组织与权限", permission: "system:user:manage", audience: "saas", icon: <TeamOutlined />, menu: true },
  platformSystem: { path: "/platform/system", label: "平台参数", permission: "system:params:manage", audience: "saas", icon: <SettingOutlined />, menu: true },
  platformOperations: { path: "/platform/operations", label: "平台运维", permission: "system:params:manage", audience: "saas", icon: <SafetyCertificateOutlined />, menu: true },
  platformTools: { path: "/platform/tools", label: "平台工具与治理", permission: "system:params:manage", audience: "saas", icon: <ControlOutlined />, menu: true },
  platformOfficialCalendars: { path: "/platform/official-calendars", label: "公共官方日历", permission: "system:calendar-source:manage", audience: "saas", icon: <CalendarOutlined />, menu: true },
  // SUB-02/03 版本订阅：租户端「版本与订阅」(rental-os:subscription:view 进入、:manage 办理) + PRO 介绍/申请详情；平台端「租户订阅」用 system:tenant:subscription:manage（复用 system:tenant: 前缀，走既有 SaaS 管理员放行，无需改 authStore）。权限码与服务端守卫严格同名，legacyPermissions 留空。
  subscription: { path: "/settings/subscription", label: "版本与订阅", permission: "rental-os:subscription:view", audience: "tenant", icon: <CrownOutlined />, menu: true },
  subscriptionPro: { path: "/settings/subscription/pro", label: "PRO 介绍", permission: "rental-os:subscription:view", audience: "tenant", icon: <CrownOutlined /> },
  subscriptionRequestDetail: { path: "/settings/subscription/requests/:id", label: "申请详情", permission: "rental-os:subscription:view", audience: "tenant", icon: <CrownOutlined /> },
  platformSubscriptions: { path: "/platform/subscriptions", label: "租户订阅", permission: "system:tenant:subscription:manage", audience: "saas", icon: <CrownOutlined />, menu: true },
  platformSubscriptionDetail: { path: "/platform/subscriptions/:id", label: "租户订阅详情", permission: "system:tenant:subscription:manage", audience: "saas", icon: <CrownOutlined /> },
  subscriptionCatalog: { path: "/platform/subscription-catalog", label: "功能目录与定价", permission: "system:tenant:subscription:manage", audience: "saas", icon: <AppstoreOutlined />, menu: true }
} satisfies Record<string, AppRouteDefinition>;

export const APP_NAVIGATION: AppNavigationSection[] = [
  { key: "overview", label: "概览", icon: <DashboardOutlined />, routes: [APP_ROUTES.workbench, APP_ROUTES.operationReport] },
  { key: "transactions", label: "租赁交易", icon: <ApartmentOutlined />, routes: [APP_ROUTES.orders] },
  { key: "inventory", label: "商品与资产", icon: <AppstoreOutlined />, routes: [APP_ROUTES.itemGroups, APP_ROUTES.assets, APP_ROUTES.workOrders, APP_ROUTES.locations] },
  { key: "commercial", label: "定价与营销", icon: <FundOutlined />, routes: [APP_ROUTES.pricingGroups, APP_ROUTES.pricing, APP_ROUTES.discounts, APP_ROUTES.coupons, APP_ROUTES.services] },
  { key: "customers", label: "会员与客户", icon: <TeamOutlined />, routes: [APP_ROUTES.membershipReviews, APP_ROUTES.personalMembers, APP_ROUTES.corporateMembers, APP_ROUTES.membershipPlans, APP_ROUTES.membershipRewards] },
  // 租户侧设置按职责拆分，避免开业、业务规则、账号权限、外部服务和财务对账
  // 混在一个九项长列表里。这里只调整菜单分组，不改变任何路由或权限边界。
  { key: "operations-foundation", label: "经营基础", icon: <SettingOutlined />, routes: [APP_ROUTES.tenantReadiness, APP_ROUTES.rentalSettings, APP_ROUTES.qualificationTypes, APP_ROUTES.rentalCapabilities, APP_ROUTES.subscription] },
  { key: "account-access", label: "账号与权限", icon: <TeamOutlined />, routes: [APP_ROUTES.tenantAccounts, APP_ROUTES.tenantRoles] },
  { key: "service-channels", label: "服务与渠道", icon: <ApiOutlined />, routes: [APP_ROUTES.tenantIntegrations, APP_ROUTES.clientChannel, APP_ROUTES.appearance] },
  { key: "finance-reconciliation", label: "财务与对账", icon: <FileSearchOutlined />, routes: [APP_ROUTES.paymentReconciliation] },
  { key: "platform-management", label: "平台管理", icon: <SettingOutlined />, routes: [APP_ROUTES.platformTenants, APP_ROUTES.platformDemoRequests, APP_ROUTES.platformSubscriptions, APP_ROUTES.subscriptionCatalog, APP_ROUTES.platformOfficialCalendars, APP_ROUTES.platformUsers, APP_ROUTES.platformSystem, APP_ROUTES.platformOperations, APP_ROUTES.platformTools] }
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
  isSaasAdmin: boolean,
  hasTenantMembershipPermission: (permission?: string) => boolean = () => false
) {
  if ((route.audience === "saas") !== isSaasAdmin) return false;
  const supportsCategory = !route.categories || Boolean(categoryCode && route.categories.includes(categoryCode));
  const permissionCheck = route.scope === "tenant-membership" ? hasTenantMembershipPermission : hasPermission;
  const supportsPermission = permissionCheck(route.permission) || Boolean(route.legacyPermissions?.some((permission) => permissionCheck(permission)));
  return supportsPermission && hasCapability(route.capability) && supportsCategory;
}
