/** 所选 Rental 标准清单与十二组页面装配到同一公共应用和浏览器会话。 */
import "@rental-os/platform-admin/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Blocks } from "lucide-react";
import { MotionGlobalConfig } from "motion/react";
import { registerCoreAdminPages } from "@rental-os/core-contracts";
import { createPlatformAdminApplication } from "@rental-os/platform-admin/application";
import { applyMotionPreference, isMotionReduced } from "@rental-os/platform-admin/motion";
import { createRentalAdminContribution, createRentalBrowserAdminHost } from "@rental-os/rental-core/admin";
import { createRentalBrowserAdminSession } from "@rental-os/rental-core/admin/browser";
import { rentalAdminMessages } from "@rental-os/rental-core/admin/messages";
import manifest from "virtual:core-manifest";
import { createRentalNavigation } from "./navigation";
import { createRentalShell } from "./RentalShell";

const session = createRentalBrowserAdminSession({ baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api" });
const rentalHost = createRentalBrowserAdminHost({
  session,
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
  contribution: createRentalAdminContribution(manifest.version, rentalHost.contexts),
}]);
if (!registered.ok) {
  session.dispose();
  throw new Error(registered.issues.map(issue => `${issue.field} ${issue.message}`).join("\n"));
}
const navigation = createRentalNavigation(registered.pages, session);
const Shell = createRentalShell({ session, resolveHref: navigation.resolveNoticeHref,
  hasPageAccess: navigation.canAccessPage,
  workspaceHref: navigation.resolvePageHref("/workbench") });
const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
const registeredHref = navigation.resolvePageHref(currentHref);
if (registeredHref && registeredHref !== currentHref) {
  window.history.replaceState(window.history.state, "", registeredHref);
}
const App = createPlatformAdminApplication({
  brandName: "Nativark",
  brand: <Blocks aria-hidden />,
  session,
  pages: registered.pages,
  messages: rentalAdminMessages,
  getCoreContainer: navigation.getCoreContainer,
  Shell,
});
applyMotionPreference();
MotionGlobalConfig.skipAnimations = isMotionReduced();
createRoot(document.getElementById("root")!).render(<StrictMode><rentalHost.Provider><App /></rentalHost.Provider></StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => session.dispose());
