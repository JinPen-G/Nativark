/** 原组件绑定当前会员宿主，业务正文由 Rental 单源提供。 */
import type { ComponentProps } from "react";
import { EnterprisePortalConfiguration as RentalEnterprisePortalConfiguration } from "@rental-os/rental-core/admin/membership/components";
import { LegacyRentalMembershipPageHost } from "./legacy-membership-context";
export function EnterprisePortalConfiguration(
  props: ComponentProps<typeof RentalEnterprisePortalConfiguration>,
) {
  return (
    <LegacyRentalMembershipPageHost page="corporate">
      <RentalEnterprisePortalConfiguration {...props} />
    </LegacyRentalMembershipPageHost>
  );
}
