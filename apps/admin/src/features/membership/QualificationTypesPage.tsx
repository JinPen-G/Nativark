/** 原页面沿同一 Rental 贡献和当前宿主接点运行。 */
import { QualificationTypesPage as RentalQualificationTypesPage } from "@rental-os/rental-core/admin/membership";
import { LegacyRentalMembershipPageHost } from "./legacy-membership-context";
export function QualificationTypesPage() {
  return (
    <LegacyRentalMembershipPageHost page="qualificationTypes">
      <RentalQualificationTypesPage />
    </LegacyRentalMembershipPageHost>
  );
}
import type { ComponentProps } from "react";
import { QualificationTypesEditor as RentalQualificationTypesEditor } from "@rental-os/rental-core/admin/membership/components";
export function QualificationTypesEditor(
  props: ComponentProps<typeof RentalQualificationTypesEditor> = {},
) {
  return (
    <LegacyRentalMembershipPageHost page="qualificationTypes">
      <RentalQualificationTypesEditor {...props} />
    </LegacyRentalMembershipPageHost>
  );
}
