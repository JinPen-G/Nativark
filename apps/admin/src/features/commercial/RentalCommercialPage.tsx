/** 原商业路由保留空间与地址边界，已匹配的版本参数交给同源宿主。 */
import { useLocation, useMatch, useParams } from "react-router-dom";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { LegacyRentalCommercialPage } from "./legacy-commercial-page";
import type { RentalCommercialSection } from "@rental-os/rental-core/admin/commercial";
export type { RentalCommercialSection } from "@rental-os/rental-core/admin/commercial";
export function RentalCommercialPage({ section }: { section: RentalCommercialSection }) {
  const scope = useListQueryIdentity();
  const { pathname } = useLocation();
  return <RentalCommercialWorkspace key={`${scope}:${pathname}`} scope={scope} section={section} />;
}
function RentalCommercialWorkspace({ section, scope }: { section: RentalCommercialSection; scope: string }) {
  const { sequence } = useParams<{ sequence: string }>();
  const versionsOpen = Boolean(useMatch("/rental/pricing/versions"));
  const pageId = sequence !== undefined ? "pricingVersionDetail" : versionsOpen ? "pricingVersions" : section;
  return <LegacyRentalCommercialPage pageId={pageId} scope={scope} />;
}
