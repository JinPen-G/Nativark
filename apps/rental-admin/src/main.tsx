/** 所选 Rental 标准清单与十二组页面装配到同一公共应用和浏览器会话。 */
import "@rental-os/platform-admin/styles";
import { useCoreSession, type CoreRouteComponent } from "@rental-os/platform-admin/core";
import type { RentalAssistantNavigation } from "@rental-os/rental-core/admin/assistant";
import { createRentalAssistantBrowserHost } from "@rental-os/rental-core/admin/assistant-browser";
import { createRentalAssistantAdminContribution } from "@rental-os/rental-core/admin/assistant-pages";
import { createRentalAssistantShell } from "@rental-os/rental-core/admin/assistant-shell";
import { createRentalAssistantNavigation } from "@rental-os/rental-core/admin/assistant-navigation";
import { createRentalDesktopBrowser } from "@rental-os/rental-core/admin/desktop-browser";
import { CopilotProvider } from "@rental-os/rental-core/admin/assistant/source/copilot/CopilotProvider";
import { OperatorProvider } from "@rental-os/rental-core/admin/assistant/source/ai-operator/OperatorContext";
import { rentalCorePageIcon } from "@rental-os/rental-core/admin/browser-page-icons";
import { StrictMode, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import type { PlatformShellProps } from "@rental-os/platform-admin";
import { AdminBrandMark, RestProvider } from "@rental-os/platform-admin/shell";
import { SubscriptionExpiryFloatingCard } from "@rental-os/platform-admin/subscription";
import { MotionGlobalConfig } from "motion/react";
import { registerCoreAdminPages, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { createPlatformAdminApplication } from "@rental-os/platform-admin/application";
import { applyMotionPreference, isMotionReduced } from "@rental-os/platform-admin/motion";
import { rentalPublicManagement, rentalPublicPageContent, createRentalAdminContribution, createRentalNavigationPresentation } from "@rental-os/rental-core/admin";
import { createRentalOrderApi } from "@rental-os/rental-core/admin/orders";
import { createRentalBrowserAdminSession } from "@rental-os/rental-core/admin/browser";
import { createRentalBrowserNotifications } from "@rental-os/rental-core/admin/browser-notifications";
import { rentalAdminMessages } from "@rental-os/rental-core/admin/messages";
import { OrderFactsEntry } from "@rental-os/rental-core/admin/ai/order-facts";
import { createPlatformModelSettingsPage } from "@rental-os/ai-native-admin/platform-model-settings/application";
import manifest from "virtual:core-manifest";
import { createRentalNavigation } from "./navigation";


const session = createRentalBrowserAdminSession({ baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
  loginDevelopment: import.meta.env.VITE_SHOW_ACCOUNT_SHORTCUTS === undefined
    ? import.meta.env.DEV : import.meta.env.VITE_SHOW_ACCOUNT_SHORTCUTS === "true",
});
if (manifest.entries.openapi === "dist/http-openapi-portable.json") {
  // 同一运输覆盖 JSON、图片与 CSV，刷新后仍使用该固定发行的业务入口。
  session.http.interceptors.request.use(config => {
    if (config.url?.startsWith("/rental/v1/")) {
      config.url = "/cores/rental/v1/" + config.url.slice("/rental/v1/".length);
    }
    return config;
  });
}
const pages = new Map<string, CoreRegisteredPage<CoreRouteComponent>>();
const publicNavigation: Pick<RentalAssistantNavigation, "canAccess" | "resolve" | "originalPath"> = {
  canAccess: route => App.navigation.canAccess(route),
  resolve: href => App.navigation.resolve(href),
  originalPath: pathname => App.navigation.originalPath(pathname),
};
const notifications = createRentalBrowserNotifications({ session,
  resolveHref: (item, auth) => navigation.resolveNoticeHref(item, auth),
  hasPageAccess: (pageId, auth) => navigation.canAccessPage(pageId, auth),
  soundScopeKey: auth => JSON.stringify([auth.tenant?.tenantId, auth.user?.id]),
});
const rentalHost = createRentalAssistantBrowserHost({
  pages, publicNavigation,
  session,
  OrderFactsEntry,
  categoryGovernancePreviewEnabled: import.meta.env.DEV
    && import.meta.env.VITE_RENTAL_CATEGORY_GOVERNANCE_PREVIEW === "true",
  loginDefaults: {
    title: "你的租赁业务，\n有了 Rental Agent。",
    description: "资源调配、任务分派、跨店协作，\n交给 Rental Agent 统筹安排。\n\n日常管理，也有 Copilot 随时协助。",
    highlights: [
      { title: "Rental Agent", description: "统筹资源与任务" },
      { title: "Copilot", description: "辅助日常管理" },
      { title: "多品类经营", description: "不同业务，轻松切换" },
    ],
    footerText: "Nativark",
  },
});
const registered = registerCoreAdminPages([{
  manifest,
  contribution: createRentalAdminContribution(manifest.version, rentalHost.contexts, [notifications.page, ...createRentalAssistantAdminContribution(manifest.version, { assistant: rentalHost.assistant }).pages]),
}]);
if (!registered.ok) {
  session.dispose();
  throw new Error(registered.issues.map(issue => `${issue.field} ${issue.message}`).join("\n"));
}
for (const [key, page] of registered.pages) pages.set(key, page);
const navigation = createRentalNavigation(pages, session);
const profileApi = createRentalOrderApi(session.request);
function useNavigationPresentation() {
  const auth = session.useAuthStore();
  const cores = useCoreSession();
  const profile = useQuery({
    queryKey: ["rental-core", "profile"],
    queryFn: ({ signal }) => profileApi.profile({ signal }),
    enabled: Boolean(auth.sessionVerified && auth.user && !auth.user.isSaasAdmin && auth.currentWorkspaceId
      && cores.canAccess("rental", []) && (auth.hasPermission("rental-os:order:view")
        || auth.hasPermission("rental-core:catalog:view") || auth.hasPermission("rental-core:asset:view"))),
  });
  return useMemo(() => createRentalNavigationPresentation(pages, profile.data?.terminology), [profile.data?.terminology]);
}
const WebShell = createRentalAssistantShell({ session, notifications, assistant: rentalHost.assistant, resolveHref: navigation.resolveNoticeHref,
  hasPageAccess: navigation.canAccessPage,
  workspaceHref: navigation.resolvePageHref("/workbench") });
const useRentalDesktopNavigation = createRentalAssistantNavigation(pages, session, { publicNavigation });
const desktop = createRentalDesktopBrowser({ session,
  useNavigation: () => {
    const original = useRentalDesktopNavigation();
    const current = App.navigation.useMenuAccess();
    // Rental 保留原范围核验，其他 Core 和新增公共页沿同一宿主当前登记。
    const extraRoutes = Object.fromEntries(Object.entries(current.routes).filter(([, route]) => route.coreId !== "rental"));
    const extraPaths = new Set(Object.values(extraRoutes).map(route => route.path));
    return {
      routes: { ...extraRoutes, ...original.routes },
      canAccess: route => original.canAccess(route) || extraPaths.has(route.path) && current.canAccess(route),
      resolve: href => original.resolve(href) ?? (extraPaths.has(href) ? current.resolve(href) : null),
      originalPath: pathname => original.originalPath(pathname) ?? (extraPaths.has(pathname) ? current.originalPath(pathname) : null),
    };
  },
  useSections: () => App.navigation.useSections(),
});
function Shell(props: PlatformShellProps) {
  if (!desktop.isDesktop()) return <WebShell {...props} />;
  return <rentalHost.assistant.Provider><CopilotProvider><OperatorProvider><notifications.NotificationProvider>
    <desktop.ContentShell RestProvider={RestProvider} SubscriptionExpiryFloatingCard={SubscriptionExpiryFloatingCard}>
      {props.children}
    </desktop.ContentShell>
  </notifications.NotificationProvider></OperatorProvider></CopilotProvider></rentalHost.assistant.Provider>;
}
const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
const registeredHref = navigation.resolvePageHref(currentHref);
if (registeredHref && registeredHref !== currentHref) {
  window.history.replaceState(window.history.state, "", registeredHref);
}
const App = createPlatformAdminApplication({
  brandName: "Nativark",
  brand: <AdminBrandMark />,
  session,
  pages,
  saasPages: rentalHost.saasPages,
  getCorePageIcon: rentalCorePageIcon,
  coreRouteAliases: navigation.aliases,
  initialPage: { coreId: "rental", pageId: "workbench" },
  onboardingPage: { coreId: "rental", pageId: "tenant-readiness" },
  loginDisplay: session.loginDisplay,
  management: rentalPublicManagement,
  publicPageContent: rentalPublicPageContent,
  platformAiPage: createPlatformModelSettingsPage(session.runtime),
  messages: rentalAdminMessages,
  getCoreContainer: navigation.getCoreContainer,
  RouterBridge: desktop.Bridge,
  clientAuthorizationPage: desktop.ClientAuthorizationPage,
  useNavigationPresentation,
  Shell,
});
applyMotionPreference();
MotionGlobalConfig.skipAnimations = isMotionReduced();
createRoot(document.getElementById("root")!).render(<StrictMode><desktop.Provider><rentalHost.Provider><App /></rentalHost.Provider></desktop.Provider></StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => session.dispose());
