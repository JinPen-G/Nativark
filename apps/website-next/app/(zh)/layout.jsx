import { SiteDocument } from "../../components/Document";
import { siteMetadata } from "../../lib/seo";
export const metadata = siteMetadata("zh");
export default function Layout({ children }) {
  return <SiteDocument locale="zh">{children}</SiteDocument>;
}
