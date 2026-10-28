import { SiteDocument } from "../../components/Document";
import { siteIcons } from "../../lib/site";
export const metadata = {
  icons: siteIcons,
  title: "Rental OS · AI Native 租赁经营平台",
  description: "连接预约、库存、履约与结算，让租赁更简单，让经营更高效。",
};
export default function Layout({ children }) {
  return <SiteDocument locale="zh">{children}</SiteDocument>;
}
