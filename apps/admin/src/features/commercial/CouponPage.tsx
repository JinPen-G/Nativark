/** 原优惠券路由保留列表身份边界，正文由 Rental 商业模块提供。 */
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { LegacyRentalCommercialPage } from "./legacy-commercial-page";
export function CouponPage() {
  const scope = useListQueryIdentity();
  return <CouponWorkspace key={scope} scope={scope} />;
}
function CouponWorkspace({ scope }: { scope: string }) {
  return <LegacyRentalCommercialPage pageId="coupons" scope={scope} />;
}
