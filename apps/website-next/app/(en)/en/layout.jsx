import { SiteDocument } from "../../../components/Document";
import { siteMetadata } from "../../../lib/seo";
export const metadata = siteMetadata("en");
export default function Layout({ children }) {
  return <SiteDocument locale="en">{children}</SiteDocument>;
}
