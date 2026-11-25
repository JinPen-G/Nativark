/** 公共 Web 组合工厂，默认空Core。宿主注入登记页面，身份/权限来自原API。 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AuthUser } from "@rental-os/platform-contracts";
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, RouterProvider, useLocation, useNavigate, useParams } from "react-router-dom";
import { coreNavigationEntries, corePageKey } from "@rental-os/core-contracts";
import { AdminRuntimeProvider } from "./runtime";
import { isTenantLoginAliasPath, resolveLoginTenantCode } from "./features/auth/login-entry";
import { BrandIconProvider } from "./app/BrandIconProvider";
import { AdminUiProvider } from "./AdminUiProvider";
import { PlatformShell, type PlatformShellProps } from "./PlatformShell";
import { coreNavigationMessage } from "./coreNavigationMessage";
import { AdminLoginPage, AdminPasswordPage, PasswordChangeGate } from "./session-pages";
import { LoadingState, PageHeading, QueryState } from "./shell";
import { Alert, AnimatedIcon, Button, Result } from "./components/ui";
import { SafetyCertificateOutlined } from "./components/ui/icons";
import { useLocale } from "./app/locale";
import { createCoreRouteElements, useCoreSession } from "./core";
import { PlatformApplicationContext, usePlatformApplication, type PlatformAdminApplicationOptions } from "./application-context";
import { createPublicAdminLocationAccess, LEGACY_PUBLIC_ADMIN_ROUTE_ALIASES, publicAdminNavigation } from "./application-navigation";
import { AccountAppearancePage, SelfProfilePage, TenantAppearancePage, TenantProfilePage } from "./SettingsPage";
import { CoreAccessPage } from "./CoreAccessPage";
import { CorePackagesPage } from "./features/core-packages";
import { canManagePublicResource } from "./application-access";
import { useAdminSession } from "./runtime";
import { PublicManagementCoreProvider } from "./features/access/management-adapter";
import { PublicManagementPage } from "./features/access/PublicManagementPages";
import { TenantSubscriptionPage, SubscriptionProPage, SubscriptionRequestDetailPage, PlatformSubscriptionsPage,
  PlatformSubscriptionDetailPage, SubscriptionCatalogPage, SubscriptionExpiryFloatingCard, SubscriptionRoute,
  SUBSCRIPTION_ROUTES, hasSubscriptionPermission } from "./features/subscription";
import { TenantIntegrationsPage, TENANT_INTEGRATIONS_ROUTE, hasTenantIntegrationPermission } from "./features/integrations";
import { OrganizationsPage, PlatformPage, PlatformSystemPage, PlatformOperationsPage,
  DemoRequestsPage, OfficialCalendarSourcePage, PLATFORM_SETTINGS_ROUTES } from "./features/platform-settings";
import { PlatformToolsPage, PLATFORM_TOOLS_ROUTE, canManagePlatformTools } from "./features/platform-tools";
import { AcceptOperatorInvitationPage, CustomerSupportPage, TenantDispatchPage, createOperatorInvitationApi,
  hasTenantMessagingPermission } from "./features/messaging";

const clientAuthorizationPath = "/settings/client-authorization";

function applicationPublicSections(options: PlatformAdminApplicationOptions, user: AuthUser, showOverview: boolean) {
  const sections = publicAdminNavigation(user, showOverview, Boolean(options.platformAiPage), options.saasPages);
  if (options.clientAuthorizationPage && canManagePublicResource(user, "tenant", "system:params:manage")) {
    let group = sections.find(section => section.key === "account-access");
    if (!group) {
      group = { key: "account-access", label: "账号与权限", displayLabel: "账号权限", icon: <AnimatedIcon name="access" />, routes: [] };
      const following = sections.findIndex(section => section.key === "service-channels" || section.key === "platform-management");
      sections.splice(following < 0 ? sections.length : following, 0, group);
    }
    group.routes.push({ path: clientAuthorizationPath, label: "客户端授权", icon: <SafetyCertificateOutlined /> });
  }
  return sections;
}

/** 同一会话、目录和原生成器供给已过滤菜单，宿主呈现 hook 不改变准入。 */
function useApplicationNavigationSections(): PlatformShellProps["publicSections"] {
  const options = usePlatformApplication();
  const state = useSyncExternalStore(options.session.subscribe, options.session.getSnapshot);
  const { locale, t } = useLocale();
  const cores = useCoreSession();
  const presentation = options.useNavigationPresentation?.();
  const entries = state.sessionVerified && state.user && cores.data
    ? coreNavigationEntries(options.pages ?? new Map(), cores.data, locale) : [];
  const publicSections = state.sessionVerified && state.user
    ? applicationPublicSections(options, state.user, !state.user.isSaasAdmin && !entries.length) : [];
  const groups = new Map<string, PlatformShellProps["publicSections"][number]>(publicSections
    .map(section => [section.key, { ...section, routes: [...section.routes] }]));
  for (const entry of entries) {
    const label = entry.group ?? entry.coreName;
    const shared = publicSections.find(section => t(section.label) === label || section.label === label);
    const key = shared?.key ?? JSON.stringify([entry.coreId, entry.group]);
    const group = groups.get(key) ?? { key, label, routes: [] };
    group.routes.push({ path: entry.path, label: entry.label });
    groups.set(key, group);
  }
  const sections = [...groups.values()];
  return presentation ? presentation(sections) : sections;
}

function ApplicationRouterLayout() {
  const { RouterBridge } = usePlatformApplication();
  return <>{RouterBridge && <RouterBridge />}<Outlet /></>;
}

function ClientAuthorization() {
  const { clientAuthorizationPage: Page } = usePlatformApplication();
  const { user, sessionVerified } = useAdminSession();
  return Page && sessionVerified && canManagePublicResource(user, "tenant", "system:params:manage")
    ? <Page /> : <Result status="403" title="403" />;
}

function ProtectedLayout() {
  const options = usePlatformApplication();
  const { session, brandName, brand, pages, Shell = PlatformShell } = options;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { locale } = useLocale(), en = locale === "en-US";
  const cores = useCoreSession();
  if (!state.ready) return <LoadingState />;
  if (state.verificationError) return <><QueryState loading={false} error={state.verificationError} onRetry={session.bootstrap}>{null}</QueryState>
    <Button onClick={() => { void session.signOut().catch(() => undefined); }}>{en ? "Return to sign in" : "返回登录"}</Button></>;
  if (!state.sessionVerified || !state.user) return <Navigate to="/login" replace />;
  if (state.user.mustChangePassword) return <PasswordChangeGate onChange={session.changePassword} />;
  const hasBusinessMenu = Boolean(cores.data && coreNavigationEntries(pages ?? new Map(), cores.data, locale).length);
  return <Shell brandName={brandName} brand={brand} pages={pages} onSignOut={session.signOut}
    publicSections={applicationPublicSections(options, state.user, !state.user.isSaasAdmin && !hasBusinessMenu)}>
    <Outlet key={session.currentSessionEpoch()} />
  </Shell>;
}

function SignIn() {
  const { session, brandName, loginDisplay } = usePlatformApplication();
  const { tenantCode: rawTenantCode } = useParams();
  const tenantCode = resolveLoginTenantCode(rawTenantCode);
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const sameTenant = !tenantCode || state.tenant?.tenantCode === tenantCode;
  return state.sessionVerified && sameTenant && !signingIn ? <Navigate to="/" replace />
    : <AdminLoginPage {...loginDisplay} key={tenantCode} brandName={brandName} tenantCode={tenantCode} onLogin={async input => {
      setSigningIn(true);
      try { return await session.login(input); } catch (error) { setSigningIn(false); throw error; }
    }} onLoginSuccess={result => navigate("/", { replace: true, state: { needsTenantOnboarding: result.needsTenantOnboarding === true } })} />;
}

function TenantLoginAlias() {
  const { pathname } = useLocation();
  return isTenantLoginAliasPath(pathname) ? <SignIn /> : <Result status="404" title="404" />;
}

function Home() {
  const { brandName, pages, initialPage, onboardingPage, platformAiPage, saasPages } = usePlatformApplication();
  const location = useLocation();
  const cores = useCoreSession(), { locale } = useLocale(), en = locale === "en-US";
  const { user } = useAdminSession();
  if (user?.isSaasAdmin) {
    const target = publicAdminNavigation(user, false, Boolean(platformAiPage), saasPages).flatMap(section => section.routes)[0];
    if (target) return <Navigate to={target.path} replace />;
  }
  const available = cores.data ? coreNavigationEntries(pages ?? new Map(), cores.data, locale) : [];
  const start = location.state?.needsTenantOnboarding ? onboardingPage ?? initialPage : initialPage;
  const preferred = start && available.find(page => page.key === corePageKey(start.coreId, start.pageId));
  const target = preferred ?? available[0];
  if (target) return <Navigate to={target.path} replace />;
  return <><PageHeading title={en ? "Workbench" : "工作台"} brandName={brandName} />
    <QueryState loading={cores.isPending} error={cores.error} onRetry={cores.refetch}>
      <Alert type="info" showIcon title={en ? `Welcome to ${brandName}` : `欢迎使用 ${brandName}`}
        description={coreNavigationMessage(pages, cores, locale, Boolean(user?.isSaasAdmin))} />
    </QueryState></>;
}

function TenantSetting({ appearance = false }: { appearance?: boolean }) {
  const { session } = usePlatformApplication();
  const { user } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const permission = appearance ? "system:integration:manage" : "system:tenant:manage";
  const allowed = canManagePublicResource(user, "tenant", permission);
  return allowed ? appearance ? <AccountAppearancePage /> : <TenantProfilePage /> : <Result status="403" title="403" />;
}

function AccountSecurity() {
  const { session, brandName } = usePlatformApplication(), { locale } = useLocale();
  return <><PageHeading brandName={brandName} title={locale === "en-US" ? "Account security" : "账号安全"} />
    <AdminPasswordPage embedded onChange={session.changePassword} /></>;
}

function SaasPage({ permission, children }: { permission: string; children: ReactNode }) {
  const { user, sessionVerified } = useAdminSession();
  return sessionVerified && canManagePublicResource(user, "saas", permission)
    ? children : <Result status="403" title="403" />;
}

function ToolsPage() {
  const { user } = useAdminSession();
  return user?.isSaasAdmin
    ? <SaasPage permission="system:params:manage"><PlatformToolsPage /></SaasPage>
    : <PlatformToolsPage />;
}

export function createPlatformAdminApplication(options: PlatformAdminApplicationOptions) {
  const { session } = options;
  const PlatformAiPage = options.platformAiPage;
  const invitationApi = createOperatorInvitationApi(session.apiBaseURL);
  const router = createBrowserRouter([{ element: <ApplicationRouterLayout />, children: [
  { path: "/login", element: <SignIn /> },
  { path: "/login/:tenantCode", element: <SignIn /> },
  { path: "/:tenantCode", element: <TenantLoginAlias /> },
  { path: "/invite", element: <AcceptOperatorInvitationPage api={invitationApi} brandName={options.brandName} {...options.publicPageContent?.operatorInvitation} /> },
  { element: <ProtectedLayout />, children: [
    { path: "/", element: <Home /> }, { path: "/settings/profile", element: <SelfProfilePage /> },
    { path: "/settings/security", element: <AccountSecurity /> },
    ...(options.clientAuthorizationPage ? [{ path: clientAuthorizationPath, element: <ClientAuthorization /> }] : []),
    { path: "/settings/appearance", element: <TenantSetting appearance /> },
    { path: "/settings/tenant", element: <TenantSetting /> }, { path: "/settings/tenant-appearance", element: <TenantSetting appearance /> },
    { path: TENANT_INTEGRATIONS_ROUTE.path, element: <TenantIntegrationsPage /> },
    { path: "/settings/dispatch", element: <TenantDispatchPage {...options.publicPageContent?.dispatch} /> },
    { path: "/settings/support", element: <CustomerSupportPage /> },
    { path: "/tenant/dispatch", element: <TenantDispatchPage {...options.publicPageContent?.dispatch} /> },
    { path: "/tenant/support", element: <CustomerSupportPage /> },
    { path: PLATFORM_SETTINGS_ROUTES.organizations.path, element: <OrganizationsPage /> },
    { path: PLATFORM_SETTINGS_ROUTES.security.path, element: <SaasPage permission="system:params:manage"><PlatformSystemPage /></SaasPage> },
    { path: "/platform/operations", element: <SaasPage permission="system:params:manage"><PlatformOperationsPage /></SaasPage> },
    { path: "/platform/users", element: <SaasPage permission="system:user:manage"><PlatformPage /></SaasPage> },
    { path: "/platform/demo-requests", element: <SaasPage permission="system:demo-request:view"><DemoRequestsPage /></SaasPage> },
    { path: "/platform/official-calendars", element: <SaasPage permission="system:calendar-source:manage"><OfficialCalendarSourcePage /></SaasPage> },
    ...(PlatformAiPage ? [{ path: "/platform/ai", element: <SaasPage permission="system:ai-provider:view"><PlatformAiPage /></SaasPage> }] : []),
    ...(options.saasPages ?? []).map(({ path, permission, component: Page }) => ({ path,
      element: <SaasPage permission={permission}><Page /></SaasPage> })),
    { path: PLATFORM_TOOLS_ROUTE, element: <ToolsPage /> },
    { path: SUBSCRIPTION_ROUTES.subscription.path, element: <SubscriptionRoute permission="rental-os:subscription:view"><TenantSubscriptionPage {...options.publicPageContent?.subscription} /></SubscriptionRoute> },
    { path: SUBSCRIPTION_ROUTES.subscriptionPro.path, element: <SubscriptionRoute permission="rental-os:subscription:view"><SubscriptionProPage {...options.publicPageContent?.subscriptionPro} /></SubscriptionRoute> },
    { path: SUBSCRIPTION_ROUTES.subscriptionRequestDetail.path, element: <SubscriptionRoute permission="rental-os:subscription:view"><SubscriptionRequestDetailPage /></SubscriptionRoute> },
    { path: SUBSCRIPTION_ROUTES.platformSubscriptions.path, element: <SubscriptionRoute permission="system:tenant:subscription:manage"><PlatformSubscriptionsPage /></SubscriptionRoute> },
    { path: SUBSCRIPTION_ROUTES.platformSubscriptionDetail.path, element: <SubscriptionRoute permission="system:tenant:subscription:manage"><PlatformSubscriptionDetailPage /></SubscriptionRoute> },
    { path: SUBSCRIPTION_ROUTES.subscriptionCatalog.path, element: <SubscriptionRoute permission="system:tenant:subscription:manage"><SubscriptionCatalogPage /></SubscriptionRoute> },
    { path: "/platform/core-access", element: <CoreAccessPage audience="saas" /> },
    { path: "/platform/core-packages", element: <CorePackagesPage brandName={options.brandName} /> },
    { path: "/settings/member-cores", element: <CoreAccessPage audience="tenant" /> },
    { path: "/platform/tenants", element: <PublicManagementPage kind="tenants" /> },
    { path: "/platform/tenants/new", element: <PublicManagementPage kind="tenants" edit /> },
    { path: "/platform/tenants/:id", element: <PublicManagementPage kind="tenants" edit /> },
    { path: "/platform/tenants/:id/status", element: <PublicManagementPage kind="tenants" edit status /> },
    { path: "/settings/users/:id/reset-password", element: <PublicManagementPage kind="users" action /> },
    { path: "/settings/roles/:id/delete", element: <PublicManagementPage kind="roles" action /> },
    { path: "/tenant/accounts", element: <PublicManagementPage kind="users" /> },
    { path: "/tenant/roles", element: <PublicManagementPage kind="roles" /> },
    ...(["users", "roles"] as const).flatMap(kind => [
      { path: `/settings/${kind}`, element: <PublicManagementPage kind={kind} /> },
      { path: `/settings/${kind}/new`, element: <PublicManagementPage kind={kind} edit /> },
      { path: `/settings/${kind}/:id`, element: <PublicManagementPage kind={kind} edit /> }
    ]),
    ...createRoutesFromElements(createCoreRouteElements(options.pages ?? new Map(), {
      brandName: options.brandName, getContainer: options.getCoreContainer, aliases: options.coreRouteAliases,
      getPageIcon: options.getCorePageIcon,
    })),
    ...Object.entries(LEGACY_PUBLIC_ADMIN_ROUTE_ALIASES).map(([path, target]) => ({ path, element: <Navigate to={target} replace /> })),
    { path: "*", element: <Result status="404" title="404" /> }
  ] }
  ] }]);

  function PlatformAdminApplication() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const pathname = useSyncExternalStore(router.subscribe, () => router.state.location.pathname);
  const publicLogin = pathname === "/login" || pathname.startsWith("/login/") || isTenantLoginAliasPath(pathname);
  useEffect(() => { void session.bootstrap(); }, []);
  const identity = JSON.stringify([state.tenant?.tenantId, state.user?.id, state.user?.permissions, state.user?.dataScope,
    state.user?.locationScope, state.user?.organizationId, session.currentSessionEpoch(), state.sessionVerified]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  return <AdminUiProvider queryClient={session.queryClient} scope={{ identity, currentIdentity: () => currentIdentity.current }}
    messages={options.messages}
    soundScope={state.sessionVerified && state.user ? { key: JSON.stringify([state.tenant?.tenantId, state.user.id]), epoch: session.currentSessionEpoch() } : null}
    accountThemeColor={state.sessionVerified && !publicLogin ? state.user?.accountThemeColor : undefined}
    radii={state.sessionVerified && !publicLogin ? { container: state.tenant?.adminContainerRadius, button: state.tenant?.adminButtonRadius,
      input: state.tenant?.adminInputRadius, legacy: state.tenant?.adminCornerRadius } : undefined}>
    <AdminRuntimeProvider runtime={session.runtime}><PlatformApplicationContext.Provider value={options}>
      <PublicManagementCoreProvider adapter={options.management}><BrandIconProvider><RouterProvider router={router} /></BrandIconProvider></PublicManagementCoreProvider></PlatformApplicationContext.Provider></AdminRuntimeProvider>
  </AdminUiProvider>;
  }
  const navigation = createPublicAdminLocationAccess({
    routes: router.routes, getSession: session.getSnapshot, platformAiAvailable: Boolean(PlatformAiPage), saasPages: options.saasPages,
  });
  const canClientAuthorization = () => {
    const state = session.getSnapshot();
    return Boolean(options.clientAuthorizationPage && state.sessionVerified
      && canManagePublicResource(state.user, "tenant", "system:params:manage"));
  };
  const publicAccess = {
    canAccess: (route: { path: string }) => route.path === clientAuthorizationPath
      ? canClientAuthorization() : navigation.canAccess(route),
    resolve: (href: string) => href === clientAuthorizationPath && canClientAuthorization()
      ? clientAuthorizationPath : navigation.resolve(href),
    originalPath: (pathname: string) => pathname === clientAuthorizationPath && canClientAuthorization()
      ? clientAuthorizationPath : navigation.originalPath(pathname),
  };
  function useMenuAccess() {
    const sections = useApplicationNavigationSections();
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const cores = useCoreSession();
    const epoch = session.currentSessionEpoch();
    const registered = new Map([...(options.pages?.values() ?? [])].map(page => [page.path, page]));
    const routes = Object.fromEntries(sections.flatMap(section => section.routes).map(route => [
      registered.get(route.path)?.key ?? route.path,
      { path: route.path, label: route.label, permission: "", menu: true, coreId: registered.get(route.path)?.coreId },
    ]));
    const byPath = new Map(Object.values(routes).map(route => [route.path, route]));
    function canAccess(route: { path: string }) {
      if (!byPath.has(route.path) || session.getSnapshot() !== state || session.currentSessionEpoch() !== epoch
        || !state.sessionVerified || !state.user) return false;
      const page = registered.get(route.path);
      return page ? options.pages?.get(page.key) === page && cores.canAccess(page.coreId, page.definition.permissions)
        : publicAccess.canAccess(route);
    }
    return {
      routes,
      canAccess,
      resolve: (href: string) => canAccess({ path: href }) ? href : null,
      originalPath: (pathname: string) => canAccess({ path: pathname }) ? pathname : null,
    };
  }
  return Object.assign(PlatformAdminApplication, { navigation: {
    ...publicAccess,
    useSections: useApplicationNavigationSections,
    useMenuAccess,
  } });
}
export type { PlatformAdminApplicationOptions, PlatformSaasPage } from "./application-context";
