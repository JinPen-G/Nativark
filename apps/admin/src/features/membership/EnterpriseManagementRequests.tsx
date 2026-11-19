/** 原组件绑定当前会员宿主，业务正文由 Rental 单源提供。 */
import type { ComponentProps } from "react";
import { EnterpriseManagementRequests as RentalEnterpriseManagementRequests } from "@rental-os/rental-core/admin/membership/components";
import { LegacyRentalMembershipPageHost } from "./legacy-membership-context";
export function EnterpriseManagementRequests() {
  return (
    <LegacyRentalMembershipPageHost page="corporate">
      <RentalEnterpriseManagementRequests />
    </LegacyRentalMembershipPageHost>
  );
}
