import { lazy, Suspense, type ReactNode } from "react";
import { Result } from "antd";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { APP_ROUTES, canAccessRoute, type AppRouteDefinition } from "@/app/navigation";
import { AppShell } from "@/components/AppShell";
import { LoadingState } from "@/components/LoadingState";
import { useLocale } from "./locale";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { useAuthStore } from "@/features/auth/authStore";
import { CATEGORY_GOVERNANCE_PREVIEW_ENABLED } from "./categoryGovernancePreview";

const LoginPage = lazy(() => import("@/features/auth/LoginPage").then((module) => ({ default: module.LoginPage })));
const WorkbenchPage = lazy(() => import("@/features/workbench/WorkbenchPage").then((module) => ({ default: module.WorkbenchPage })));
const WorkspaceOperationReportPage = lazy(() => import("@/features/reports/WorkspaceOperationReportPage").then((module) => ({ default: module.WorkspaceOperationReportPage })));
const CatalogPage = lazy(() => import("@/features/catalog/CatalogPage").then((module) => ({ default: module.CatalogPage })));
const AssetWorkspacePage = lazy(() => import("@/features/catalog/AssetWorkspacePage").then((module) => ({ default: module.AssetWorkspacePage })));
const MaintenanceWorkOrdersPage = lazy(() => import("@/features/rental-core/MaintenanceWorkOrdersPage").then((module) => ({ default: module.MaintenanceWorkOrdersPage })));
const LocationPage = lazy(() => import("@/features/fulfillment/LocationPage").then((module) => ({ default: module.LocationPage })));
const OrdersPage = lazy(() => import("@/features/rental-core/RentalOrdersPage").then((module) => ({ default: module.RentalOrdersPage })));
const OrderCreatePage = lazy(() => import("@/features/rental-core/RentalOrderCreatePage").then((module) => ({ default: module.RentalOrderCreatePage })));
const OrderDetailPage = lazy(() => import("@/features/rental-core/RentalOrderDetailPage").then((module) => ({ default: module.RentalOrderDetailPage })));
const RentalCommercialPage = lazy(() => import("@/features/commercial/RentalCommercialPage").then((module) => ({ default: module.RentalCommercialPage })));
const PricingGroupPage = lazy(() => import("@/features/commercial/PricingGroupPage").then((module) => ({ default: module.PricingGroupPage })));
const CouponPage = lazy(() => import("@/features/commercial/CouponPage").then((module) => ({ default: module.CouponPage })));
const QualificationTypesPage = lazy(() => import("@/features/membership/QualificationTypesPage").then((module) => ({ default: module.QualificationTypesPage })));
const MembershipReviewPage = lazy(() => import("@/features/membership/MembershipReviewPage").then((module) => ({ default: module.MembershipReviewPage })));
const PersonalMembershipPage = lazy(() => import("@/features/membership/PersonalMembershipPage").then((module) => ({ default: module.PersonalMembershipPage })));
const CorporateMembershipPage = lazy(() => import("@/features/membership/CorporateMembershipPage").then((module) => ({ default: module.CorporateMembershipPage })));
const MembershipPlanPage = lazy(() => import("@/features/membership/MembershipPlanPage").then((module) => ({ default: module.MembershipPlanPage })));
const MembershipRewardsPage = lazy(() => import("@/features/membership/MembershipRewardsPage").then((module) => ({ default: module.MembershipRewardsPage })));
const PlatformPage = lazy(() => import("@/features/platform/PlatformPage").then((module) => ({ default: module.PlatformPage })));
const CategoryGovernancePage = lazy(() => import("@/features/platform/CategoryGovernancePage").then((module) => ({ default: module.CategoryGovernancePage })));
const CategoryCapabilityCatalogPage = lazy(() => import("@/features/platform/CategoryGovernancePage").then((module) => ({ default: module.CategoryCapabilityCatalogPage })));
const PlatformOperationsPage = lazy(() => import("@/features/platform/PlatformOperationsPage").then((module) => ({ default: module.PlatformOperationsPage })));
const PlatformToolsPage = lazy(() => import("@/features/platform/PlatformToolsPage").then((module) => ({ default: module.PlatformToolsPage })));
const OfficialCalendarSourcePage = lazy(() => import("@/features/platform/OfficialCalendarSourcePage").then((module) => ({ default: module.OfficialCalendarSourcePage })));
const DemoRequestsPage = lazy(() => import("@/features/platform/DemoRequestsPage").then((module) => ({ default: module.DemoRequestsPage })));
const TenantManagementPage = lazy(() => import("@/features/platform/TenantManagementPage").then((module) => ({ default: module.TenantManagementPage })));
const TenantReadinessPage = lazy(() => import("@/features/settings/TenantReadinessPage").then((module) => ({ default: module.TenantReadinessPage })));
const RentalSettingsPage = lazy(() => import("@/features/settings/RentalGovernancePage").then((module) => ({ default: module.RentalGovernancePage })));
const CapabilityGovernancePage = lazy(() => import("@/features/rental-core/CapabilityGovernancePage").then((module) => ({ default: module.CapabilityGovernancePage })));
const TenantOperationsAccountPage = lazy(() => import("@/features/tenant-access/TenantAccessPages").then((module) => ({ default: module.TenantOperationsAccountPage })));
const TenantRolePermissionPage = lazy(() => import("@/features/tenant-access/TenantAccessPages").then((module) => ({ default: module.TenantRolePermissionPage })));
const TenantIntegrationsPage = lazy(() => import("@/features/settings/TenantIntegrationsPage").then((module) => ({ default: module.TenantIntegrationsPage })));
const AiModelSettingsPage = lazy(() => import("@/features/ai-native/AiModelSettingsPage").then((module) => ({ default: module.AiModelSettingsPage })));
const TaskCenterPage = lazy(() => import("@/features/ai-native/TaskCenterPage").then((module) => ({ default: module.TaskCenterPage })));
const ClientChannelPage = lazy(() => import("@/features/channel/ClientChannelPage").then((module) => ({ default: module.ClientChannelPage })));
const AppearancePage = lazy(() => import("@/features/appearance/AppearancePage").then((module) => ({ default: module.AppearancePage })));
const PaymentReconciliationPage = lazy(() => import("@/features/settings/PaymentReconciliationPage").then((module) => ({ default: module.PaymentReconciliationPage })));
const TenantSubscriptionPage = lazy(() => import("@/features/subscription/TenantSubscriptionPage").then((module) => ({ default: module.TenantSubscriptionPage })));
const SubscriptionProPage = lazy(() => import("@/features/subscription/SubscriptionProPage").then((module) => ({ default: module.SubscriptionProPage })));
const SubscriptionRequestDetailPage = lazy(() => import("@/features/subscription/SubscriptionRequestDetailPage").then((module) => ({ default: module.SubscriptionRequestDetailPage })));
const PlatformSubscriptionsPage = lazy(() => import("@/features/subscription/PlatformSubscriptionsPage").then((module) => ({ default: module.PlatformSubscriptionsPage })));
const PlatformSubscriptionDetailPage = lazy(() => import("@/features/subscription/PlatformSubscriptionDetailPage").then((module) => ({ default: module.PlatformSubscriptionDetailPage })));
const SubscriptionCatalogPage = lazy(() => import("@/features/subscription/SubscriptionCatalogPage").then((module) => ({ default: module.SubscriptionCatalogPage })));

function PageLoader() {
  return <div className="route-loader"><LoadingState /></div>;
}

function RouteAccess({ route, children }: { route: AppRouteDefinition; children: ReactNode }) {
  const { t } = useLocale();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const hasTenantMembershipPermission = useAuthStore((state) => state.hasTenantMembershipPermission);
  const categoryCode = useAuthStore((state) => state.tenant?.categoryCode);
  const isSaasAdmin = useAuthStore((state) => Boolean(state.user?.isSaasAdmin));
  if (!canAccessRoute(route, hasPermission, hasCapability, categoryCode, isSaasAdmin, hasTenantMembershipPermission)) {
    return <Result status="403" title={t("无权访问")} subTitle={t("当前账号权限或租户经营品类能力不支持此功能；前端菜单隐藏不能替代后端数据权限。")} />;
  }
  return <>{children}</>;
}

function guard(route: AppRouteDefinition, element: ReactNode) {
  return <RouteAccess route={route}>{element}</RouteAccess>;
}

function LegacyOrderRedirect() {
  const { id = "" } = useParams();
  return <Navigate to={`/rental/orders/${id}`} replace />;
}

function DefaultRoute() {
  const { t } = useLocale();
  const user = useAuthStore((state) => state.user);
  const tenant = useAuthStore((state) => state.tenant);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const hasTenantMembershipPermission = useAuthStore((state) => state.hasTenantMembershipPermission);
  const target = Object.values(APP_ROUTES).find((route) => "menu" in route && route.menu && canAccessRoute(route, hasPermission, hasCapability, tenant?.categoryCode, Boolean(user?.isSaasAdmin), hasTenantMembershipPermission));
  return target ? <Navigate to={target.path} replace /> : <Result status="403" title={t("暂无可访问页面")} subTitle={t("请联系租户管理员授予业务或会员管理权限。")} />;
}

function ProtectedRoutes() {
  const workspaceScopeKey = useAuthStore((state) => `${state.tenant?.tenantId ?? "platform"}:${state.currentWorkspaceId ?? "none"}`);

  return (
    <RequireAuth>
      {/**
       * 经营空间是前端数据边界，不只是页头标签。切换空间时认证 Store 会先
       * 清空 React Query 和中止旧请求；这里再以空间为 key 重挂整个受保护区，
       * 让所有声明式查询及命令式 useEffect 重新取数，避免另一个标签页只更新
       * 了空间名称却继续显示旧空间的数据。
       */}
      <AppShell key={workspaceScopeKey}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<DefaultRoute />} />
            <Route path={APP_ROUTES.workbench.path} element={guard(APP_ROUTES.workbench, <WorkbenchPage />)} />
            <Route path={APP_ROUTES.operationReport.path} element={guard(APP_ROUTES.operationReport, <WorkspaceOperationReportPage />)} />
            <Route path={APP_ROUTES.orderCreate.path} element={guard(APP_ROUTES.orderCreate, <OrderCreatePage />)} />
            <Route path={APP_ROUTES.orders.path} element={guard(APP_ROUTES.orders, <OrdersPage />)} />
            <Route path={APP_ROUTES.orderDetail.path} element={guard(APP_ROUTES.orderDetail, <OrderDetailPage />)} />
            <Route path={APP_ROUTES.itemGroups.path} element={guard(APP_ROUTES.itemGroups, <CatalogPage />)} />
            <Route path={APP_ROUTES.assets.path} element={guard(APP_ROUTES.assets, <AssetWorkspacePage />)} />
            <Route path={APP_ROUTES.workOrders.path} element={guard(APP_ROUTES.workOrders, <MaintenanceWorkOrdersPage />)} />
            <Route path={APP_ROUTES.locations.path} element={guard(APP_ROUTES.locations, <LocationPage />)} />
            <Route path={APP_ROUTES.pricingGroups.path} element={guard(APP_ROUTES.pricingGroups, <PricingGroupPage />)} />
            <Route path={APP_ROUTES.pricing.path} element={guard(APP_ROUTES.pricing, <RentalCommercialPage section="pricing" />)} />
            <Route path={APP_ROUTES.discounts.path} element={guard(APP_ROUTES.discounts, <RentalCommercialPage section="discounts" />)} />
            <Route path={APP_ROUTES.coupons.path} element={guard(APP_ROUTES.coupons, <CouponPage />)} />
            <Route path={APP_ROUTES.services.path} element={guard(APP_ROUTES.services, <RentalCommercialPage section="services" />)} />
            <Route path={APP_ROUTES.tenantReadiness.path} element={guard(APP_ROUTES.tenantReadiness, <TenantReadinessPage />)} />
            <Route path={APP_ROUTES.rentalSettings.path} element={guard(APP_ROUTES.rentalSettings, <RentalSettingsPage />)} />
            <Route path={APP_ROUTES.rentalCapabilities.path} element={guard(APP_ROUTES.rentalCapabilities, <CapabilityGovernancePage />)} />
            <Route path={APP_ROUTES.tenantAccounts.path} element={guard(APP_ROUTES.tenantAccounts, <TenantOperationsAccountPage />)} />
            <Route path={APP_ROUTES.tenantRoles.path} element={guard(APP_ROUTES.tenantRoles, <TenantRolePermissionPage />)} />
            <Route path={APP_ROUTES.tenantIntegrations.path} element={guard(APP_ROUTES.tenantIntegrations, <TenantIntegrationsPage />)} />
            <Route path={APP_ROUTES.aiSettings.path} element={guard(APP_ROUTES.aiSettings, <AiModelSettingsPage />)} />
            <Route path={APP_ROUTES.aiTasks.path} element={guard(APP_ROUTES.aiTasks, <TaskCenterPage />)} />
            <Route path={APP_ROUTES.clientChannel.path} element={guard(APP_ROUTES.clientChannel, <ClientChannelPage />)} />
            <Route path={APP_ROUTES.appearance.path} element={guard(APP_ROUTES.appearance, <AppearancePage />)} />
            <Route path={APP_ROUTES.paymentReconciliation.path} element={guard(APP_ROUTES.paymentReconciliation, <PaymentReconciliationPage />)} />
            <Route path={APP_ROUTES.subscription.path} element={guard(APP_ROUTES.subscription, <TenantSubscriptionPage />)} />
            <Route path={APP_ROUTES.subscriptionPro.path} element={guard(APP_ROUTES.subscriptionPro, <SubscriptionProPage />)} />
            <Route path={APP_ROUTES.subscriptionRequestDetail.path} element={guard(APP_ROUTES.subscriptionRequestDetail, <SubscriptionRequestDetailPage />)} />
            <Route path={APP_ROUTES.qualificationTypes.path} element={guard(APP_ROUTES.qualificationTypes, <QualificationTypesPage />)} />
            <Route path={APP_ROUTES.membershipReviews.path} element={guard(APP_ROUTES.membershipReviews, <MembershipReviewPage />)} />
            <Route path={APP_ROUTES.personalMembers.path} element={guard(APP_ROUTES.personalMembers, <PersonalMembershipPage />)} />
            <Route path={APP_ROUTES.corporateMembers.path} element={guard(APP_ROUTES.corporateMembers, <CorporateMembershipPage />)} />
            <Route path={APP_ROUTES.membershipPlans.path} element={guard(APP_ROUTES.membershipPlans, <MembershipPlanPage />)} />
            <Route path={APP_ROUTES.membershipRewards.path} element={guard(APP_ROUTES.membershipRewards, <MembershipRewardsPage />)} />
            <Route path="/platform" element={<Navigate to={APP_ROUTES.platformUsers.path} replace />} />
            <Route path={APP_ROUTES.platformDemoRequests.path} element={guard(APP_ROUTES.platformDemoRequests, <DemoRequestsPage />)} />
            <Route path={APP_ROUTES.platformTenants.path} element={guard(APP_ROUTES.platformTenants, <TenantManagementPage />)} />
            {CATEGORY_GOVERNANCE_PREVIEW_ENABLED && <Route path={APP_ROUTES.platformCategories.path} element={guard(APP_ROUTES.platformCategories, <CategoryGovernancePage />)} />}
            {CATEGORY_GOVERNANCE_PREVIEW_ENABLED && <Route path={APP_ROUTES.platformCategoryCapabilities.path} element={guard(APP_ROUTES.platformCategoryCapabilities, <CategoryCapabilityCatalogPage />)} />}
            <Route path={APP_ROUTES.platformSubscriptions.path} element={guard(APP_ROUTES.platformSubscriptions, <PlatformSubscriptionsPage />)} />
            <Route path={APP_ROUTES.platformSubscriptionDetail.path} element={guard(APP_ROUTES.platformSubscriptionDetail, <PlatformSubscriptionDetailPage />)} />
            <Route path={APP_ROUTES.subscriptionCatalog.path} element={guard(APP_ROUTES.subscriptionCatalog, <SubscriptionCatalogPage />)} />
            <Route path={APP_ROUTES.platformUsers.path} element={guard(APP_ROUTES.platformUsers, <PlatformPage />)} />
            <Route path={APP_ROUTES.platformSystem.path} element={guard(APP_ROUTES.platformSystem, <PlatformPage />)} />
            <Route path={APP_ROUTES.platformOperations.path} element={guard(APP_ROUTES.platformOperations, <PlatformOperationsPage />)} />
            <Route path={APP_ROUTES.platformTools.path} element={guard(APP_ROUTES.platformTools, <PlatformToolsPage />)} />
            <Route path={APP_ROUTES.platformOfficialCalendars.path} element={guard(APP_ROUTES.platformOfficialCalendars, <OfficialCalendarSourcePage />)} />

            <Route path="/rental/commercial" element={<Navigate to={APP_ROUTES.pricing.path} replace />} />
            <Route path="/new-order" element={<Navigate to={APP_ROUTES.orderCreate.path} replace />} />
            <Route path="/orders" element={<Navigate to={APP_ROUTES.orders.path} replace />} />
            <Route path="/orders/:id" element={<LegacyOrderRedirect />} />
            <Route path="/rental-rules" element={<Navigate to={APP_ROUTES.rentalSettings.path} replace />} />
            <Route path="/service-products" element={<Navigate to={APP_ROUTES.services.path} replace />} />
            <Route path="/services" element={<Navigate to={APP_ROUTES.services.path} replace />} />
            <Route path="/marketing" element={<Navigate to={APP_ROUTES.discounts.path} replace />} />
            <Route path="/pricing" element={<Navigate to={APP_ROUTES.pricing.path} replace />} />
            <Route path="/stations" element={<Navigate to={APP_ROUTES.locations.path} replace />} />
            <Route path="/vehicle-groups" element={<Navigate to={APP_ROUTES.itemGroups.path} replace />} />
            <Route path="/vehicles" element={<Navigate to={APP_ROUTES.assets.path} replace />} />
            {["/customers", "/customers/master", "/members", "/members/:id"].map((path) => <Route key={path} path={path} element={<Navigate to={APP_ROUTES.personalMembers.path} replace />} />)}
            {["/member-reviews"].map((path) => <Route key={path} path={path} element={<Navigate to={APP_ROUTES.membershipReviews.path} replace />} />)}
            {["/membership-plans"].map((path) => <Route key={path} path={path} element={<Navigate to={APP_ROUTES.membershipPlans.path} replace />} />)}
            {["/corporates", "/corporates/:id"].map((path) => <Route key={path} path={path} element={<Navigate to={APP_ROUTES.corporateMembers.path} replace />} />)}
            <Route path="/users" element={<Navigate to={APP_ROUTES.tenantAccounts.path} replace />} />
            {["/organizations", "/permissions"].map((path) => <Route key={path} path={path} element={<Navigate to={APP_ROUTES.tenantRoles.path} replace />} />)}
            <Route path="/system-rules" element={<Navigate to={APP_ROUTES.platformSystem.path} replace />} />
            {["/security-baseline", "/integrations", "/notifications"].map((path) => <Route key={path} path={path} element={<Navigate to={APP_ROUTES.platformOperations.path} replace />} />)}
            {["/platform-governance", "/file-assets", "/async-jobs"].map((path) => <Route key={path} path={path} element={<Navigate to={APP_ROUTES.platformTools.path} replace />} />)}
            <Route path="*" element={<DefaultRoute />} />
          </Routes>
        </Suspense>
      </AppShell>
    </RequireAuth>
  );
}

export function AppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* 租户专属登录链接：/login/:tenantCode 直接显示该租户品牌，隐藏租户编码输入。 */}
        <Route path="/login/:tenantCode" element={<LoginPage />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </Suspense>
  );
}
