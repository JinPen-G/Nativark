/** 原对账权限入口，复用Rental规则与每次请求的完整可信身份。 */
import { assertPaymentReconciliationAccess as assertRentalPaymentReconciliationAccess } from "@rental-os/rental-core/mysql-payment-reconciliation-file";
import { getRequestIdentity } from "../../common/request-identity";

export function assertPaymentReconciliationAccess(tenantId: string, workspaceId: string) {
  return assertRentalPaymentReconciliationAccess(tenantId, workspaceId, { getRequestIdentity });
}
