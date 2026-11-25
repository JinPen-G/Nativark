/** 原企业操作签名沿当前真实会话，原键和精确收据由 Rental 单源维护。 */
import {
  enterpriseOperatorIdentity as readEnterpriseOperatorIdentity,
  useOriginalEnterpriseOperation as useRentalEnterpriseOperation,
} from "@rental-os/rental-core/admin/membership/logic";
import {
  legacyRentalMembershipReferenceContext,
  useLegacyRentalMembershipContext,
} from "./legacy-membership-context";
export {
  isWorkflowRevisionConflict,
  isInvitePolicyUnconfigured,
} from "@rental-os/rental-core/admin/membership/logic";
export function enterpriseOperatorIdentity() {
  return readEnterpriseOperatorIdentity(legacyRentalMembershipReferenceContext);
}
export function useOriginalEnterpriseOperation(scope?: string, receiptPath?: string) {
  return useRentalEnterpriseOperation(useLegacyRentalMembershipContext(), scope, receiptPath);
}
