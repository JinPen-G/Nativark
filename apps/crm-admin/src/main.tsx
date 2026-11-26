/** CRM 宿主只登记已核定包的页面贡献；公共应用持有唯一会话、请求、缓存、登录和外壳。 */
import "@rental-os/platform-admin/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { registerCoreAdminPages } from "@rental-os/core-contracts";
import { createCrmAdmin } from "@rental-os/crm-core/admin";
import { createPlatformAdminApplication } from "@rental-os/platform-admin/application";
import { createBrowserAdminSession } from "@rental-os/platform-admin/runtime";
import { ADMIN_BRAND_NAME, AdminBrandMark } from "@rental-os/platform-admin/shell";
import { applyMotionPreference, isMotionReduced } from "@rental-os/platform-admin/motion";
import manifest from "virtual:crm-core-manifest";

const registered = registerCoreAdminPages([{ manifest, contribution: createCrmAdmin() }]);
if (!registered.ok) throw new Error(registered.issues.map(issue => `${issue.field} ${issue.message}`).join("\n"));
const session = createBrowserAdminSession({ baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api", storageKey: "zelo:crm-admin" });
const App = createPlatformAdminApplication({ brandName: ADMIN_BRAND_NAME, brand: <AdminBrandMark />, session, pages: registered.pages });
applyMotionPreference();
MotionGlobalConfig.skipAnimations = isMotionReduced();
const root = document.getElementById("root");
if (!root) throw new Error("CRM 后台缺少应用挂载节点");
createRoot(root).render(<StrictMode><App /></StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => session.dispose());
