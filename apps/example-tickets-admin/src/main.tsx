/** 工单只提供标准清单和四页贡献，公共应用负责登录/设置/壳/菜单/路由/请求。 */
import "@rental-os/platform-admin/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ADMIN_BRAND_NAME, AdminBrandMark } from "@rental-os/platform-admin/shell";
import { MotionGlobalConfig } from "motion/react";
import { registerCoreAdminPages } from "@rental-os/core-contracts";
import { createTicketsAdmin } from "@rental-os/example-tickets-core/admin";
import { createPlatformAdminApplication } from "@rental-os/platform-admin/application";
import { createBrowserAdminSession } from "@rental-os/platform-admin/runtime";
import { applyMotionPreference, isMotionReduced } from "@rental-os/platform-admin/motion";
import manifest from "virtual:core-manifest";
import { TicketsAiDetailPage } from "./tickets-ai";
import { TicketsMcpPage } from "./tickets-mcp";

const contribution = createTicketsAdmin(TicketsAiDetailPage);
if (manifest.entries.ai === "dist-mcp/index-mcp.mjs") contribution.pages = [...contribution.pages, { id: "mcp-authorization", path: "/mcp-authorization",
  title: { default: "MCP 读取授权", translations: { "en-US": "MCP read access" } }, menu: { order: 20 },
  permissions: [{ resource: "ticket", action: "read" }], component: TicketsMcpPage }];
const registered = registerCoreAdminPages([{ manifest, contribution }]);
if (!registered.ok) throw new Error(registered.issues.map(issue => `${issue.field} ${issue.message}`).join("\n"));
const session = createBrowserAdminSession({ baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api", storageKey: "nativark:tickets-admin" });
const App = createPlatformAdminApplication({ brandName: ADMIN_BRAND_NAME, brand: <AdminBrandMark />, session, pages: registered.pages });
applyMotionPreference(); MotionGlobalConfig.skipAnimations = isMotionReduced();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => session.dispose());
