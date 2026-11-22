/** 原组合后台路由与菜单，投影已登记页面并保留原权限及URL；业务授权由服务端裁定。 */
import { RENTAL_WORK_ORDER_PAGES, RENTAL_WORK_ORDER_LEGACY_PERMISSIONS } from "@rental-os/rental-core/admin/work-orders/pages";
import { RENTAL_LOCATION_PAGES, RENTAL_LOCATION_LEGACY_PERMISSIONS } from "@rental-os/rental-core/admin/locations/pages";
import { RENTAL_ORDER_PAGES, RENTAL_ORDER_LEGACY_PERMISSIONS } from "@rental-os/rental-core/admin/orders/pages";
import { RENTAL_CAPABILITY_PAGES, RENTAL_CAPABILITY_LEGACY_PERMISSIONS } from "@rental-os/rental-core/admin/capabilities/pages";
import { RENTAL_CATALOG_PAGES, RENTAL_CATALOG_LEGACY_PERMISSIONS } from "@rental-os/rental-core/admin/catalog/pages";
import { RENTAL_COMMERCIAL_PAGES, RENTAL_COMMERCIAL_LEGACY_PERMISSION } from "@rental-os/rental-core/admin/commercial/pages";
import { rentalPageLegacyPermissions } from "@rental-os/rental-core/permissions";
import { RENTAL_GOVERNANCE_PAGES, RENTAL_GOVERNANCE_LEGACY_PERMISSIONS } from "@rental-os/rental-core/admin/governance/pages";
import { RENTAL_MEMBERSHIP_PAGES, RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS } from "@rental-os/rental-core/admin/membership/pages";
import { RENTAL_OPERATIONS_PAGES, RENTAL_OPERATIONS_LEGACY_PAGE_ACCESS } from "@rental-os/rental-core/admin/operations/pages";
import { RENTAL_CHANNELS_PAGES, RENTAL_CHANNELS_LEGACY_PERMISSION } from "@rental-os/rental-core/admin/channels/pages";
import { RENTAL_SETUP_PAGES, RENTAL_SETUP_LEGACY_PERMISSIONS } from "@rental-os/rental-core/admin/setup/pages";
import { RENTAL_PAYMENT_RECONCILIATION_PAGES, RENTAL_PAYMENT_RECONCILIATION_LEGACY_PERMISSION } from "@rental-os/rental-core/admin/payment-reconciliation/pages";
import { SUBSCRIPTION_ROUTES } from "@rental-os/platform-admin/subscription/subscriptionRoutes";
import { ApartmentOutlined, ApiOutlined, AppstoreOutlined, BgColorsOutlined, BoxPlotOutlined, CalendarOutlined, ControlOutlined, CrownOutlined, CustomerServiceOutlined, DashboardOutlined, FileSearchOutlined, FileTextOutlined, FormOutlined, FundOutlined, GiftOutlined, IdcardOutlined, MobileOutlined, SafetyCertificateOutlined, SendOutlined, SettingOutlined, ShopOutlined, TagsOutlined, TeamOutlined, ToolOutlined } from "@/components/ui/icons";
import { RentalCategoryCode, type RentalCapability, type RentalCategoryTerminology } from "@rental-os/shared";
import type { ReactNode } from "react";
import { applyTenantNavigationLabels } from "./navigation-terminology";
import { CATEGORY_GOVERNANCE_PREVIEW_ENABLED } from "./categoryGovernancePreview";
import { adminRuntime } from "./adminRuntime";

export interface AppRouteDefinition {
  path: string;
  label: string;
  permission: string;
  /** 升级兼容：满足任一旧权限也可进入，新增授权应使用 permission。 */
  legacyPermissions?: string[];
  icon: ReactNode;
  /** 路由所属运行面；租户内全权限不能越过 SaaS/租户边界。 */
  audience: "tenant" | "saas";
  scope?: "tenant-membership" | "tenant-management";
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
  aiOperator: { path: "/ai-operator", label: "Agent工作台", permission: "rental-os:report:view", legacyPermissions: ["rental-os:order:view", "rental-core:catalog:view", "rental-core:asset:view", "rental-core:maintenance:view", "rental-os:member:view", "system:integration:manage"], audience: "tenant", icon: <FundOutlined /> },
  // 工作台既承载经营指标，也承载订单/维护待办。维护人员没有报表或订单数据权限时，
  // 仍应能进入页面查看自己的工单待办；页面内部会继续按数据权限隐藏订单和金额指标。
  workbench: { path: RENTAL_OPERATIONS_PAGES.workbench.path, label: RENTAL_OPERATIONS_PAGES.workbench.title.default, permission: RENTAL_OPERATIONS_LEGACY_PAGE_ACCESS.workbench[0], legacyPermissions: RENTAL_OPERATIONS_LEGACY_PAGE_ACCESS.workbench.slice(1), audience: "tenant", icon: <DashboardOutlined />, menu: Boolean(RENTAL_OPERATIONS_PAGES.workbench.menu) },
  // REPORT-01A：当前经营空间经营报表。文案固定「经营报表」——指标定义不随品类变化，
  // 只有页面标题内的标的说法用品类术语，菜单名跟着品类变会让人以为指标也变了。
  notifications: { path: "/notifications", label: "消息中心", permission: "", audience: "tenant", icon: <FileTextOutlined />, menu: true },
  operationReport: { path: RENTAL_OPERATIONS_PAGES.operationReport.path, label: RENTAL_OPERATIONS_PAGES.operationReport.title.default, permission: RENTAL_OPERATIONS_LEGACY_PAGE_ACCESS["operation-report"][0], audience: "tenant", icon: <FundOutlined />, menu: Boolean(RENTAL_OPERATIONS_PAGES.operationReport.menu) },
  // 新建订单不进菜单：它是「订单管理」页上的主操作（页面右上角按钮），
  // 菜单里再放一条等于把一个动作伪装成一个板块，也让「租赁交易」多出一层噪音。
  // 路由本身照常注册，权限仍由 permission 把关。
  orderCreate: { path: `/rental${RENTAL_ORDER_PAGES.orderCreate.path}`, label: RENTAL_ORDER_PAGES.orderCreate.title.default, permission: RENTAL_ORDER_LEGACY_PERMISSIONS.create, audience: "tenant", icon: <FormOutlined /> },
  orders: { path: `/rental${RENTAL_ORDER_PAGES.orders.path}`, label: RENTAL_ORDER_PAGES.orders.title.default, permission: RENTAL_ORDER_LEGACY_PERMISSIONS.view, audience: "tenant", icon: <FileTextOutlined />, menu: Boolean(RENTAL_ORDER_PAGES.orders.menu) },
  orderDetail: { path: `/rental${RENTAL_ORDER_PAGES.orderDetail.path}`, label: RENTAL_ORDER_PAGES.orderDetail.title.default, permission: RENTAL_ORDER_LEGACY_PERMISSIONS.view, audience: "tenant", icon: <FileTextOutlined /> },
  itemGroups: { path: `/rental${RENTAL_CATALOG_PAGES.catalog.path}`, label: RENTAL_CATALOG_PAGES.catalog.title.default, permission: RENTAL_CATALOG_LEGACY_PERMISSIONS.catalog.view, audience: "tenant", icon: <AppstoreOutlined />, menu: Boolean(RENTAL_CATALOG_PAGES.catalog.menu) },
  pricingGroups: { path: `/rental${RENTAL_COMMERCIAL_PAGES.pricingGroups.path}`, label: RENTAL_COMMERCIAL_PAGES.pricingGroups.title.default, permission: RENTAL_COMMERCIAL_LEGACY_PERMISSION, audience: "tenant", icon: <TagsOutlined />, menu: Boolean(RENTAL_COMMERCIAL_PAGES.pricingGroups.menu) },
  assets: { path: `/rental${RENTAL_CATALOG_PAGES.assets.path}`, label: RENTAL_CATALOG_PAGES.assets.title.default, permission: RENTAL_CATALOG_LEGACY_PERMISSIONS.asset.view, audience: "tenant", icon: <BoxPlotOutlined />, menu: Boolean(RENTAL_CATALOG_PAGES.assets.menu) },
  workOrders: { path: `/rental${RENTAL_WORK_ORDER_PAGES.workOrders.path}`, label: RENTAL_WORK_ORDER_PAGES.workOrders.title.default, permission: RENTAL_WORK_ORDER_LEGACY_PERMISSIONS.view, audience: "tenant", icon: <ToolOutlined />, menu: Boolean(RENTAL_WORK_ORDER_PAGES.workOrders.menu) },
  workOrderDetail: { path: `/rental${RENTAL_WORK_ORDER_PAGES.workOrderDetail.path}`, label: RENTAL_WORK_ORDER_PAGES.workOrderDetail.title.default, permission: RENTAL_WORK_ORDER_LEGACY_PERMISSIONS.view, audience: "tenant", icon: <ToolOutlined /> },
  locations: { path: `/rental${RENTAL_LOCATION_PAGES.locations.path}`, label: RENTAL_LOCATION_PAGES.locations.title.default, permission: RENTAL_LOCATION_LEGACY_PERMISSIONS.view, audience: "tenant", icon: <ShopOutlined />, menu: Boolean(RENTAL_LOCATION_PAGES.locations.menu) },
  pricing: { path: `/rental${RENTAL_COMMERCIAL_PAGES.pricing.path}`, label: RENTAL_COMMERCIAL_PAGES.pricing.title.default, permission: RENTAL_COMMERCIAL_LEGACY_PERMISSION, audience: "tenant", icon: <FundOutlined />, menu: Boolean(RENTAL_COMMERCIAL_PAGES.pricing.menu) },
  pricingVersions: { path: `/rental${RENTAL_COMMERCIAL_PAGES.pricingVersions.path}`, label: RENTAL_COMMERCIAL_PAGES.pricingVersions.title.default, permission: RENTAL_COMMERCIAL_LEGACY_PERMISSION, audience: "tenant", icon: <FundOutlined /> },
  pricingVersionDetail: { path: `/rental${RENTAL_COMMERCIAL_PAGES.pricingVersionDetail.path}`, label: RENTAL_COMMERCIAL_PAGES.pricingVersionDetail.title.default, permission: RENTAL_COMMERCIAL_LEGACY_PERMISSION, audience: "tenant", icon: <FundOutlined /> },
  discounts: { path: `/rental${RENTAL_COMMERCIAL_PAGES.discounts.path}`, label: RENTAL_COMMERCIAL_PAGES.discounts.title.default, permission: RENTAL_COMMERCIAL_LEGACY_PERMISSION, audience: "tenant", icon: <TagsOutlined />, menu: Boolean(RENTAL_COMMERCIAL_PAGES.discounts.menu) },
  coupons: { path: `/rental${RENTAL_COMMERCIAL_PAGES.coupons.path}`, label: RENTAL_COMMERCIAL_PAGES.coupons.title.default, permission: RENTAL_COMMERCIAL_LEGACY_PERMISSION, audience: "tenant", icon: <TagsOutlined />, menu: Boolean(RENTAL_COMMERCIAL_PAGES.coupons.menu) },
  services: { path: `/rental${RENTAL_COMMERCIAL_PAGES.services.path}`, label: RENTAL_COMMERCIAL_PAGES.services.title.default, permission: rentalPageLegacyPermissions("services")[0], audience: "tenant", icon: <SafetyCertificateOutlined />, menu: Boolean(RENTAL_COMMERCIAL_PAGES.services.menu) },
  rentalSettings: { path: `/rental${RENTAL_GOVERNANCE_PAGES.settings.path}`, label: RENTAL_GOVERNANCE_PAGES.settings.title.default, permission: RENTAL_GOVERNANCE_LEGACY_PERMISSIONS[0], legacyPermissions: RENTAL_GOVERNANCE_LEGACY_PERMISSIONS.slice(1), audience: "tenant", icon: <SettingOutlined />, menu: Boolean(RENTAL_GOVERNANCE_PAGES.settings.menu) },
  // CORE-EXT-02C：能力治理入口。刻意**不**给 capability 门禁——它是治理能力本身的页面，
  // 若也要求某个能力已启用，全新空间就会陷入「没有入口去启用第一个能力」的死锁。
  rentalCapabilities: { path: `/rental${RENTAL_CAPABILITY_PAGES.capabilities.path}`, label: RENTAL_CAPABILITY_PAGES.capabilities.title.default, permission: RENTAL_CAPABILITY_LEGACY_PERMISSIONS.view, legacyPermissions: [RENTAL_CAPABILITY_LEGACY_PERMISSIONS.manage], audience: "tenant", icon: <ControlOutlined />, menu: Boolean(RENTAL_CAPABILITY_PAGES.capabilities.menu) },
  membershipReviews: { scope: "tenant-membership", path: RENTAL_MEMBERSHIP_PAGES.reviews.path, label: RENTAL_MEMBERSHIP_PAGES.reviews.title.default, permission: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["membership-reviews"].permissions[0], legacyPermissions: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["membership-reviews"].permissions.slice(1), audience: "tenant", icon: <SafetyCertificateOutlined />, menu: Boolean(RENTAL_MEMBERSHIP_PAGES.reviews.menu) },
  personalMembers: { scope: "tenant-membership", path: RENTAL_MEMBERSHIP_PAGES.personal.path, label: RENTAL_MEMBERSHIP_PAGES.personal.title.default, permission: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["personal-members"].permissions[0], legacyPermissions: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["personal-members"].permissions.slice(1), audience: "tenant", icon: <IdcardOutlined />, menu: Boolean(RENTAL_MEMBERSHIP_PAGES.personal.menu) },
  personalMemberDetail: { scope: "tenant-membership", path: RENTAL_MEMBERSHIP_PAGES.personalDetail.path, label: RENTAL_MEMBERSHIP_PAGES.personalDetail.title.default, permission: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["personal-member-detail"].permissions[0], legacyPermissions: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["personal-member-detail"].permissions.slice(1), audience: "tenant", icon: <IdcardOutlined /> },
  corporateMembers: { scope: "tenant-membership", path: RENTAL_MEMBERSHIP_PAGES.corporate.path, label: RENTAL_MEMBERSHIP_PAGES.corporate.title.default, permission: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["corporate-members"].permissions[0], legacyPermissions: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["corporate-members"].permissions.slice(1), audience: "tenant", icon: <TeamOutlined />, menu: Boolean(RENTAL_MEMBERSHIP_PAGES.corporate.menu) },
  corporateMemberDetail: { scope: "tenant-membership", path: RENTAL_MEMBERSHIP_PAGES.corporateDetail.path, label: RENTAL_MEMBERSHIP_PAGES.corporateDetail.title.default, permission: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["corporate-member-detail"].permissions[0], legacyPermissions: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["corporate-member-detail"].permissions.slice(1), audience: "tenant", icon: <TeamOutlined /> },
  membershipPlans: { scope: "tenant-membership", path: RENTAL_MEMBERSHIP_PAGES.plans.path, label: RENTAL_MEMBERSHIP_PAGES.plans.title.default, permission: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["membership-plans"].permissions[0], legacyPermissions: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["membership-plans"].permissions.slice(1), audience: "tenant", icon: <TagsOutlined />, menu: Boolean(RENTAL_MEMBERSHIP_PAGES.plans.menu) },
  // 会员激励（人工补发奖励、权益账户与奖励流水）从「品类与业务规则」拆出来单独成页。
  // 它读写的是 /rental/v1/rewards 与 /rental/v1/benefit-accounts：这两条是**空间级**接口，
  // 服务端守卫认的是 price:manage / rules:manage / system:params:manage，而不是租户级会员权限，
  // 因此这里不能像其他会员页那样走 tenant-membership 作用域，否则菜单会对能用的人隐藏、
  // 对不能用的人放行。
  membershipRewards: { path: RENTAL_MEMBERSHIP_PAGES.rewards.path, label: RENTAL_MEMBERSHIP_PAGES.rewards.title.default, permission: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["membership-rewards"].permissions[0], legacyPermissions: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["membership-rewards"].permissions.slice(1), audience: "tenant", icon: <GiftOutlined />, menu: Boolean(RENTAL_MEMBERSHIP_PAGES.rewards.menu) },
  // 证件类型是当前经营空间的业务配置，与租户级会员资料维护是两种责任；
  // 单独一个权限码，旧的会员管理权限只作过渡期兼容，新授权应使用新码。
  qualificationTypes: { path: `/rental${RENTAL_MEMBERSHIP_PAGES.qualificationTypes.path}`, label: RENTAL_MEMBERSHIP_PAGES.qualificationTypes.title.default, permission: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["qualification-types"].permissions[0], legacyPermissions: RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS["qualification-types"].permissions.slice(1), audience: "tenant", icon: <SafetyCertificateOutlined />, menu: Boolean(RENTAL_MEMBERSHIP_PAGES.qualificationTypes.menu) },
  tenantReadiness: { path: `/tenant${RENTAL_SETUP_PAGES.tenantReadiness.path}`, label: RENTAL_SETUP_PAGES.tenantReadiness.title.default, permission: RENTAL_SETUP_LEGACY_PERMISSIONS[0], legacyPermissions: RENTAL_SETUP_LEGACY_PERMISSIONS.slice(1), audience: "tenant", icon: <DashboardOutlined />, menu: Boolean(RENTAL_SETUP_PAGES.tenantReadiness.menu) },
  tenantAccounts: { path: "/tenant/accounts", label: "运营账号", permission: "system:user:manage", audience: "tenant", icon: <TeamOutlined />, menu: true },
  tenantRoles: { path: "/tenant/roles", label: "角色权限", permission: "system:role:manage", audience: "tenant", icon: <SafetyCertificateOutlined />, menu: true },
  tenantIntegrations: { path: "/tenant/integrations", label: "第三方服务", permission: "system:integration:manage", audience: "tenant", icon: <ApiOutlined />, menu: true },
  tenantDispatch: { scope: "tenant-management", path: "/tenant/dispatch", label: "寄件中心", permission: "system:integration:manage", audience: "tenant", icon: <SendOutlined />, menu: true },
  customerSupport: { scope: "tenant-management", path: "/tenant/support", label: "客服中心", permission: "system:integration:manage", audience: "tenant", icon: <CustomerServiceOutlined />, menu: true },
  clientChannel: { path: `/tenant${RENTAL_CHANNELS_PAGES.clientChannel.path}`, label: RENTAL_CHANNELS_PAGES.clientChannel.title.default, permission: RENTAL_CHANNELS_LEGACY_PERMISSION, audience: "tenant", icon: <MobileOutlined />, menu: Boolean(RENTAL_CHANNELS_PAGES.clientChannel.menu) },
  // 圆角与本地音效设置；品牌标识、主题色仍在客户端渠道维护。
  appearance: { path: "/settings/appearance", label: "外观与音效", permission: "system:integration:manage", audience: "tenant", icon: <BgColorsOutlined />, menu: true },
  aiSettings: { path: "/settings/ai", label: "AI 服务设置", permission: "system:params:manage", audience: "tenant", icon: <SettingOutlined />, menu: true },
  clientAuthorization: { path: "/settings/client-authorization", label: "客户端授权", permission: "system:params:manage", audience: "tenant", icon: <SafetyCertificateOutlined />, menu: true },
  // Human review discovery has its own resource authority; these entry roles
  // do not widen the original owner TaskCenter reader or grant execution.
  aiTasks: { path: "/ai/tasks", label: "AI 任务中心", permission: "rental-os:order:view", legacyPermissions: ["rental-os:order:create", "rental-os:price:manage", "system:params:manage", "system:integration:manage", "rental-os:finance:view", "rental-os:finance:reconcile"], audience: "tenant", icon: <FileTextOutlined />, menu: true },
  paymentReconciliation: { path: `/rental${RENTAL_PAYMENT_RECONCILIATION_PAGES.batches.path}`, label: RENTAL_PAYMENT_RECONCILIATION_PAGES.batches.title.default, permission: RENTAL_PAYMENT_RECONCILIATION_LEGACY_PERMISSION, audience: "tenant", icon: <FileSearchOutlined />, menu: Boolean(RENTAL_PAYMENT_RECONCILIATION_PAGES.batches.menu) },
  paymentReconciliationDetail: { path: `/rental${RENTAL_PAYMENT_RECONCILIATION_PAGES.detail.path}`, label: RENTAL_PAYMENT_RECONCILIATION_PAGES.detail.title.default, permission: RENTAL_PAYMENT_RECONCILIATION_LEGACY_PERMISSION, audience: "tenant", icon: <FileSearchOutlined /> },
  platformTenants: { path: "/platform/tenants", label: "SaaS 租户", permission: "system:tenant:manage", audience: "saas", icon: <ShopOutlined />, menu: true },
  platformCorePackages: { path: "/platform/core-packages", label: "Core 包管理", permission: "system:tenant:manage", audience: "saas", icon: <AppstoreOutlined />, menu: true },
  platformCategories: { path: "/platform/rental-categories", label: "租赁品类", permission: "system:rental-category:view", audience: "saas", icon: <AppstoreOutlined />, menu: CATEGORY_GOVERNANCE_PREVIEW_ENABLED },
  platformCategoryCapabilities: { path: "/platform/rental-category-capabilities", label: "内核能力目录", permission: "system:rental-category:view", audience: "saas", icon: <ControlOutlined />, menu: CATEGORY_GOVERNANCE_PREVIEW_ENABLED },
  platformDemoRequests: { path: "/platform/demo-requests", label: "演示预约", permission: "system:demo-request:view", audience: "saas", icon: <CalendarOutlined />, menu: true },
  platformUsers: { path: "/platform/users", label: "组织与权限", permission: "system:user:manage", audience: "saas", icon: <TeamOutlined />, menu: true },
  platformSystem: { path: "/platform/system", label: "平台参数", permission: "system:params:manage", audience: "saas", icon: <SettingOutlined />, menu: true },
  platformAi: { path: "/platform/ai", label: "平台 AI 配置", permission: "system:ai-provider:view", audience: "saas", icon: <ApiOutlined />, menu: true },
  platformOperations: { path: "/platform/operations", label: "平台运维", permission: "system:params:manage", audience: "saas", icon: <SafetyCertificateOutlined />, menu: true },
  platformTools: { path: "/platform/tools", label: "平台工具与治理", permission: "system:params:manage", audience: "saas", icon: <ControlOutlined />, menu: true },
  platformOfficialCalendars: { path: "/platform/official-calendars", label: "公共官方日历", permission: "system:calendar-source:manage", audience: "saas", icon: <CalendarOutlined />, menu: true },
  // SUB-02/03 版本订阅：租户端「版本与订阅」(rental-os:subscription:view 进入、:manage 办理) + PRO 介绍/申请详情；平台端「租户订阅」用 system:tenant:subscription:manage（复用 system:tenant: 前缀，走既有 SaaS 管理员放行，无需改 authStore）。权限码与服务端守卫严格同名，legacyPermissions 留空。
  subscription: { path: SUBSCRIPTION_ROUTES.subscription.path, label: "版本与订阅", permission: "rental-os:subscription:view", audience: "tenant", icon: <CrownOutlined />, menu: true },
  subscriptionPro: { path: SUBSCRIPTION_ROUTES.subscriptionPro.path, label: "版本对比", permission: "rental-os:subscription:view", audience: "tenant", icon: <CrownOutlined /> },
  subscriptionRequestDetail: { path: SUBSCRIPTION_ROUTES.subscriptionRequestDetail.path, label: "申请详情", permission: "rental-os:subscription:view", audience: "tenant", icon: <CrownOutlined /> },
  platformSubscriptions: { path: SUBSCRIPTION_ROUTES.platformSubscriptions.path, label: "租户订阅", permission: "system:tenant:subscription:manage", audience: "saas", icon: <CrownOutlined />, menu: true },
  platformSubscriptionDetail: { path: SUBSCRIPTION_ROUTES.platformSubscriptionDetail.path, label: "租户订阅详情", permission: "system:tenant:subscription:manage", audience: "saas", icon: <CrownOutlined /> },
  subscriptionCatalog: { path: SUBSCRIPTION_ROUTES.subscriptionCatalog.path, label: "功能目录与定价", permission: "system:tenant:subscription:manage", audience: "saas", icon: <AppstoreOutlined />, menu: true }
} satisfies Record<string, AppRouteDefinition>;

export const APP_NAVIGATION: AppNavigationSection[] = [
  { key: "platform-rental-core", label: "租赁内核", icon: <ControlOutlined />, routes: [APP_ROUTES.platformCategories, APP_ROUTES.platformCategoryCapabilities] },
  { key: "overview", label: "概览", icon: <DashboardOutlined />, routes: [APP_ROUTES.workbench, APP_ROUTES.operationReport, APP_ROUTES.notifications] },
  { key: "transactions", label: "租赁交易", icon: <ApartmentOutlined />, routes: [APP_ROUTES.orders] },
  { key: "inventory", label: RENTAL_WORK_ORDER_PAGES.workOrders.menu.group.default, icon: <AppstoreOutlined />, routes: [APP_ROUTES.itemGroups, APP_ROUTES.assets, APP_ROUTES.workOrders, APP_ROUTES.locations] },
  { key: "commercial", label: "定价与营销", icon: <FundOutlined />, routes: [APP_ROUTES.pricingGroups, APP_ROUTES.pricing, APP_ROUTES.discounts, APP_ROUTES.coupons, APP_ROUTES.services] },
  { key: "customers", label: "会员与客户", icon: <TeamOutlined />, routes: [APP_ROUTES.membershipReviews, APP_ROUTES.personalMembers, APP_ROUTES.corporateMembers, APP_ROUTES.membershipPlans, APP_ROUTES.membershipRewards] },
  // 租户侧设置按职责拆分，避免开业、业务规则、账号权限、外部服务和财务对账
  // 混在一个九项长列表里。这里只调整菜单分组，不改变任何路由或权限边界。
  { key: "operations-foundation", label: "经营基础", icon: <SettingOutlined />, routes: [APP_ROUTES.tenantReadiness, APP_ROUTES.rentalSettings, APP_ROUTES.qualificationTypes, APP_ROUTES.rentalCapabilities, APP_ROUTES.subscription] },
  { key: "account-access", label: "账号与权限", icon: <TeamOutlined />, routes: [APP_ROUTES.tenantAccounts, APP_ROUTES.tenantRoles, APP_ROUTES.clientAuthorization] },
  { key: "service-channels", label: "服务与渠道", icon: <ApiOutlined />, routes: [APP_ROUTES.tenantIntegrations, APP_ROUTES.tenantDispatch, APP_ROUTES.customerSupport, APP_ROUTES.aiSettings, APP_ROUTES.aiTasks, APP_ROUTES.clientChannel, APP_ROUTES.appearance] },
  { key: "finance-reconciliation", label: "财务与对账", icon: <FileSearchOutlined />, routes: [APP_ROUTES.paymentReconciliation] },
  { key: "platform-management", label: "平台管理", icon: <SettingOutlined />, routes: [APP_ROUTES.platformTenants, APP_ROUTES.platformCorePackages, APP_ROUTES.platformDemoRequests, APP_ROUTES.platformSubscriptions, APP_ROUTES.subscriptionCatalog, APP_ROUTES.platformOfficialCalendars, APP_ROUTES.platformUsers, APP_ROUTES.platformAi, APP_ROUTES.platformSystem, APP_ROUTES.platformOperations, APP_ROUTES.platformTools] }
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
): boolean {
  if ((route.audience === "saas") !== isSaasAdmin) return false;
  // 原 SaaS hasPermission 按租户权限前缀放行，包管理须核当前已验证会话的明确管理权。
  if (route.path === APP_ROUTES.platformCorePackages.path) {
    const { sessionVerified, user } = adminRuntime.getSession();
    return sessionVerified && user?.isSaasAdmin === true
      && Boolean(user.permissions?.includes("*") || user.permissions?.includes(route.permission));
  }
  // This frontend entry grants no business authority. Reuse each capability's
  // existing page gate, including tenant-wide membership scope, rather than
  // accidentally excluding price-only or membership-only operators.
  if (route.path === APP_ROUTES.aiOperator.path) {
    return [APP_ROUTES.workbench, APP_ROUTES.orders, APP_ROUTES.locations, APP_ROUTES.assets,
      APP_ROUTES.personalMembers, APP_ROUTES.pricingGroups, APP_ROUTES.paymentReconciliation,
      APP_ROUTES.rentalSettings, APP_ROUTES.operationReport].some(entry => canAccessRoute(entry,
        hasPermission, hasCapability, categoryCode, isSaasAdmin, hasTenantMembershipPermission));
  }
  const supportsCategory = !route.categories || Boolean(categoryCode && route.categories.includes(categoryCode));
  const permissionCheck = route.scope === "tenant-membership" || route.scope === "tenant-management" ? hasTenantMembershipPermission : hasPermission;
  const supportsPermission = permissionCheck(route.permission) || Boolean(route.legacyPermissions?.some((permission) => permissionCheck(permission)));
  return supportsPermission && hasCapability(route.capability) && supportsCategory;
}
