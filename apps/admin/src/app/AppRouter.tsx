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
const OrdersPage = lazy(() => import("@/features/rental-core/RentalOrdersPage").then((module) => ({ default: module.RentalOrdersPage })));
const OrderCreatePage = lazy(() => import("@/features/rental-core/RentalOrderCreatePage").then((module) => ({ default: module.RentalOrderCreatePage })));
const OrderDetailPage = lazy(() => import("@/features/rental-core/RentalOrderDetailPage").then((module) => ({ default: module.RentalOrderDetailPage })));
const RentalCommercialPage = lazy(() => import("@/features/commercial/RentalCommercialPage").then((module) => ({ default: module.RentalCommercialPage })));
const CouponPage = lazy(() => import("@/features/commercial/CouponPage").then((module) => ({ default: module.CouponPage })));
const CustomerPage = lazy(() => import("@/features/customers/CustomerPage").then((module) => ({ default: module.CustomerPage })));
const PlatformPage = lazy(() => import("@/features/platform/PlatformPage").then((module) => ({ default: module.PlatformPage })));
const PlatformOperationsPage = lazy(() => import("@/features/platform/PlatformOperationsPage").then((module) => ({ default: module.PlatformOperationsPage })));
const PlatformToolsPage = lazy(() => import("@/features/platform/PlatformToolsPage").then((module) => ({ default: module.PlatformToolsPage })));
const TenantManagementPage = lazy(() => import("@/features/platform/TenantManagementPage").then((module) => ({ default: module.TenantManagementPage })));
const RentalCorePage = lazy(() => import("@/features/rental-core/RentalCorePage").then((module) => ({ default: module.RentalCorePage })));
const RentalSettingsPage = lazy(() => import("@/features/settings/RentalGovernancePage").then((module) => ({ default: module.RentalGovernancePage })));

function PageLoader() {
  return <div className="route-loader"><Spin size="large" /></div>;
}

function RouteAccess({ route, children }: { route: AppRouteDefinition; children: ReactNode }) {
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const categoryCode = useAuthStore((state) => state.tenant?.categoryCode);
  if (!canAccessRoute(route, hasPermission, hasCapability, categoryCode)) {
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
            <Route path={APP_ROUTES.rentalCore.path} element={guard(APP_ROUTES.rentalCore, <RentalCorePage />)} />
            <Route path={APP_ROUTES.orderCreate.path} element={guard(APP_ROUTES.orderCreate, <OrderCreatePage />)} />
            <Route path={APP_ROUTES.orders.path} element={guard(APP_ROUTES.orders, <OrdersPage />)} />
            <Route path={APP_ROUTES.orderDetail.path} element={guard(APP_ROUTES.orderDetail, <OrderDetailPage />)} />
            <Route path={APP_ROUTES.itemGroups.path} element={guard(APP_ROUTES.itemGroups, <CatalogPage />)} />
            <Route path={APP_ROUTES.assets.path} element={guard(APP_ROUTES.assets, <AssetWorkspacePage />)} />
            <Route path={APP_ROUTES.locations.path} element={guard(APP_ROUTES.locations, <LocationPage />)} />
            <Route path={APP_ROUTES.pricing.path} element={guard(APP_ROUTES.pricing, <RentalCommercialPage section="pricing" />)} />
            <Route path={APP_ROUTES.discounts.path} element={guard(APP_ROUTES.discounts, <RentalCommercialPage section="discounts" />)} />
            <Route path={APP_ROUTES.coupons.path} element={guard(APP_ROUTES.coupons, <CouponPage />)} />
            <Route path={APP_ROUTES.services.path} element={guard(APP_ROUTES.services, <RentalCommercialPage section="services" />)} />
            <Route path={APP_ROUTES.rentalSettings.path} element={guard(APP_ROUTES.rentalSettings, <RentalSettingsPage />)} />
            <Route path={APP_ROUTES.customers.path} element={guard(APP_ROUTES.customers, <CustomerPage />)} />
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
            <Route path="/rental-rules" element={<Navigate to={APP_ROUTES.rentalSettings.path} replace />} />
            <Route path="/service-products" element={<Navigate to={APP_ROUTES.services.path} replace />} />
            <Route path="/services" element={<Navigate to={APP_ROUTES.services.path} replace />} />
            <Route path="/marketing" element={<Navigate to={APP_ROUTES.discounts.path} replace />} />
            <Route path="/pricing" element={<Navigate to={APP_ROUTES.pricing.path} replace />} />
            <Route path="/stations" element={<Navigate to={APP_ROUTES.locations.path} replace />} />
            <Route path="/vehicle-groups" element={<Navigate to={APP_ROUTES.itemGroups.path} replace />} />
            <Route path="/vehicles" element={<Navigate to={APP_ROUTES.assets.path} replace />} />
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
