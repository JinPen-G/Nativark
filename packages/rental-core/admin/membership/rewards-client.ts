/** 会员激励继续使用原奖励与权益账请求，经营币种从同源订单设置读取。 */
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";
import type {
  GrantRentalRewardRequest,
  RentalCustomerBenefitAccount,
  RentalRewardLedgerEntry,
} from "@rental-os/rental-core";
import { createRentalOrderApi } from "../orders/client";
export function createRentalMembershipRewardsApi(
  request: AdminRuntime["request"],
) {
  return {
    rewards: (customerId?: string) =>
      request<RentalRewardLedgerEntry[]>("/rental/v1/rewards", {
        params: { customerId },
      }),
    benefitAccounts: (customerId?: string) =>
      request<RentalCustomerBenefitAccount[]>("/rental/v1/benefit-accounts", {
        params: { customerId },
      }),
    grantReward: (data: GrantRentalRewardRequest) =>
      request<RentalRewardLedgerEntry[]>("/rental/v1/rewards/grant", {
        method: "post",
        data,
      }),
    reverseReward: (id: string, reason: string) =>
      request<RentalRewardLedgerEntry>(`/rental/v1/rewards/${id}/reverse`, {
        method: "post",
        data: { reason },
      }),
    businessSettings: createRentalOrderApi(request).businessSettings,
  };
}
export type RentalMembershipRewardsApi = ReturnType<
  typeof createRentalMembershipRewardsApi
>;
