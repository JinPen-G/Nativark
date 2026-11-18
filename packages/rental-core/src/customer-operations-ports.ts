/** Rental客户状态与审计的私有参加者声明。历史、权限来源及原事务由所属业务持有；
 * 本声明不注册HTTP，也不授予账号、会员或敏感资料访问权。 */
import type { Prisma } from "@prisma/client";
import type { CustomerMembershipStatus, CustomerSensitiveAccessAuditEntry, CustomerStatusAction, CustomerStatusScope } from "./contracts";
import type { RentalCustomerBusinessGate } from "./client-session-ports";

export interface CustomerStatusHistoryInput {
  customerId: string;
  scope: CustomerStatusScope;
  workspaceId?: string;
  action: CustomerStatusAction;
  fromStatus?: string;
  toStatus: string;
  reason: string;
  operator?: string;
  approver?: string;
  at: string;
  /** Internal original status transaction only; never supplied by a client DTO. */
  captureEnterpriseRecipients?: boolean;
}
export interface CustomerSensitiveAccessInput {
  workspaceId?: string;
  customerId: string;
  field: string;
  action: CustomerSensitiveAccessAuditEntry["action"];
  revealed: boolean;
  operator?: string;
  permission?: string;
  reason?: string;
  at: string;
}

/** 会员流程实际消费的风险、主体锁与状态/历史同事务接点。 */
export interface RentalMembershipOperations extends RentalCustomerBusinessGate {
  hasOpenRisk(tenantId: string, customerId: string, workspaceId?: string, transaction?: Prisma.TransactionClient): Promise<boolean>;
  updateMembershipStatus(tenantId: string, membershipId: string, next: {
    status: CustomerMembershipStatus; levelName?: string; suspendedAt?: string | null;
    restrictedAt?: string | null; exitedAt?: string | null; closedAt?: string | null;
  }, expectedStatus: CustomerMembershipStatus, history: CustomerStatusHistoryInput, transaction?: Prisma.TransactionClient): Promise<number>;
}
