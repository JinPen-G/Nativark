/** 原组件绑定当前会员宿主，业务正文由 Rental 单源提供。 */
import type { ComponentProps } from "react";
import { MemberNameEntry as RentalMemberNameEntry } from "@rental-os/rental-core/admin/membership/components";
import { LegacyRentalMembershipProvider } from "./legacy-membership-context";
export function MemberNameEntry(props: ComponentProps<typeof RentalMemberNameEntry>) {
  return (
    <LegacyRentalMembershipProvider>
      <RentalMemberNameEntry {...props} />
    </LegacyRentalMembershipProvider>
  );
}
import { memberNameEntryReference as createMemberNameEntryReference } from "@rental-os/rental-core/admin/membership/logic";
import { legacyRentalMembershipReferenceContext } from "./legacy-membership-context";
export type { MemberNameEntryReference } from "@rental-os/rental-core/admin/membership/logic";
export function memberNameEntryReference(customerId: string) {
  return createMemberNameEntryReference(customerId, legacyRentalMembershipReferenceContext);
}
