/** 公共 Web 组合工厂，默认空Core。宿主注入登记页面，身份/权限来自原API。 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, RouterProvider } from "react-router-dom";
import { Blocks, Settings, UserRound } from "lucide-react";
import { AdminRuntimeProvider } from "./runtime";
import { AdminUiProvider } from "./AdminUiProvider";
import { PlatformShell } from "./PlatformShell";
import { AdminLoginPage, AdminPasswordPage } from "./session-pages";
import { LoadingState, PageHeading, QueryState } from "./shell";
import { Alert, Button, Result } from "./components/ui";
import { useLocale } from "./app/locale";
import { createCoreRouteElements, useCoreSession } from "./core";
import { PlatformApplicationContext, usePlatformApplication, type PlatformAdminApplicationOptions } from "./application-context";
import { AccountAppearancePage, SelfProfilePage, TenantAppearancePage, TenantProfilePage } from "./SettingsPage";
import { CoreAccessPage } from "./CoreAccessPage";
import { canManagePublicResource } from "./application-access";
import { useAdminSession } from "./runtime";
import { PublicManagementPage } from "./features/access/PublicManagementPages";

function ProtectedLayout() {
  const { session, brandName, brand, pages } = usePlatformApplication();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { locale } = useLocale(), en = locale === "en-US";
  if (!state.ready) return <LoadingState />;
  if (state.verificationError) return <><QueryState loading={false} error={state.verificationError} onRetry={session.bootstrap}>{null}</QueryState>
    <Button onClick={() => { void session.signOut().catch(() => undefined); }}>{en ? "Return to sign in" : "返回登录"}</Button></>;
  if (!state.sessionVerified || !state.user) return <Navigate to="/login" replace />;
  if (state.user.mustChangePassword) return <AdminPasswordPage onChange={session.changePassword} />;
  const can = (permission: string) => canManagePublicResource(state.user, "tenant", permission);
  const routes = [
    { path: "/", label: en ? "Overview" : "平台概览", icon: <Blocks size={18} /> },
    { path: "/settings/profile", label: en ? "My profile" : "本人资料", icon: <UserRound size={18} /> },
    { path: "/settings/appearance", label: en ? "Appearance" : "账户外观", icon: <Settings size={18} /> },
    ...(can("system:tenant:manage") ? [{ path: "/settings/tenant", label: en ? "Tenant details" : "租户资料" }] : []),
    ...(can("system:integration:manage") ? [{ path: "/settings/tenant-appearance", label: en ? "Tenant appearance" : "租户外观" }] : []),
    ...(can("system:user:manage") ? [{ path: "/settings/member-cores", label: en ? "Member Core access" : "成员 Core 分配" }] : []),
    ...(can("system:user:manage") ? [{ path: "/settings/users", label: en ? "Members" : "人员管理" }] : []),
    ...(can("system:role:manage") ? [{ path: "/settings/roles", label: en ? "Roles" : "角色权限" }] : []),
    ...(canManagePublicResource(state.user, "saas", "system:tenant:manage")
      ? [{ path: "/platform/tenants", label: en ? "Tenants" : "租户管理" }] : []),
    ...(canManagePublicResource(state.user, "saas", "system:tenant:manage")
      ? [{ path: "/platform/core-access", label: en ? "Tenant Core access" : "租户 Core 授权" }] : [])
  ];
  return <PlatformShell brandName={brandName} brand={brand} pages={pages} onSignOut={session.signOut}
    publicSections={[{ key: "overview", label: "", routes }]}><Outlet key={session.currentSessionEpoch()} /></PlatformShell>;
}

function SignIn() {
  const { session, brandName } = usePlatformApplication();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return state.sessionVerified ? <Navigate to="/" replace /> : <AdminLoginPage brandName={brandName} onLogin={session.login} />;
}

function Home() {
  const { brandName } = usePlatformApplication();
  const cores = useCoreSession(), { locale } = useLocale(), en = locale === "en-US";
  const { user } = useAdminSession();
  return <><PageHeading title={en ? "Overview" : "平台概览"} brandName={brandName} />
    <QueryState loading={cores.isPending} error={cores.error} onRetry={cores.refetch}>
      <Alert type="info" showIcon title={en ? `Welcome to ${brandName}` : `欢迎使用 ${brandName}`}
        description={user?.isSaasAdmin ? en ? "Use platform administration to manage tenant Core access." : "从平台管理入口维护租户的 Core 使用权。"
          : cores.data?.cores.length ? en ? "Choose an authorized business Core from the sidebar." : "从左侧选择已获授权的业务 Core。"
          : cores.data?.tenantHasRegisteredGrant ? en ? "Ask your tenant administrator to assign a business Core." : "请联系租户管理员分配业务 Core。"
          : en ? "Contact your SaaS administrator to enable a business Core." : "请联系 SaaS 管理员授权业务 Core。"} />
    </QueryState></>;
}

function TenantSetting({ appearance = false }: { appearance?: boolean }) {
  const { session } = usePlatformApplication();
  const { user } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const permission = appearance ? "system:integration:manage" : "system:tenant:manage";
  const allowed = canManagePublicResource(user, "tenant", permission);
  return allowed ? appearance ? <TenantAppearancePage /> : <TenantProfilePage /> : <Result status="403" title="403" />;
}

export function createPlatformAdminApplication(options: PlatformAdminApplicationOptions) {
  const { session } = options;
  const router = createBrowserRouter([
  { path: "/login", element: <SignIn /> },
  { element: <ProtectedLayout />, children: [
    { path: "/", element: <Home /> }, { path: "/settings/profile", element: <SelfProfilePage /> },
    { path: "/settings/appearance", element: <AccountAppearancePage /> },
    { path: "/settings/tenant", element: <TenantSetting /> }, { path: "/settings/tenant-appearance", element: <TenantSetting appearance /> },
    { path: "/platform/core-access", element: <CoreAccessPage audience="saas" /> },
    { path: "/settings/member-cores", element: <CoreAccessPage audience="tenant" /> },
    { path: "/platform/tenants", element: <PublicManagementPage kind="tenants" /> },
    { path: "/platform/tenants/new", element: <PublicManagementPage kind="tenants" edit /> },
    { path: "/platform/tenants/:id", element: <PublicManagementPage kind="tenants" edit /> },
    { path: "/platform/tenants/:id/status", element: <PublicManagementPage kind="tenants" edit status /> },
    { path: "/settings/users/:id/reset-password", element: <PublicManagementPage kind="users" action /> },
    { path: "/settings/roles/:id/delete", element: <PublicManagementPage kind="roles" action /> },
    ...(["users", "roles"] as const).flatMap(kind => [
      { path: `/settings/${kind}`, element: <PublicManagementPage kind={kind} /> },
      { path: `/settings/${kind}/new`, element: <PublicManagementPage kind={kind} edit /> },
      { path: `/settings/${kind}/:id`, element: <PublicManagementPage kind={kind} edit /> }
    ]),
    ...createRoutesFromElements(createCoreRouteElements(options.pages ?? new Map(), { brandName: options.brandName })),
    { path: "*", element: <Result status="404" title="404" /> }
  ] }
  ]);

  return function PlatformAdminApplication() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => { void session.bootstrap(); }, []);
  const identity = JSON.stringify([state.tenant?.tenantId, state.user?.id, state.user?.permissions, state.user?.dataScope,
    state.user?.locationScope, state.user?.organizationId, session.currentSessionEpoch(), state.sessionVerified]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  return <AdminUiProvider queryClient={session.queryClient} scope={{ identity, currentIdentity: () => currentIdentity.current }}
    soundScope={state.sessionVerified && state.user ? { key: JSON.stringify([state.tenant?.tenantId, state.user.id]), epoch: session.currentSessionEpoch() } : null}
    accountThemeColor={state.sessionVerified ? state.user?.accountThemeColor : undefined}
    radii={state.sessionVerified ? { container: state.tenant?.adminContainerRadius, button: state.tenant?.adminButtonRadius,
      input: state.tenant?.adminInputRadius, legacy: state.tenant?.adminCornerRadius } : undefined}>
    <AdminRuntimeProvider runtime={session.runtime}><PlatformApplicationContext.Provider value={options}>
      <RouterProvider router={router} /></PlatformApplicationContext.Provider></AdminRuntimeProvider>
  </AdminUiProvider>;
  };
}
export type { PlatformAdminApplicationOptions } from "./application-context";
