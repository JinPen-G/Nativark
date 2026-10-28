import { SiteDocument } from "../../../components/Document";
import { siteIcons } from "../../../lib/site";
export const metadata = {
  icons: siteIcons,
  title: "Rental OS · AI Native Rental Operations",
  description:
    "Connect bookings, inventory, fulfillment and settlement in one rental operations platform.",
};
export default function Layout({ children }) {
  return <SiteDocument locale="en">{children}</SiteDocument>;
}
