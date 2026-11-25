import { SiteDocument } from "../../../components/Document";
import { siteIcons } from "../../../lib/site";
export const metadata = {
  icons: siteIcons,
  title: "Zelo · Open-Source Multi-Tenant SaaS Foundation for AI-Native Apps",
  description:
    "A standalone, open-source multi-tenant SaaS foundation with auth, RBAC, subscriptions, shared admin shell, and optional governed AI Native & MCP—so you ship pluggable business Cores, not SaaS plumbing.",
};
export default function Layout({ children }) {
  return <SiteDocument locale="en">{children}</SiteDocument>;
}
