/** 零 Core 公共 Web 装配。身份/权限来自同一公共 API，不加载 Rental 模块或业务 Agent。 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import { Blocks, Settings, UserRound } from "lucide-react";
import { AdminRuntimeProvider, AdminUiProvider, PlatformShell } from "@rental-os/platform-admin";
import { AdminLoginPage, AdminPasswordPage } from "@rental-os/platform-admin/session-pages";
import { LoadingState, PageHeading, QueryState } from "@rental-os/platform-admin/shell";
import { Alert, Button, Result } from "@rental-os/platform-admin/ui";
import { useLocale } from "@rental-os/platform-admin/locale";
import { useCoreSession } from "@rental-os/platform-admin/core";
import { session } from "./session";
import { AccountAppearancePage, SelfProfilePage, TenantAppearancePage, TenantProfilePage } from "./SettingsPage";

function ProtectedLayout() {
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
  return <PlatformShell brandName="Nativark" brand={<Blocks aria-hidden />} onSignOut={session.signOut}
    publicSections={[{ key: "overview", label: "", routes }]}><Outlet key={session.currentSessionEpoch()} /></PlatformShell>;
}

function SignIn() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return state.sessionVerified ? <Navigate to="/" replace /> : <AdminLoginPage brandName="Nativark" onLogin={session.login} />;
}

function Home() {
  const cores = useCoreSession(), { locale } = useLocale(), en = locale === "en-US";
  return <><PageHeading title={en ? "Overview" : "平台概览"} brandName="Nativark" />
    <QueryState loading={cores.isPending} error={cores.error} onRetry={cores.refetch}>
      <Alert type="info" showIcon title={en ? "Welcome to Nativark" : "欢迎使用 Nativark"}
        description={cores.data?.cores.length ? en ? "Choose an authorized business Core from the sidebar." : "从左侧选择已获授权的业务 Core。"
          : en ? "Contact your administrator to enable a business Core." : "请联系管理员授权业务 Core。"} />
    </QueryState></>;
}

function TenantSetting({ appearance = false }: { appearance?: boolean }) {
  const { user } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const permission = appearance ? "system:integration:manage" : "system:tenant:manage";
  const allowed = user && !user.isSaasAdmin && (user.isPlatformAdmin || user.dataScope === "all" && user.permissions?.includes(permission));
  return allowed ? appearance ? <TenantAppearancePage /> : <TenantProfilePage /> : <Result status="403" title="403" />;
}

const router = createBrowserRouter([
  { path: "/login", element: <SignIn /> },
  { element: <ProtectedLayout />, children: [
    { path: "/", element: <Home /> }, { path: "/settings/profile", element: <SelfProfilePage /> },
    { path: "/settings/appearance", element: <AccountAppearancePage /> },
    { path: "/settings/tenant", element: <TenantSetting /> }, { path: "/settings/tenant-appearance", element: <TenantSetting appearance /> },
    { path: "*", element: <Result status="404" title="404" /> }
  ] }
]);

export function PlatformAdminApp() {
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
    <AdminRuntimeProvider runtime={session.runtime}><RouterProvider router={router} /></AdminRuntimeProvider>
  </AdminUiProvider>;
}
