/** 原组件绑定当前会员宿主，业务正文由 Rental 单源提供。 */
import type { ComponentProps } from "react";
import { EnterpriseRentalHandoffQueue as RentalEnterpriseRentalHandoffQueue } from "@rental-os/rental-core/admin/membership/components";
import { LegacyRentalMembershipPageHost } from "./legacy-membership-context";
export function EnterpriseRentalHandoffQueue(
  props: ComponentProps<typeof RentalEnterpriseRentalHandoffQueue>,
) {
  return (
    <LegacyRentalMembershipPageHost page="corporate">
      <RentalEnterpriseRentalHandoffQueue {...props} />
    </LegacyRentalMembershipPageHost>
  );
}
