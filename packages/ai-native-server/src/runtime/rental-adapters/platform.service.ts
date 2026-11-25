/** AI 客户读取只消费原投影，宿主绑定已授权的同一客户应用。 */
import type { RentalCustomerManagementApplication } from "@rental-os/rental-core/customer-management";
export class PlatformService {}
export interface PlatformService extends Pick<RentalCustomerManagementApplication, "getCustomerDetail"> {}
