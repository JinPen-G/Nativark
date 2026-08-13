import { lazy, Suspense, type ReactNode } from "react";
import { Result, Spin } from "antd";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { APP_ROUTES, canAccessRoute, type AppRouteDefinition } from "@/app/navigation";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { useAuthStore } from "@/features/auth/authStore";

const LoginPage = lazy(() => import("@/features/auth/LoginPage").then((module) => ({ default: module.LoginPage })));
const WorkbenchPage = lazy(() => import("@/features/workbench/WorkbenchPage").then((module) => ({ default: module.WorkbenchPage })));
const CatalogPage = lazy(() => import("@/features/catalog/CatalogPage").then((module) => ({ default: module.CatalogPage })));
const AssetWorkspacePage = lazy(() => import("@/features/catalog/AssetWorkspacePage").then((module) => ({ default: module.AssetWorkspacePage })));
const LocationPage = lazy(() => import("@/features/fulfillment/LocationPage").then((module) => ({ default: module.LocationPage })));
const OrdersPage = lazy(() => import("@/features/orders/OrdersPage").then((module) => ({ default: module.OrdersPage })));
const OrderCreatePage = lazy(() => import("@/features/orders/OrderCreatePage").then((module) => ({ default: module.OrderCreatePage })));
const OrderDetailPage = lazy(() => import("@/features/orders/OrderDetailPage").then((module) => ({ default: module.OrderDetailPage })));
const ContractsPage = lazy(() => import("@/features/contracts/ContractsPage").then((module) => ({ default: module.ContractsPage })));
const CommercialWorkspacePage = lazy(() => import("@/features/commercial/CommercialWorkspacePage").then((module) => ({ default: module.CommercialWorkspacePage })));
const CouponPage = lazy(() => import("@/features/commercial/CouponPage").then((module) => ({ default: module.CouponPage })));
const CustomerPage = lazy(() => import("@/features/customers/CustomerPage").then((module) => ({ default: module.CustomerPage })));
const FinancePage = lazy(() => import("@/features/finance/FinancePage").then((module) => ({ default: module.FinancePage })));
const OperationsPage = lazy(() => import("@/features/operations/OperationsPage").then((module) => ({ default: module.OperationsPage })));
const AssetOperationsPage = lazy(() => import("@/features/operations/AssetOperationsPage").then((module) => ({ default: module.AssetOperationsPage })));
const ReportsPage = lazy(() => import("@/features/reports/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const PlatformPage = lazy(() => import("@/features/platform/PlatformPage").then((module) => ({ default: module.PlatformPage })));
const PlatformOperationsPage = lazy(() => import("@/features/platform/PlatformOperationsPage").then((module) => ({ default: module.PlatformOperationsPage })));
const AssetLifecyclePage = lazy(() => import("@/features/catalog/AssetLifecyclePage").then((module) => ({ default: module.AssetLifecyclePage })));
const BusinessToolsPage = lazy(() => import("@/features/advanced/BusinessToolsPage").then((module) => ({ default: module.BusinessToolsPage })));
const PlatformToolsPage = lazy(() => import("@/features/platform/PlatformToolsPage").then((module) => ({ default: module.PlatformToolsPage })));
const TenantManagementPage = lazy(() => import("@/features/platform/TenantManagementPage").then((module) => ({ default: module.TenantManagementPage })));
const RentalCorePage = lazy(() => import("@/features/rental-core/RentalCorePage").then((module) => ({ default: module.RentalCorePage })));
const RentalSettingsPage = lazy(() => import("@/features/settings/RentalSettingsPage").then((module) => ({ default: module.RentalSettingsPage })));

function PageLoader() {
  return <div className="route-loader"><Spin size="large" /></div>;
}

function RouteAccess({ route, children }: { route: AppRouteDefinition; children: ReactNode }) {
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  if (!canAccessRoute(route, hasPermission, hasCapability)) {
    return <Result status="403" title="无权访问" subTitle="当前账号权限或租户经营品类能力不支持此功能；前端菜单隐藏不能替代后端数据权限。" />;
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
  const isSaasAdmin = useAuthStore((state) => Boolean(state.user?.isSaasAdmin));
  return <Navigate to={isSaasAdmin ? APP_ROUTES.platformTenants.path : APP_ROUTES.workbench.path} replace />;
}

function ProtectedRoutes() {
  return (
    <RequireAuth>
      <AppShell>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<DefaultRoute />} />
            <Route path={APP_ROUTES.workbench.path} element={guard(APP_ROUTES.workbench, <WorkbenchPage />)} />
            <Route path={APP_ROUTES.rentalCore.path} element={guard(APP_ROUTES.rentalCore, <RentalCorePage />)} />
            <Route path={APP_ROUTES.orderCreate.path} element={guard(APP_ROUTES.orderCreate, <OrderCreatePage />)} />
            <Route path={APP_ROUTES.orders.path} element={guard(APP_ROUTES.orders, <OrdersPage />)} />
            <Route path={APP_ROUTES.orderDetail.path} element={guard(APP_ROUTES.orderDetail, <OrderDetailPage />)} />
            <Route path={APP_ROUTES.contracts.path} element={guard(APP_ROUTES.contracts, <ContractsPage />)} />
            <Route path={APP_ROUTES.itemGroups.path} element={guard(APP_ROUTES.itemGroups, <CatalogPage />)} />
            <Route path={APP_ROUTES.assets.path} element={guard(APP_ROUTES.assets, <AssetWorkspacePage />)} />
            <Route path={APP_ROUTES.locations.path} element={guard(APP_ROUTES.locations, <LocationPage />)} />
            <Route path={APP_ROUTES.pricing.path} element={guard(APP_ROUTES.pricing, <CommercialWorkspacePage section="pricing" />)} />
            <Route path={APP_ROUTES.discounts.path} element={guard(APP_ROUTES.discounts, <CommercialWorkspacePage section="marketing" />)} />
            <Route path={APP_ROUTES.coupons.path} element={guard(APP_ROUTES.coupons, <CouponPage />)} />
            <Route path={APP_ROUTES.services.path} element={guard(APP_ROUTES.services, <CommercialWorkspacePage section="services" />)} />
            <Route path={APP_ROUTES.rentalSettings.path} element={guard(APP_ROUTES.rentalSettings, <RentalSettingsPage />)} />
            <Route path={APP_ROUTES.customers.path} element={guard(APP_ROUTES.customers, <CustomerPage />)} />
            <Route path={APP_ROUTES.finance.path} element={guard(APP_ROUTES.finance, <FinancePage />)} />
            <Route path={APP_ROUTES.operations.path} element={guard(APP_ROUTES.operations, <OperationsPage />)} />
            <Route path={APP_ROUTES.assetOperations.path} element={guard(APP_ROUTES.assetOperations, <AssetOperationsPage />)} />
            <Route path={APP_ROUTES.assetLifecycle.path} element={guard(APP_ROUTES.assetLifecycle, <AssetLifecyclePage />)} />
            <Route path={APP_ROUTES.businessTools.path} element={guard(APP_ROUTES.businessTools, <BusinessToolsPage />)} />
            <Route path={APP_ROUTES.reports.path} element={guard(APP_ROUTES.reports, <ReportsPage />)} />
            <Route path="/platform" element={<Navigate to={APP_ROUTES.platformUsers.path} replace />} />
            <Route path={APP_ROUTES.platformTenants.path} element={guard(APP_ROUTES.platformTenants, <TenantManagementPage />)} />
            <Route path={APP_ROUTES.platformUsers.path} element={guard(APP_ROUTES.platformUsers, <PlatformPage />)} />
            <Route path={APP_ROUTES.platformSystem.path} element={guard(APP_ROUTES.platformSystem, <PlatformPage />)} />
            <Route path={APP_ROUTES.platformOperations.path} element={guard(APP_ROUTES.platformOperations, <PlatformOperationsPage />)} />
            <Route path={APP_ROUTES.platformTools.path} element={guard(APP_ROUTES.platformTools, <PlatformToolsPage />)} />

            <Route path="/rental/commercial" element={<Navigate to={APP_ROUTES.pricing.path} replace />} />
            <Route path="/new-order" element={<Navigate to={APP_ROUTES.orderCreate.path} replace />} />
            <Route path="/orders" element={<Navigate to={APP_ROUTES.orders.path} replace />} />
            <Route path="/orders/:id" element={<LegacyOrderRedirect />} />
            <Route path="/contracts" element={<Navigate to={APP_ROUTES.contracts.path} replace />} />
            <Route path="/rental-rules" element={<Navigate to={APP_ROUTES.rentalSettings.path} replace />} />
            <Route path="/service-products" element={<Navigate to={APP_ROUTES.services.path} replace />} />
            <Route path="/services" element={<Navigate to={APP_ROUTES.services.path} replace />} />
            <Route path="/marketing" element={<Navigate to={APP_ROUTES.discounts.path} replace />} />
            <Route path="/pricing" element={<Navigate to={APP_ROUTES.pricing.path} replace />} />
            <Route path="/stations" element={<Navigate to={APP_ROUTES.locations.path} replace />} />
            <Route path="/vehicle-groups" element={<Navigate to={APP_ROUTES.itemGroups.path} replace />} />
            <Route path="/vehicles" element={<Navigate to={APP_ROUTES.assets.path} replace />} />
            {["/vehicle-status", "/vehicle-console"].map((path) => <Route key={path} path={path} element={<Navigate to={APP_ROUTES.assetLifecycle.path} replace />} />)}
            {["/vehicle-transfer", "/tbox-management"].map((path) => <Route key={path} path={path} element={<Navigate to={APP_ROUTES.assetOperations.path} replace />} />)}
            <Route path="/dispatch" element={<Navigate to={APP_ROUTES.operations.path} replace />} />
            <Route path="/rental/operations" element={<Navigate to={APP_ROUTES.operations.path} replace />} />
            {["/members", "/members/:id", "/member-reviews", "/membership-plans", "/corporates", "/corporates/:id"].map((path) => <Route key={path} path={path} element={<Navigate to={APP_ROUTES.customers.path} replace />} />)}
            {["/organizations", "/users", "/permissions"].map((path) => <Route key={path} path={path} element={<Navigate to={APP_ROUTES.platformUsers.path} replace />} />)}
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
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </Suspense>
  );
}
