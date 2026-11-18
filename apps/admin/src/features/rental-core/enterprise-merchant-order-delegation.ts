/** 旧 hook 签名复用当前已验证会话和公共单次派发，历史 D 与原结果继续可读。 */
import { useMerchantOrderDelegationSource as useCoreMerchantOrderDelegationSource } from "@rental-os/rental-core/admin/orders";
import { useLegacyRentalOrderOperations } from "./legacy-order-context";

export function useMerchantOrderDelegationSource(active: boolean) {
  return useCoreMerchantOrderDelegationSource(useLegacyRentalOrderOperations(), active);
}
