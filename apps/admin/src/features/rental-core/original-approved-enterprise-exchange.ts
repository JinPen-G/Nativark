/** 旧 hook 签名保留，原检查/批准链使用当前真实会话和单次 HTTP。 */
import { useOriginalApprovedEnterpriseExchange as useCoreOriginalApprovedEnterpriseExchange } from "@rental-os/rental-core/admin/orders";
import { useLegacyRentalOrderOperations } from "./legacy-order-context";

export function useOriginalApprovedEnterpriseExchange(orderId: string, operationToken?: string) {
  return useCoreOriginalApprovedEnterpriseExchange(useLegacyRentalOrderOperations(), orderId, operationToken);
}
