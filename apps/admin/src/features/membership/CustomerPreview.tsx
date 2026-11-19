/** 原组件绑定当前会员宿主，业务正文由 Rental 单源提供。 */
import type { ComponentProps } from "react";
import { CustomerPreview as RentalCustomerPreview } from "@rental-os/rental-core/admin/membership/components";
import { LegacyRentalMembershipProvider } from "./legacy-membership-context";
export function CustomerPreview(props: ComponentProps<typeof RentalCustomerPreview>) {
  return (
    <LegacyRentalMembershipProvider>
      <RentalCustomerPreview {...props} />
    </LegacyRentalMembershipProvider>
  );
}
export type { CustomerPreviewFacts } from "@rental-os/rental-core/admin/membership/components";
