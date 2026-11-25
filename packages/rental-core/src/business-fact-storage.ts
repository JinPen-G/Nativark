/** Rental报价、券、奖励及通知的私有MySQL视图；当前范围和原事件由宿主提供，公共Core合同不携带生成模型。 */
import type { Prisma } from "@prisma/client";
import type { RentalQuoteInventoryReader } from "./quote-inventory-basis";
import type { RentalQuoteCapabilityTransaction } from "./mysql-quote-capabilities";

export interface RentalBusinessFactTransaction extends RentalQuoteCapabilityTransaction {
  $queryRaw: Prisma.TransactionClient["$queryRaw"];
  $executeRaw: Prisma.TransactionClient["$executeRaw"];
  businessWorkspace: Pick<Prisma.TransactionClient["businessWorkspace"], "findFirst" | "findMany">;
  rentalOrder: Pick<Prisma.TransactionClient["rentalOrder"], "findFirst">;
  rentalQuote: Pick<Prisma.TransactionClient["rentalQuote"], "findFirst" | "findMany" | "findUnique" | "create" | "update" | "updateMany">;
  rentalCustomerCoupon: Pick<Prisma.TransactionClient["rentalCustomerCoupon"], "count" | "findFirst" | "findMany" | "findUnique" | "create" | "update" | "updateMany">;
  rentalRewardLedgerEntry: Pick<Prisma.TransactionClient["rentalRewardLedgerEntry"], "findMany" | "findUnique" | "create" | "update">;
  rentalBenefitAccount: Pick<Prisma.TransactionClient["rentalBenefitAccount"], "findMany" | "upsert">;
  rentalReferral: Pick<Prisma.TransactionClient["rentalReferral"], "findMany" | "upsert">;
  rentalNotificationLog: Pick<Prisma.TransactionClient["rentalNotificationLog"], "findFirst" | "findMany" | "create" | "updateMany">;
  rentalNotificationRateBucket: Pick<Prisma.TransactionClient["rentalNotificationRateBucket"], "create" | "updateMany">;
}

/** 根数据源与调用方事务使用同一表视图，通知观察者存在时保留原事务提交方式。 */
export type RentalBusinessFactStorage<TTransaction extends RentalBusinessFactTransaction> = TTransaction & {
  $transaction<T>(
    run: (transaction: TTransaction) => Promise<T>,
    options?: { isolationLevel: "ReadCommitted" }
  ): Promise<T>;
};

export interface RentalBusinessFactContacts<TTransaction extends RentalBusinessFactTransaction> {
  resolveWorkspaceId(client: RentalBusinessFactTransaction, tenantId: string): PromiseLike<string>;
  /** 每次从原服务端身份生成，前后读取不缓存旧权限。 */
  orderVisibilityWhere(): Prisma.RentalOrderWhereInput;
  quoteConfiguration: RentalQuoteInventoryReader<TTransaction>;
  events?: {
    /** 原事实与事件在同一事务提交；外部短信执行仍由原通知服务负责。 */
    notification(transaction: TTransaction, scope: { tenantId: string; workspaceId: string }, id: string): PromiseLike<unknown>;
  };
}
