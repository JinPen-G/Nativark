/** 旧 hook 签名保留，原检查/批准链使用当前真实会话和单次 HTTP。 */
import { useOriginalExchangeInspection as useCoreOriginalExchangeInspection } from "@rental-os/rental-core/admin/orders";
import { useLegacyRentalOrderOperations } from "./legacy-order-context";

export function useOriginalExchangeInspection(orderId: string, operationToken?: string, viewKey = "") {
  return useCoreOriginalExchangeInspection(useLegacyRentalOrderOperations(), orderId, operationToken, viewKey);
}
