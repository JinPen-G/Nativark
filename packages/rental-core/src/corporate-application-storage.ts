/** Rental企业治理和结算的私有MySQL视图；只暴露所属应用实际使用的模型。
 * 宿主供给原客户、实收和当前主体读取，公共Core合同不包含ORM或业务账务方法。 */
import type { Prisma } from "@prisma/client";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { SharedCustomerProfile } from "./contracts";

export type RentalCorporateGovernanceTransaction = Pick<Prisma.TransactionClient,
  "$queryRaw" | "customerCorporateInvoiceProfile" | "customerCorporateContract"
  | "customerCorporateCredit" | "customerCorporateCreditLedger" | "customerAuthorizedAgent">;

export interface RentalCorporateGovernanceStorage<TTransaction extends RentalCorporateGovernanceTransaction>
  extends RentalCorporateGovernanceTransaction {
  $transaction<T>(
    work: (transaction: TTransaction) => Promise<T>,
    options?: { isolationLevel: "ReadCommitted" }
  ): Promise<T>;
}

export interface RentalCorporateCustomers<TTransaction extends RentalCorporateGovernanceTransaction> {
  findById(tenantId: string, customerId: string, transaction?: TTransaction):
    PromiseLike<SharedCustomerProfile | undefined>;
}

export type RentalCorporateSettlementTransaction = Pick<Prisma.TransactionClient,
  "$queryRaw" | "rentalOrder" | "rentalOrderChange" | "rentalOrderExtension"
  | "businessWorkspace" | "customerCorporateCredit" | "customerCorporateCreditLedger" | "operationLog">;

export interface RentalCorporateSettlementStorage<TTransaction extends RentalCorporateSettlementTransaction>
  extends RentalCorporateSettlementTransaction {
  $transaction<T>(
    work: (transaction: TTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" }
  ): PromiseLike<T>;
}

/** 仅读取原净实收，不把企业核销再次算作现金，不执行支付或冲销。 */
export interface RentalCorporateFunding<TTransaction extends RentalCorporateSettlementTransaction> {
  netCashPaid(tenantId: string, workspaceId: string, orderId: string, transaction?: TTransaction):
    PromiseLike<number>;
}

/** 每次委托原仓储读取当前主体及各原账空间的权限，不缓存为持续授权。 */
export interface RentalCorporatePrincipals {
  findUserById(userId: string): PromiseLike<SystemUserRow | undefined>;
  findWorkspaceScopedUser(userId: string, workspaceId: string, tenantUser: SystemUserRow):
    PromiseLike<SystemUserRow | undefined>;
}
