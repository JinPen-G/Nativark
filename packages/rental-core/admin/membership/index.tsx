/** 会员与客户页面以同一贡献接入，正文按当前宿主接点读取原 Rental 业务。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { QualificationTypesPage } from "./QualificationTypesPage";
import { PersonalMembershipPage } from "./PersonalMembershipPage";
import { CorporateMembershipPage } from "./CorporateMembershipPage";
import { MembershipReviewPage } from "./MembershipReviewPage";
import { MembershipPlanPage } from "./MembershipPlanPage";
import { MembershipRewardsPage } from "./MembershipRewardsPage";
import {
  RentalMembershipPageProvider,
  type RentalMembershipPageContext,
} from "./page-context";
import { RENTAL_MEMBERSHIP_CORE_ID, RENTAL_MEMBERSHIP_PAGES } from "./pages";
export const rentalMembershipPageComponents: Readonly<
  Record<string, CoreRouteComponent>
> = {
  [RENTAL_MEMBERSHIP_PAGES.qualificationTypes.id]: QualificationTypesPage,
  [RENTAL_MEMBERSHIP_PAGES.reviews.id]: MembershipReviewPage,
  [RENTAL_MEMBERSHIP_PAGES.personal.id]: PersonalMembershipPage,
  [RENTAL_MEMBERSHIP_PAGES.personalDetail.id]: PersonalMembershipPage,
  [RENTAL_MEMBERSHIP_PAGES.corporate.id]: CorporateMembershipPage,
  [RENTAL_MEMBERSHIP_PAGES.corporateDetail.id]: CorporateMembershipPage,
  [RENTAL_MEMBERSHIP_PAGES.plans.id]: MembershipPlanPage,
  [RENTAL_MEMBERSHIP_PAGES.rewards.id]: MembershipRewardsPage,
};
export function createRentalMembershipAdminContribution(
  implementationVersion: string,
  usePageContext: () => RentalMembershipPageContext,
): CoreAdminContribution<CoreRouteComponent> {
  return {
    coreId: RENTAL_MEMBERSHIP_CORE_ID,
    implementationVersion,
    pages: Object.values(RENTAL_MEMBERSHIP_PAGES).map((definition) => {
      const Content = rentalMembershipPageComponents[definition.id];
      const Page: CoreRouteComponent = () => (
        <RentalMembershipPageProvider context={usePageContext()}>
          <Content />
        </RentalMembershipPageProvider>
      );
      return { ...definition, component: Page };
    }),
  };
}
export {
  QualificationTypesPage,
  PersonalMembershipPage,
  CorporateMembershipPage,
  MembershipReviewPage,
  MembershipPlanPage,
  MembershipRewardsPage,
};
export {
  createRentalMembershipPageContext,
  RentalMembershipPageProvider,
  useRentalMembershipContext,
  type RentalMembershipPageContext,
  type RentalMembershipSession,
  type RentalMembershipOperationContext,
  type RentalMembershipComponents,
  type RentalMembershipFiles,
} from "./page-context";
export * from "./client";
export * from "./customer-client";
export * from "./rewards-client";
export * from "./pages";
export { rentalMembershipMessages } from "./messages";
