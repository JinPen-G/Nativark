/** Rental订单/资产/库存/检查与工单的私有MySQL视图；公共Core合同不携带生成模型或整库写权限。 */
import type { Prisma } from "@prisma/client";
import type { RentalCategoryWriteTransaction } from "./mysql-category-write";
import type { RentalFactRequestContext } from "./fact-request-context";
import type { RentalFrozenFactContacts } from "./frozen-fact-storage";

export type RentalCoreFactTransaction = RentalCategoryWriteTransaction & {
  $queryRaw: Prisma.TransactionClient["$queryRaw"];
  $executeRaw: Prisma.TransactionClient["$executeRaw"];
  rentalAssetStatusHistory: Pick<Prisma.TransactionClient["rentalAssetStatusHistory"], "create" | "findMany">;
  rentalOrder: Pick<Prisma.TransactionClient["rentalOrder"], "count" | "create" | "findFirst" | "findMany" | "findUnique" | "update">;
  rentalAllocation: Pick<Prisma.TransactionClient["rentalAllocation"], "create" | "deleteMany" | "findFirst" | "findMany" | "findUnique">;
  rentalOrderChange: Pick<Prisma.TransactionClient["rentalOrderChange"], "create" | "findMany">;
  rentalOrderExtension: Pick<Prisma.TransactionClient["rentalOrderExtension"], "create" | "findMany" | "updateMany">;
  rentalWorkOrder: Pick<Prisma.TransactionClient["rentalWorkOrder"], "count" | "create" | "findFirst" | "findMany" | "updateMany">;
  rentalAsset: Pick<Prisma.TransactionClient["rentalAsset"], "create" | "findFirst" | "findMany" | "findUnique" | "update" | "updateMany">;
  rentalCarrierShipmentEvent: Pick<Prisma.TransactionClient["rentalCarrierShipmentEvent"], "findMany">;
  businessWorkspace: Pick<Prisma.TransactionClient["businessWorkspace"], "findFirst">;
  rentalOrderLine: Pick<Prisma.TransactionClient["rentalOrderLine"], "create" | "findUnique" | "update">;
  rentalReservation: Pick<Prisma.TransactionClient["rentalReservation"], "create" | "findMany" | "findUnique" | "update">;
  rentalStockLedgerEntry: Pick<Prisma.TransactionClient["rentalStockLedgerEntry"], "create" | "findFirst" | "findMany">;
  rentalItemGroup: Pick<Prisma.TransactionClient["rentalItemGroup"], "findFirst">;
  rentalFulfillmentLocation: Pick<Prisma.TransactionClient["rentalFulfillmentLocation"], "findFirst" | "findMany">;
  rentalStockBalance: Pick<Prisma.TransactionClient["rentalStockBalance"], "create" | "findFirst" | "findMany" | "findUnique" | "update" | "updateMany" | "upsert">;
  rentalStockDisposition: Pick<Prisma.TransactionClient["rentalStockDisposition"], "findFirst" | "findMany" | "updateMany" | "upsert">;
  workspaceMember: Pick<Prisma.TransactionClient["workspaceMember"], "findMany">;
  organizationUnit: Pick<Prisma.TransactionClient["organizationUnit"], "findMany">;
  operationLog: Pick<Prisma.TransactionClient["operationLog"], "create" | "findMany">;
  rentalInspectionRecord: Pick<Prisma.TransactionClient["rentalInspectionRecord"], "create" | "findFirst" | "findMany" | "update">;
};

export type RentalCoreFactStorage<TTransaction extends RentalCoreFactTransaction> = TTransaction & {
  $transaction<T>(run: (transaction: TTransaction) => Promise<T>,
    options?: { isolationLevel: "ReadCommitted" }): Promise<T>;
};

export interface RentalCoreFactContacts<TTransaction extends RentalCoreFactTransaction>
  extends RentalFactRequestContext, RentalFrozenFactContacts {
  /** 原组织算法消费已按租户过滤的节点；这里不取得公共组织写权。 */
  enabledOrganizationSubtreeIds(organizations: Array<{ id: string; parentId: string | null; status: string }>, rootId: string): string[];
  events?: {
    /** 原检查事实与观察者在同一事务提交，事件归属仍由宿主维护。 */
    inspection?(transaction: TTransaction, scope: { tenantId: string; workspaceId: string }, id: string): PromiseLike<unknown>;
  };
}
