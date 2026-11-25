/** 客户头像HTTP只消费已装配的原服务。该别名不授予客户可见范围或敏感资料权限。 */
import type { CustomerAvatarService } from "./mysql-customer-avatar";

export type RentalCustomerAvatarHttpApplication = Pick<CustomerAvatarService, "read" | "save">;
export const RENTAL_CUSTOMER_AVATAR_APPLICATION = Symbol.for("rental-core.http.customer-avatar");
