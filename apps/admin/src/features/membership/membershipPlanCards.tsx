/** 原会员卡面和列表媒体沿当前会员宿主及原档案组件运行。 */
import type { ComponentProps } from "react";
import {
  MemberCard as RentalMemberCard,
  membershipPlanCards as createMembershipPlanCards,
} from "@rental-os/rental-core/admin/membership/components";
import { LegacyRentalMembershipProvider } from "./legacy-membership-context";
export { MemberCardFacePicker } from "@rental-os/rental-core/admin/membership/components";
export function MemberCard(props: ComponentProps<typeof RentalMemberCard>) {
  return (
    <LegacyRentalMembershipProvider>
      <RentalMemberCard {...props} />
    </LegacyRentalMembershipProvider>
  );
}
export function membershipPlanCards(props: Parameters<typeof createMembershipPlanCards>[0]) {
  const cards = createMembershipPlanCards(props);
  return {
    ...cards,
    media: (row: Parameters<NonNullable<typeof cards.media>>[0]) => (
      <LegacyRentalMembershipProvider>{cards.media!(row)}</LegacyRentalMembershipProvider>
    ),
  };
}
