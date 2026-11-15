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

function ProtectedLayout() {
  const { session, brandName, brand, pages } = usePlatformApplication();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { locale } = useLocale(), en = locale === "en-US";
  if (!state.ready) return <LoadingState />;
  if (state.verificationError) return <><QueryState loading={false} error={state.verificationError} onRetry={session.bootstrap}>{null}</QueryState>
    <Button onClick={() => { void session.signOut().catch(() => undefined); }}>{en ? "Return to sign in" : "返回登录"}</Button></>;
  if (!state.sessionVerified || !state.user) return <Navigate to="/login" replace />;
  if (state.user.mustChangePassword) return <AdminPasswordPage onChange={session.changePassword} />;
  const can = (permission: string) => !state.user!.isSaasAdmin && (state.user!.isPlatformAdmin
    || state.user!.dataScope === "all" && state.user!.permissions?.includes(permission));
  const routes = [
    { path: "/", label: en ? "Overview" : "平台概览", icon: <Blocks size={18} /> },
    { path: "/settings/profile", label: en ? "My profile" : "本人资料", icon: <UserRound size={18} /> },
    { path: "/settings/appearance", label: en ? "Appearance" : "账户外观", icon: <Settings size={18} /> },
    ...(can("system:tenant:manage") ? [{ path: "/settings/tenant", label: en ? "Tenant details" : "租户资料" }] : []),
    ...(can("system:integration:manage") ? [{ path: "/settings/tenant-appearance", label: en ? "Tenant appearance" : "租户外观" }] : [])
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
  return <><PageHeading title={en ? "Overview" : "平台概览"} brandName={brandName} />
    <QueryState loading={cores.isPending} error={cores.error} onRetry={cores.refetch}>
      <Alert type="info" showIcon title={en ? `Welcome to ${brandName}` : `欢迎使用 ${brandName}`}
        description={cores.data?.cores.length ? en ? "Choose an authorized business Core from the sidebar." : "从左侧选择已获授权的业务 Core。"
          : en ? "Contact your administrator to enable a business Core." : "请联系管理员授权业务 Core。"} />
    </QueryState></>;
}

function TenantSetting({ appearance = false }: { appearance?: boolean }) {
  const { session } = usePlatformApplication();
  const { user } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const permission = appearance ? "system:integration:manage" : "system:tenant:manage";
  const allowed = user && !user.isSaasAdmin && (user.isPlatformAdmin || user.dataScope === "all" && user.permissions?.includes(permission));
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
