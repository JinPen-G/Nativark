/** 原卡面偏好沿同一存储和账号键读取。 */
import type { CustomerMembershipPlan } from "@rental-os/rental-core";
import { useMemberCardAppearance as useRentalMemberCardAppearance } from "@rental-os/rental-core/admin/membership/logic";
import { useAuthStore } from "@/features/auth/authStore";
export {
  MEMBER_CARD_FACES,
  memberCardFace,
  savedMemberCardFace,
  saveMemberCardFace,
  type MemberCardFace,
} from "@rental-os/rental-core/admin/membership/logic";
export function useMemberCardAppearance(row: CustomerMembershipPlan) {
  const account = useAuthStore((state) => state.user?.id);
  return useRentalMemberCardAppearance(row, account);
}
