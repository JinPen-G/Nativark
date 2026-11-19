/** 原分析读取使用当前会员宿主，分析展示复用同一 Rental 实现。 */
import type { ComponentProps } from "react";
import { CustomerAnalysisReader as RentalCustomerAnalysisReader } from "@rental-os/rental-core/admin/membership/components";
import { LegacyRentalMembershipProvider } from "./legacy-membership-context";
export { CustomerAnalysis } from "@rental-os/rental-core/admin/membership/components";
export function CustomerAnalysisReader(props: ComponentProps<typeof RentalCustomerAnalysisReader>) {
  return (
    <LegacyRentalMembershipProvider>
      <RentalCustomerAnalysisReader {...props} />
    </LegacyRentalMembershipProvider>
  );
}
