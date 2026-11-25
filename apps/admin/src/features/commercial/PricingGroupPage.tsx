/** 原定价分组路由保留列表身份边界，正文由 Rental 商业模块提供。 */
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { LegacyRentalCommercialPage } from "./legacy-commercial-page";
export function PricingGroupPage() {
  const scope = useListQueryIdentity();
  return <PricingGroupWorkspace key={scope} scope={scope} />;
}
function PricingGroupWorkspace({ scope }: { scope: string }) {
  return <LegacyRentalCommercialPage pageId="pricingGroups" scope={scope} />;
}
