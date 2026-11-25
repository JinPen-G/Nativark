/** Rental经营报表的私有只读MySQL视图；仅提供原订单聚合/分页和资产、数量库存快照。
 * 生成模型留在适配层，公共Core契约与领域根出口不加载此视图。 */
import type { Prisma } from "@prisma/client";

export interface RentalWorkspaceReportStorage {
  rentalOrder: Pick<Prisma.TransactionClient["rentalOrder"], "groupBy" | "aggregate" | "findMany">;
  rentalAsset: Pick<Prisma.TransactionClient["rentalAsset"], "groupBy">;
  rentalStockBalance: Pick<Prisma.TransactionClient["rentalStockBalance"], "aggregate">;
}
