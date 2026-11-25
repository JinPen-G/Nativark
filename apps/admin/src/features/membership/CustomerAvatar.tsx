/** 原组件绑定当前会员宿主，业务正文由 Rental 单源提供。 */
import type { ComponentProps } from "react";
import { CustomerAvatar as RentalCustomerAvatar } from "@rental-os/rental-core/admin/membership/components";
import { LegacyRentalMembershipProvider } from "./legacy-membership-context";
export function CustomerAvatar(props: ComponentProps<typeof RentalCustomerAvatar>) {
  return (
    <LegacyRentalMembershipProvider>
      <RentalCustomerAvatar {...props} />
    </LegacyRentalMembershipProvider>
  );
}
