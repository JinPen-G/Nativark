/** 原页面沿同一 Rental 贡献和当前宿主接点运行。 */
import { MembershipReviewPage as RentalMembershipReviewPage } from "@rental-os/rental-core/admin/membership";
import { LegacyRentalMembershipPageHost } from "./legacy-membership-context";
export function MembershipReviewPage() {
  return (
    <LegacyRentalMembershipPageHost page="reviews">
      <RentalMembershipReviewPage />
    </LegacyRentalMembershipPageHost>
  );
}
