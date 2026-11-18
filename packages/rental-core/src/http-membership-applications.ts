/** Rental会员HTTP只消费已装配业务实例；注册别名本身不授予会员或企业访问权限。 */
import type { MembershipService } from "./mysql-membership";
import type { EnterprisePortalService } from "./mysql-enterprise-portal";

export type RentalMembershipHttpApplication = Pick<MembershipService, keyof MembershipService>;
export type RentalEnterprisePortalHttpApplication = Pick<EnterprisePortalService,
  "operation" | "tenantSettings" | "saveTenantSettings" | "configuration" | "saveConfiguration">;
export const RENTAL_MEMBERSHIP_APPLICATION = Symbol.for("rental-core.http.membership");
export const RENTAL_ENTERPRISE_PORTAL_APPLICATION = Symbol.for("rental-core.http.enterprise-portal");
