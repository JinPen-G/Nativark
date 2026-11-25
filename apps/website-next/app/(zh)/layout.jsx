import { SiteDocument } from "../../components/Document";
import { siteIcons } from "../../lib/site";
export const metadata = {
  icons: siteIcons,
  title: "Zelo · 面向 AI Native 应用的开源多租户 SaaS 底座",
  description:
    "可独立运行的开源多租户 SaaS 底座。沉淀认证、权限、订阅、公共后台与可选受控 AI Native / MCP 引擎，让团队专注交付可插拔业务 Core。",
};
export default function Layout({ children }) {
  return <SiteDocument locale="zh">{children}</SiteDocument>;
}
