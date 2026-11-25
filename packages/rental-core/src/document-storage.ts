/** Rental凭证的私有快照存储及受权事实读端口。只读本订单的原事实，快照只追加；
 * 生成模型仅在MySQL适配内使用，公共凭证合同和纯渲染入口不加载它。 */
import type { Prisma } from "@prisma/client";
import type { RentalOrder, RentalInspectionRecord, RentalInspectionTemplate, RentalFundingBalance, TenantRentalBusinessSettings } from "./contracts";

export interface RentalDocumentFacts {
  getOrder(tenantId: string, orderId: string): PromiseLike<RentalOrder>;
  listInspections(tenantId: string, orderId: string): PromiseLike<RentalInspectionRecord[]>;
  listInspectionTemplates(tenantId: string, stage?: "pickup" | "return", order?: RentalOrder): PromiseLike<RentalInspectionTemplate[]>;
  getBusinessSettings(tenantId: string): PromiseLike<TenantRentalBusinessSettings>;
  resolveWorkspaceId(tenantId: string): string;
}
export interface RentalDocumentFunding {
  listEvents(tenantId: string, workspaceId: string, orderId: string): PromiseLike<RentalFundingBalance>;
}
export interface RentalDocumentTransaction {
  $queryRaw: Prisma.TransactionClient["$queryRaw"];
  rentalOrderDocumentSnapshot: Pick<Prisma.TransactionClient["rentalOrderDocumentSnapshot"], "findUnique" | "findMany" | "findFirst" | "create">;
}
export interface RentalDocumentStorage extends RentalDocumentTransaction {
  $transaction<T>(consume: (transaction: RentalDocumentTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" }): PromiseLike<T>;
}
