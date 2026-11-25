/** 原页面沿同一 Rental 贡献和当前宿主接点运行。 */
import { MembershipPlanPage as RentalMembershipPlanPage } from "@rental-os/rental-core/admin/membership";
import { LegacyRentalMembershipPageHost } from "./legacy-membership-context";
export function MembershipPlanPage() {
  return (
    <LegacyRentalMembershipPageHost page="plans">
      <RentalMembershipPlanPage />
    </LegacyRentalMembershipPageHost>
  );
}
export { MembershipBenefitScopeSummary } from "@rental-os/rental-core/admin/membership/components";
