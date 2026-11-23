/** 两个已核定 Core 的真实页面共用一份公共应用、原会话与 QueryClient。 */
import "@rental-os/platform-admin/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminBrandMark } from "@rental-os/platform-admin/shell";
import { MotionGlobalConfig } from "motion/react";
import { registerCoreAdminPages } from "@rental-os/core-contracts";
import { createPlatformAdminApplication } from "@rental-os/platform-admin/application";
import { applyMotionPreference, isMotionReduced } from "@rental-os/platform-admin/motion";
import { createTicketsAdmin } from "@rental-os/example-tickets-core/admin";
import {
  rentalPublicManagement, rentalPublicPageContent, createRentalAdminContribution,
  createRentalBrowserAdminHost,
  createRentalNavigation,
} from "@rental-os/rental-core/admin";
import { createRentalBrowserAdminSession } from "@rental-os/rental-core/admin/browser";
import { rentalAdminMessages } from "@rental-os/rental-core/admin/messages";
import { OrderFactsEntry } from "@rental-os/rental-core/admin/ai/order-facts";
import { createPlatformModelSettingsPage } from "@rental-os/ai-native-admin/platform-model-settings/application";
import manifests from "virtual:core-manifests";
import { createMultiCoreShell } from "./MultiCoreShell";

const session = createRentalBrowserAdminSession({ baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
  loginDevelopment: import.meta.env.VITE_SHOW_ACCOUNT_SHORTCUTS === undefined
    ? import.meta.env.DEV : import.meta.env.VITE_SHOW_ACCOUNT_SHORTCUTS === "true",
});
if (manifests.rental.entries.openapi === "dist/http-openapi-portable.json") {
  // 同一运输覆盖 JSON、图片与 CSV，刷新后仍使用该固定发行的业务入口。
  session.http.interceptors.request.use(config => {
    if (config.url?.startsWith("/rental/v1/")) {
      config.url = "/cores/rental/v1/" + config.url.slice("/rental/v1/".length);
    }
    return config;
  });
}
const rentalHost = createRentalBrowserAdminHost({
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
const registered = registerCoreAdminPages([
  { manifest: manifests.rental, contribution: createRentalAdminContribution(manifests.rental.version, rentalHost.contexts) },
  { manifest: manifests.tickets, contribution: createTicketsAdmin() },
]);
if (!registered.ok) {
  session.dispose();
  throw new Error(registered.issues.map(issue => `${issue.field} ${issue.message}`).join("\n"));
}
const navigation = createRentalNavigation(registered.pages, session);
const Shell = createMultiCoreShell(session, registered.pages, navigation);
const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
const registeredHref = navigation.resolvePageHref(currentHref);
if (registeredHref && registeredHref !== currentHref) {
  window.history.replaceState(window.history.state, "", registeredHref);
}
const App = createPlatformAdminApplication({
  brandName: "Nativark",
  brand: <AdminBrandMark />,
  session,
  pages: registered.pages,
  initialPage: { coreId: "rental", pageId: "workbench" },
  onboardingPage: { coreId: "rental", pageId: "tenant-readiness" },
  loginDisplay: session.loginDisplay,
  management: rentalPublicManagement,
  publicPageContent: rentalPublicPageContent,
  platformAiPage: createPlatformModelSettingsPage(session.runtime),
  messages: rentalAdminMessages,
  getCoreContainer: navigation.getCoreContainer,
  Shell,
});
applyMotionPreference();
MotionGlobalConfig.skipAnimations = isMotionReduced();
createRoot(document.getElementById("root")!).render(<StrictMode><rentalHost.Provider><App /></rentalHost.Provider></StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => session.dispose());
