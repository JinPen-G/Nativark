/** 原组件绑定当前会员宿主，业务正文由 Rental 单源提供。 */
import type { ComponentProps } from "react";
import { CustomerProfileDetails as RentalCustomerProfileDetails } from "@rental-os/rental-core/admin/membership/components";
import { LegacyRentalMembershipPageHost } from "./legacy-membership-context";
export function CustomerProfileDetails(props: ComponentProps<typeof RentalCustomerProfileDetails>) {
  return (
    <LegacyRentalMembershipPageHost page="personal" customerId={props.customerId}>
      <RentalCustomerProfileDetails {...props} />
    </LegacyRentalMembershipPageHost>
  );
}
