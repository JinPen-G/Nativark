import { lazy, Suspense, type ReactNode } from "react";
import { Result, Spin } from "antd";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
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

function PageLoader() {
  return <div className="route-loader"><Spin size="large" /></div>;
}

function PermissionRoute({ permission, children }: { permission: string; children: ReactNode }) {
  const hasPermission = useAuthStore((state) => state.hasPermission);
  if (!hasPermission(permission)) {
    return <Result status="403" title="无权访问" subTitle="当前账号缺少此功能所需权限；菜单隐藏不能替代后端数据权限。" />;
  }
  return <>{children}</>;
}

function guard(permission: string, element: ReactNode) {
  return <PermissionRoute permission={permission}>{element}</PermissionRoute>;
}

function LegacyOrderRedirect() {
  const { id = "" } = useParams();
  return <Navigate to={`/rental/orders/${id}`} replace />;
}

function DefaultRoute() {
  const isSaasAdmin = useAuthStore((state) => Boolean(state.user?.isSaasAdmin));
  return <Navigate to={isSaasAdmin ? "/platform/tenants" : "/workbench"} replace />;
}

function ProtectedRoutes() {
  return (
    <RequireAuth>
      <AppShell>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<DefaultRoute />} />
            <Route path="/workbench" element={guard("store-rental:report:view", <WorkbenchPage />)} />
            <Route path="/rental/core" element={guard("store-rental:order:view", <RentalCorePage />)} />
            <Route path="/rental/orders/new" element={guard("store-rental:order:create", <OrderCreatePage />)} />
            <Route path="/rental/orders" element={guard("store-rental:order:view", <OrdersPage />)} />
            <Route path="/rental/orders/:id" element={guard("store-rental:order:view", <OrderDetailPage />)} />
            <Route path="/rental/contracts" element={guard("store-rental:order:view", <ContractsPage />)} />
            <Route path="/rental/item-groups" element={guard("store-rental:vehicle-group:manage", <CatalogPage />)} />
            <Route path="/rental/assets" element={guard("store-rental:vehicle:view", <AssetWorkspacePage />)} />
            <Route path="/rental/locations" element={guard("store-rental:station:view", <LocationPage />)} />
            <Route path="/rental/commercial" element={guard("store-rental:price:manage", <CommercialWorkspacePage />)} />
            <Route path="/rental/pricing" element={<Navigate to="/rental/commercial" replace />} />
            <Route path="/customers" element={guard("store-rental:member:view", <CustomerPage />)} />
            <Route path="/finance" element={guard("store-rental:finance:view", <FinancePage />)} />
            <Route path="/operations" element={guard("store-rental:dispatch:manage", <OperationsPage />)} />
            <Route path="/asset-operations" element={guard("store-rental:vehicle:view", <AssetOperationsPage />)} />
            <Route path="/asset-lifecycle" element={guard("store-rental:vehicle:view", <AssetLifecyclePage />)} />
            <Route path="/business-tools" element={guard("store-rental:dispatch:manage", <BusinessToolsPage />)} />
            <Route path="/reports" element={guard("store-rental:report:view", <ReportsPage />)} />
            <Route path="/platform" element={<Navigate to="/platform/users" replace />} />
            <Route path="/platform/tenants" element={guard("system:tenant:manage", <TenantManagementPage />)} />
            <Route path="/platform/users" element={guard("system:user:manage", <PlatformPage />)} />
            <Route path="/platform/system" element={guard("system:params:manage", <PlatformPage />)} />
            <Route path="/platform/operations" element={guard("system:params:manage", <PlatformOperationsPage />)} />
            <Route path="/platform/tools" element={guard("system:params:manage", <PlatformToolsPage />)} />
            <Route path="/new-order" element={<Navigate to="/rental/orders/new" replace />} />
            <Route path="/orders" element={<Navigate to="/rental/orders" replace />} />
            <Route path="/orders/:id" element={<LegacyOrderRedirect />} />
            <Route path="/contracts" element={<Navigate to="/rental/contracts" replace />} />
            {["/rental-rules", "/service-products", "/services", "/marketing"].map((path) => <Route key={path} path={path} element={<Navigate to="/rental/commercial" replace />} />)}
            <Route path="/pricing" element={<Navigate to="/business-tools" replace />} />
            <Route path="/stations" element={<Navigate to="/rental/locations" replace />} />
            <Route path="/vehicle-groups" element={<Navigate to="/rental/item-groups" replace />} />
            <Route path="/vehicles" element={<Navigate to="/rental/assets" replace />} />
            {["/vehicle-status", "/vehicle-console"].map((path) => <Route key={path} path={path} element={<Navigate to="/asset-lifecycle" replace />} />)}
            {["/vehicle-transfer", "/tbox-management"].map((path) => <Route key={path} path={path} element={<Navigate to="/asset-operations" replace />} />)}
            <Route path="/dispatch" element={<Navigate to="/operations" replace />} />
            <Route path="/rental/operations" element={<Navigate to="/operations" replace />} />
            {["/members", "/members/:id", "/member-reviews", "/membership-plans", "/corporates", "/corporates/:id"].map((path) => <Route key={path} path={path} element={<Navigate to="/customers" replace />} />)}
            {["/organizations", "/users", "/permissions"].map((path) => <Route key={path} path={path} element={<Navigate to="/platform/users" replace />} />)}
            <Route path="/system-rules" element={<Navigate to="/platform/system" replace />} />
            {["/security-baseline", "/integrations", "/notifications"].map((path) => <Route key={path} path={path} element={<Navigate to="/platform/operations" replace />} />)}
            {["/platform-governance", "/file-assets", "/async-jobs"].map((path) => <Route key={path} path={path} element={<Navigate to="/platform/tools" replace />} />)}
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
